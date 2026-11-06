//! 다운로드 큐: 사용자가 요청한 항목만 동시 실행 수에 맞춰 받는다.
//! 실패해도 자동으로 다시 시도하지 않는다 (대기열에서 항목별로 '다시 시도').

use crate::db::{self, Settings, Video};
use crate::tools;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::{oneshot, Notify, Semaphore};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub notify: Notify,
    /// 진행 중인 다운로드: id → 중지 신호
    pub jobs: Mutex<HashMap<i64, oneshot::Sender<()>>>,
    /// 영상 정보 조회를 동시에 몇 개까지 할지
    pub meta_sem: Semaphore,
    /// YouTube가 요청을 제한하면 이 시각까지 정보 조회를 쉰다
    pub meta_blocked_until: Mutex<Option<Instant>>,
    /// 진행 중인 구간 자르기(완료 목록): 원본 id → 취소 신호
    pub cuts: Mutex<HashMap<i64, oneshot::Sender<()>>>,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        Self {
            db: Mutex::new(conn),
            notify: Notify::new(),
            jobs: Mutex::new(HashMap::new()),
            meta_sem: Semaphore::new(crate::meta::META_CONCURRENCY),
            meta_blocked_until: Mutex::new(None),
            cuts: Mutex::new(HashMap::new()),
        }
    }

    pub fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 진행 중인 다운로드를 멈춘다. 멈춘 항목은 '준비' 상태로 돌아가고,
    /// 다시 받으면 받다 만 파일에 이어서 받는다.
    pub fn stop(&self, id: i64) -> bool {
        match self.jobs.lock().unwrap().remove(&id) {
            Some(tx) => {
                let _ = tx.send(());
                true
            }
            None => false,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: i64,
    /// downloading | processing
    pub stage: &'static str,
    pub percent: f64,
    pub downloaded: Option<f64>,
    pub total: Option<f64>,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
}

pub fn emit_video(app: &AppHandle, st: &AppState, id: i64) {
    if let Ok(Some(v)) = db::get(&st.conn(), id) {
        let _ = app.emit("video-updated", v);
    }
}

/// 백그라운드 루프: 빈 슬롯만큼 다운로드 요청된 항목을 시작한다.
pub async fn worker(app: AppHandle, st: Arc<AppState>) {
    loop {
        fill_slots(&app, &st);
        tokio::select! {
            _ = st.notify.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
        }
    }
}

fn fill_slots(app: &AppHandle, st: &Arc<AppState>) {
    loop {
        let (settings, next) = {
            let conn = st.conn();
            let settings = db::load_settings(&conn);
            if st.jobs.lock().unwrap().len() >= settings.concurrency.max(1) as usize {
                return;
            }
            (settings, db::claim_next(&conn).ok().flatten())
        };
        let Some(v) = next else { return };
        let (tx, rx) = oneshot::channel();
        st.jobs.lock().unwrap().insert(v.id, tx);
        let _ = app.emit("video-updated", v.clone());
        tauri::async_runtime::spawn(run_job(app.clone(), st.clone(), v, settings, rx));
    }
}

enum Outcome {
    Done(Option<String>),
    Failed(String),
    Stopped,
}

async fn run_job(
    app: AppHandle,
    st: Arc<AppState>,
    v: Video,
    s: Settings,
    stop_rx: oneshot::Receiver<()>,
) {
    let started = Instant::now();
    log::info!(
        "download start #{} {}{} quality={}",
        v.id,
        v.url,
        v.clip().map(|(a, b)| format!(" clip={}", crate::clip::label(a, b))).unwrap_or_default(),
        v.quality
    );
    let outcome = download(&app, &v, &s, stop_rx).await;
    st.jobs.lock().unwrap().remove(&v.id);
    let secs = started.elapsed().as_secs_f64();
    match &outcome {
        Outcome::Done(p) => log::info!("download done #{} in {secs:.1}s → {}", v.id, p.as_deref().unwrap_or("?")),
        Outcome::Stopped => log::info!("download stopped #{} after {secs:.1}s", v.id),
        Outcome::Failed(msg) => log::warn!("download failed #{} after {secs:.1}s: {msg}", v.id),
    }
    let got = match &outcome {
        Outcome::Done(Some(p)) => crate::meta::probe_quality(p).await,
        _ => None,
    };
    {
        let conn = st.conn();
        let _ = match &outcome {
            Outcome::Done(path) => {
                let size = path
                    .as_deref()
                    .and_then(|p| std::fs::metadata(p).ok())
                    .map(|m| m.len() as i64);
                db::mark_done(&conn, v.id, path.as_deref(), size, got.as_deref())
            }
            Outcome::Stopped => db::set_status(&conn, v.id, "ready"),
            Outcome::Failed(msg) => db::mark_failed(&conn, v.id, msg),
        };
    }
    emit_video(&app, &st, v.id);
    st.notify.notify_one();
}

pub fn format_args(quality: &str) -> Vec<String> {
    let v: Vec<&str> = match quality {
        "audio" => vec!["-f", "ba[ext=m4a]/ba/b", "-x", "--audio-format", "m4a"],
        "best" => vec!["-f", "bv*+ba/b", "--merge-output-format", "mp4"],
        // res = 가로·세로 중 짧은 변. 세로 영상(Shorts)도 1080p를 1080으로 맞춘다.
        // 그 화질이 없으면 그보다 낮은 것 중 가장 좋은 것을 받는다.
        h if h.parse::<u32>().is_ok() => {
            return vec![
                "-f".into(),
                "bv*+ba/b".into(),
                "-S".into(),
                format!("res:{h}"),
                "--merge-output-format".into(),
                "mp4".into(),
            ];
        }
        _ => vec!["-f", "bv*+ba/b", "--merge-output-format", "mp4"],
    };
    v.into_iter().map(String::from).collect()
}

fn build_args(v: &Video, s: &Settings) -> Vec<String> {
    let mut a: Vec<String> = [
        "--no-playlist",
        "--newline",
        "--progress",
        "--no-simulate",
        "--no-mtime",
        // 이미 있는 영상·썸네일은 다시 받거나 덮어쓰지 않는다
        "--no-overwrites",
        "--encoding",
        "utf-8",
        "--progress-template",
        "download:YTDLP_PROG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
        "--print",
        "after_move:YTDLP_FILE|%(filepath)s",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    a.extend(format_args(&v.quality));
    // 구간 항목은 썸네일을 따로 받지 않는다 (원본의 썸네일을 함께 쓴다)
    if s.save_thumbnail && v.clip().is_none() {
        // 변환 없이 원본 그대로 저장한다. yt-dlp는 해상도 높은 썸네일부터 차례로 시도해
        // 처음 있는 것을 받는다 (같은 크기면 webp가 앞이고, 큰 webp가 없으면 그 크기의 jpg).
        a.push("--write-thumbnail".into());
    }
    // 구간 항목: 그 구간만 받고, 파일 이름에 구간을 붙인다
    let template = match v.clip() {
        Some((start, end)) => {
            a.extend(crate::clip::ytdlp_args(start, end, v.clip_precise));
            crate::clip::template_with_label(&s.filename_template, &crate::clip::label(start, end))
        }
        None => s.filename_template.clone(),
    };
    a.extend([
        "-P".into(),
        v.output_dir.clone().unwrap_or_else(|| s.output_dir.clone()),
        "-o".into(),
        template,
        "--".into(),
        v.url.clone(),
    ]);
    a
}

async fn read_lines<R: AsyncRead + Unpin>(r: R, mut f: impl FnMut(String)) {
    let mut reader = BufReader::new(r);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => f(String::from_utf8_lossy(&buf).trim().to_string()),
        }
    }
}

fn num(s: &str) -> Option<f64> {
    s.parse::<f64>().ok().filter(|n| n.is_finite())
}

async fn download(
    app: &AppHandle,
    v: &Video,
    s: &Settings,
    mut stop_rx: oneshot::Receiver<()>,
) -> Outcome {
    let out_dir = v.output_dir.as_deref().unwrap_or(&s.output_dir);
    if let Err(e) = std::fs::create_dir_all(out_dir) {
        return Outcome::Failed(format!("Can't create the save folder: {e}"));
    }
    let args = build_args(v, s);
    log::info!("{}", tools::command_line("yt-dlp", &args));
    let mut child = match tools::ytdlp().args(args).spawn() {
        Ok(c) => c,
        Err(e) => return Outcome::Failed(format!("Can't run yt-dlp: {e}")),
    };

    let stderr = child.stderr.take().unwrap();
    let err_task = tokio::spawn(async move {
        let mut last: VecDeque<String> = VecDeque::new();
        read_lines(stderr, |l| {
            if !l.is_empty() {
                if last.len() >= 30 {
                    last.pop_front();
                }
                last.push_back(l);
            }
        })
        .await;
        last
    });

    let stdout = child.stdout.take().unwrap();
    let app2 = app.clone();
    let id = v.id;
    let out_task = tokio::spawn(async move {
        let mut file = None;
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        read_lines(stdout, |l| {
            if let Some(rest) = l.strip_prefix("YTDLP_PROG|") {
                let f: Vec<&str> = rest.split('|').collect();
                if f.len() < 6 {
                    return;
                }
                let finished = f[0] == "finished";
                // 진행률 이벤트는 초당 4번 정도로 제한해 화면이 버벅이지 않게 한다
                if !finished && last_emit.elapsed() < Duration::from_millis(250) {
                    return;
                }
                last_emit = Instant::now();
                let downloaded = num(f[1]);
                let total = num(f[2]).or(num(f[3]));
                let percent = if finished {
                    100.0
                } else {
                    match (downloaded, total) {
                        (Some(d), Some(t)) if t > 0.0 => (d / t * 100.0).min(100.0),
                        _ => 0.0,
                    }
                };
                let _ = app2.emit(
                    "download-progress",
                    Progress {
                        id,
                        stage: if finished { "processing" } else { "downloading" },
                        percent,
                        downloaded,
                        total,
                        speed: num(f[4]),
                        eta: num(f[5]),
                    },
                );
            } else if let Some(p) = l.strip_prefix("YTDLP_FILE|") {
                file = Some(p.to_string());
            }
        })
        .await;
        file
    });

    tokio::select! {
        status = child.wait() => {
            let file = out_task.await.ok().flatten();
            let errs = err_task.await.unwrap_or_default();
            match status {
                Ok(st) if st.success() => Outcome::Done(file),
                Ok(st) => {
                    // 화면에는 한 줄만 보여주고, 로그에는 yt-dlp 출력 끝부분을 그대로 남긴다
                    log::warn!("yt-dlp #{id} exited with {:?}:\n{}", st.code(), errs.iter().cloned().collect::<Vec<_>>().join("\n"));
                    Outcome::Failed(pick_error(&errs, st.code()))
                }
                Err(e) => Outcome::Failed(format!("yt-dlp error: {e}")),
            }
        }
        _ = &mut stop_rx => {
            let _ = child.kill().await;
            Outcome::Stopped
        }
    }
}

fn pick_error(lines: &VecDeque<String>, code: Option<i32>) -> String {
    lines
        .iter()
        .rev()
        .find(|l| l.starts_with("ERROR:"))
        .or_else(|| lines.iter().rev().find(|l| !l.starts_with("WARNING:")))
        .map(|l| l.trim_start_matches("ERROR:").trim().to_string())
        .unwrap_or_else(|| format!("Unknown error (exit code {code:?})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_items_download_only_their_section() {
        let s = Settings::default();
        let full = Video { url: "u".into(), quality: "best".into(), ..Default::default() };
        let a = build_args(&full, &s);
        assert!(!a.contains(&"--download-sections".to_string()));

        let clip = Video { clip_start: Some(90.0), clip_end: Some(165.0), clip_precise: true, ..full };
        let a = build_args(&clip, &s);
        let i = a.iter().position(|x| x == "--download-sections").unwrap();
        assert_eq!(a[i + 1], "*90-165");
        assert!(a.contains(&"--force-keyframes-at-cuts".to_string()));
        let o = a.iter().position(|x| x == "-o").unwrap();
        assert_eq!(a[o + 1], "%(title)s [%(id)s] (1m30s-2m45s).%(ext)s");
        assert!(!a.contains(&"--write-thumbnail".to_string()), "구간 항목은 썸네일을 받지 않음");
    }

    #[test]
    fn error_line_selection() {
        let lines: VecDeque<String> = [
            "WARNING: something",
            "ERROR: [youtube] x: HTTP Error 403",
            "WARNING: later",
        ]
        .map(String::from)
        .into();
        assert_eq!(pick_error(&lines, Some(1)), "[youtube] x: HTTP Error 403");
        assert!(pick_error(&VecDeque::new(), Some(2)).contains("2"));
    }

    #[test]
    fn quality_formats() {
        assert_eq!(format_args("best")[1], "bv*+ba/b");
        assert!(format_args("1080").contains(&"res:1080".to_string()));
        assert!(format_args("audio").contains(&"-x".to_string()));
    }

    #[test]
    fn thumbnail_args() {
        let v = Video { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ".into(), ..Default::default() };
        let mut s = Settings::default();
        let a = build_args(&v, &s);
        assert!(a.contains(&"--write-thumbnail".to_string()));
        assert!(a.contains(&"--no-overwrites".to_string()));
        assert!(!a.contains(&"--convert-thumbnails".to_string()), "원본은 변환하지 않음");
        s.save_thumbnail = false;
        assert!(!build_args(&v, &s).iter().any(|x| x.contains("thumbnail")));
    }
}
