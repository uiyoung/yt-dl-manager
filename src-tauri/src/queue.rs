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
    let got = match &outcome {
        Outcome::Done(Some(p)) => probe_quality(p).await,
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
    if s.save_thumbnail {
        // 변환 없이 원본 그대로 저장한다. yt-dlp는 해상도 높은 썸네일부터 차례로 시도해
        // 처음 있는 것을 받는다 (같은 크기면 webp가 앞이고, 큰 webp가 없으면 그 크기의 jpg).
        a.push("--write-thumbnail".into());
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
        return Outcome::Failed(format!("Can't create the save folder: {e}"));
    }
    let mut child = match tools::ytdlp().args(build_args(v, s)).spawn() {
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
                Ok(st) => Outcome::Failed(pick_error(&errs, st.code())),
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
            "-O",
            "%(formats.:.{width,height,vcodec,ext,format_note})j",
            "--",
            &url,
        ])
        .output()
        .await;
    // 첫 줄은 영상 정보(객체), 둘째 줄은 형식 목록(배열)
    let mut parsed = None;
    let mut heights = None;
    if let Some(o) = out.ok().filter(|o| o.status.success()) {
        for line in String::from_utf8_lossy(&o.stdout).lines() {
            match serde_json::from_str::<serde_json::Value>(line) {
                Ok(j @ serde_json::Value::Object(_)) => parsed = Some(j),
                Ok(serde_json::Value::Array(fs)) => heights = Some(video_heights(&fs)),
                _ => {}
            }
        }
    }
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
        if let Some(hs) = heights.filter(|h| !h.is_empty()) {
            let _ = db::set_heights(&conn, id, &hs);
        }
    }
    emit_video(&app, &st, id);
}

/// 받은 파일의 실제 화질을 읽는다: 표시 화질("1080" 등) 또는 영상이 없으면 "audio".
/// ffprobe를 못 찾거나 읽지 못하면 None.
pub async fn probe_quality(path: &str) -> Option<String> {
    let out = tools::command("ffprobe")
        .args([
            "-v", "error",
            // V = 영상 스트림만 (커버 이미지 제외)
            "-select_streams", "V:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0",
            "--",
            path,
        ])
        .output()
        .await
        .ok()
        .filter(|o| o.status.success())?;
    quality_from_probe(&String::from_utf8_lossy(&out.stdout))
}

/// ffprobe 출력("1920,1080")을 표시 화질로. 영상 스트림이 없으면(빈 출력) "audio".
fn quality_from_probe(out: &str) -> Option<String> {
    let line = out.lines().map(str::trim).find(|l| !l.is_empty());
    let Some(line) = line else { return Some("audio".into()) };
    let mut it = line.split(',').map(|x| x.trim().parse::<u32>().ok());
    let (w, h) = (it.next()??, it.next()??);
    standard_height(w.min(h)).map(|h| h.to_string())
}

/// YouTube가 쓰는 표준 화질 단계
const STANDARD_HEIGHTS: [u32; 9] = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

/// 짧은 변 길이를 YouTube 표시 화질로 맞춘다 (그 이하 중 가장 높은 표준 단계).
/// 예: 1080x608 → 480p, 2880x1800 → 1440p
fn standard_height(short_side: u32) -> Option<u32> {
    STANDARD_HEIGHTS.iter().copied().find(|h| *h <= short_side)
}

/// 형식 목록에서 실제 영상 화질만 골라 YouTube 표시 화질로 정리한다 (높은 순, 중복 없음).
/// 오디오 전용, 미리보기 이미지(storyboard)는 뺀다.
pub fn video_heights(formats: &[serde_json::Value]) -> Vec<u32> {
    let mut hs: Vec<u32> = formats
        .iter()
        .filter(|f| {
            let vcodec = f["vcodec"].as_str().unwrap_or("none");
            vcodec != "none"
                && f["ext"].as_str() != Some("mhtml")
                && !f["format_note"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains("storyboard")
        })
        .filter_map(|f| {
            let h = f["height"].as_u64()?;
            let w = f["width"].as_u64().unwrap_or(h);
            standard_height(w.min(h) as u32)
        })
        .collect();
    hs.sort_unstable_by(|a, b| b.cmp(a));
    hs.dedup();
    hs
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
        .map_err(|e| format!("Can't run yt-dlp: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(err.lines().last().unwrap_or("Couldn't read the playlist").to_string());
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
    fn heights_from_formats() {
        let fs: Vec<serde_json::Value> = serde_json::from_str(
            r#"[
              {"ext":"mhtml","vcodec":"none","width":48,"height":27,"format_note":"storyboard"},
              {"ext":"m4a","vcodec":"none","format_note":"medium"},
              {"ext":"mp4","vcodec":"avc1","width":1920,"height":1080},
              {"ext":"webm","vcodec":"vp9","width":1920,"height":1080},
              {"ext":"mp4","vcodec":"avc1","width":1280,"height":720},
              {"ext":"mp4","vcodec":"avc1","width":1080,"height":1920},
              {"ext":"mp4","vcodec":"avc1","width":2880,"height":1800},
              {"ext":"mp4","vcodec":"avc1","width":608,"height":1080}
            ]"#,
        )
        .unwrap();
        // 세로 1080x1920 → 1080, 2880x1800 → 1440, 608x1080 → 480 (YouTube 표시와 같게)
        assert_eq!(video_heights(&fs), vec![1440, 1080, 720, 480]);
    }

    #[test]
    fn quality_formats() {
        assert_eq!(format_args("best")[1], "bv*+ba/b");
        assert!(format_args("1080").contains(&"res:1080".to_string()));
        assert!(format_args("audio").contains(&"-x".to_string()));
    }

    #[test]
    fn quality_from_ffprobe() {
        assert_eq!(quality_from_probe("1920,1080\n").as_deref(), Some("1080"));
        assert_eq!(quality_from_probe("1080,1920\n").as_deref(), Some("1080"), "세로 영상");
        assert_eq!(quality_from_probe("1080,608\n").as_deref(), Some("480"));
        assert_eq!(quality_from_probe("").as_deref(), Some("audio"));
        assert_eq!(quality_from_probe("N/A,N/A").as_deref(), None);
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
