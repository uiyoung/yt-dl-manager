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
    pub meta_sem: Semaphore,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        Self {
            db: Mutex::new(conn),
            notify: Notify::new(),
            jobs: Mutex::new(HashMap::new()),
            meta_sem: Semaphore::new(4),
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
    let outcome = download(&app, &v, &s, stop_rx).await;
    st.jobs.lock().unwrap().remove(&v.id);
    {
        let conn = st.conn();
        let _ = match &outcome {
            Outcome::Done(path) => {
                let size = path
                    .as_deref()
                    .and_then(|p| std::fs::metadata(p).ok())
                    .map(|m| m.len() as i64);
                db::mark_done(&conn, v.id, path.as_deref(), size)
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
        h if h.parse::<u32>().is_ok() => {
            return vec![
                "-f".into(),
                format!("bv*[height<={h}]+ba/b[height<={h}]/bv*+ba/b"),
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
    if s.save_thumbnail {
        a.extend(["--write-thumbnail", "--convert-thumbnails", "jpg"].map(String::from));
    }
    a.extend([
        "-P".into(),
        v.output_dir.clone().unwrap_or_else(|| s.output_dir.clone()),
        "-o".into(),
        s.filename_template.clone(),
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
        return Outcome::Failed(format!("저장 폴더를 만들 수 없습니다: {e}"));
    }
    let mut child = match tools::ytdlp().args(build_args(v, s)).spawn() {
        Ok(c) => c,
        Err(e) => return Outcome::Failed(format!("yt-dlp를 실행할 수 없습니다: {e}")),
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
                Ok(st) => Outcome::Failed(pick_error(&errs, st.code())),
                Err(e) => Outcome::Failed(format!("yt-dlp 실행 오류: {e}")),
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
        .unwrap_or_else(|| format!("알 수 없는 오류 (종료 코드 {code:?})"))
}

// ---------- 영상 정보 조회 ----------

pub async fn fetch_meta(app: AppHandle, st: Arc<AppState>, id: i64, url: String) {
    let Ok(_permit) = st.meta_sem.acquire().await else { return };
    let out = tools::ytdlp()
        .args([
            "--skip-download",
            "--no-playlist",
            "--no-warnings",
            "--encoding",
            "utf-8",
            "-O",
            "%(.{title,channel,uploader,duration,thumbnail,filesize,filesize_approx})j",
            "--",
            &url,
        ])
        .output()
        .await;
    let parsed = out
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let text = String::from_utf8_lossy(&o.stdout).into_owned();
            text.lines()
                .rev()
                .find_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        });
    {
        let conn = st.conn();
        let _ = match &parsed {
            Some(j) => db::set_meta(
                &conn,
                id,
                j["title"].as_str(),
                j["channel"].as_str().or(j["uploader"].as_str()),
                j["duration"].as_f64(),
                j["thumbnail"].as_str(),
                j["filesize"]
                    .as_f64()
                    .or(j["filesize_approx"].as_f64())
                    .map(|n| n as i64),
                true,
            ),
            None => db::set_meta(&conn, id, None, None, None, None, None, false),
        };
    }
    emit_video(&app, &st, id);
}

/// 재생목록 링크를 영상 ID 목록으로 펼친다.
pub async fn expand_playlist(list_id: &str) -> Result<Vec<String>, String> {
    let out = tools::ytdlp()
        .args([
            "--flat-playlist",
            "--no-warnings",
            "--encoding",
            "utf-8",
            "--print",
            "id",
            "--",
            &crate::url_parser::playlist_url(list_id),
        ])
        .output()
        .await
        .map_err(|e| format!("yt-dlp를 실행할 수 없습니다: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(err.lines().last().unwrap_or("재생목록을 읽지 못했습니다").to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| crate::url_parser::is_video_id(l))
        .map(String::from)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(format_args("1080")[1].contains("height<=1080"));
        assert!(format_args("audio").contains(&"-x".to_string()));
    }
}
