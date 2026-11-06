//! 영상 정보 조회: 제목·채널·길이·화질 목록, 재생목록 펼치기, 받은 파일의 실제 화질.

use crate::db;
use crate::queue::{emit_video, AppState};
use crate::tools;
use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// YouTube는 짧은 시간에 요청이 몰리면 IP를 잠시 막는다(429, "not a bot" 확인).
// 그래서 천천히 조회하고, 막히면 한동안 쉬었다가 다시 시도한다.

pub const META_CONCURRENCY: usize = 2;
/// 조회 하나가 끝난 뒤 다음 조회까지 쉬는 시간
const META_GAP: Duration = Duration::from_millis(1500);
/// 막혔을 때 쉬는 시간
const META_BLOCK: Duration = Duration::from_secs(15 * 60);

/// yt-dlp 오류가 YouTube의 요청 제한 때문인지
fn is_rate_limited(stderr: &str) -> bool {
    let s = stderr.to_ascii_lowercase();
    ["http error 429", "too many requests", "not a bot", "rate-limited", "rate limited"]
        .iter()
        .any(|k| s.contains(k))
}

/// 정보 조회를 쉬는 중이면 남은 시간
fn meta_wait(st: &AppState) -> Option<Duration> {
    let until = (*st.meta_blocked_until.lock().unwrap())?;
    until.checked_duration_since(Instant::now())
}

/// 화면에 조회를 쉬는 중인지 알린다. until_ms는 다시 시작하는 시각(유닉스 밀리초), None이면 풀림
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetaPause {
    pub until_ms: Option<u64>,
}

fn emit_meta_pause(app: &AppHandle, wait: Option<Duration>) {
    let until_ms = wait.map(|w| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        (now + w).as_millis() as u64
    });
    let _ = app.emit("meta-paused", MetaPause { until_ms });
}

/// 정보를 조회한다. 요청 제한에 걸리면 쉬었다가 같은 영상을 다시 조회한다.
pub async fn fetch_meta(app: AppHandle, st: Arc<AppState>, id: i64, url: String) {
    let Ok(_permit) = st.meta_sem.acquire().await else { return };
    loop {
        while let Some(w) = meta_wait(&st) {
            tokio::time::sleep(w).await;
        }
        match fetch_meta_once(&url).await {
            Err(MetaError::RateLimited) => {
                log::warn!("info #{id} rate-limited by YouTube; pausing lookups for {} min", META_BLOCK.as_secs() / 60);
                let mut until = st.meta_blocked_until.lock().unwrap();
                // 이미 다른 조회가 막힘을 알렸으면 다시 알리지 않는다
                if until.map_or(true, |u| u <= Instant::now()) {
                    *until = Some(Instant::now() + META_BLOCK);
                    emit_meta_pause(&app, Some(META_BLOCK));
                }
            }
            r => {
                if let Err(MetaError::Failed(why)) = &r {
                    log::warn!("info #{id} failed for {url}: {why}");
                }
                // 쉬었다가 처음 성공하면 화면의 '쉬는 중' 표시를 지운다
                if r.is_ok() && st.meta_blocked_until.lock().unwrap().take().is_some() {
                    log::info!("info lookups resumed");
                    emit_meta_pause(&app, None);
                }
                save_meta(&st, id, r.ok());
                emit_video(&app, &st, id);
                break;
            }
        }
    }
    tokio::time::sleep(META_GAP).await;
}

enum MetaError {
    RateLimited,
    /// 실패 이유 (로그용)
    Failed(String),
}

/// (영상 정보, 화질 목록)
type Meta = (serde_json::Value, Option<Vec<u32>>);

async fn fetch_meta_once(url: &str) -> Result<Meta, MetaError> {

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
            url,
        ])
        .output()
        .await
        .map_err(|e| MetaError::Failed(format!("can't run yt-dlp: {e}")))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(if is_rate_limited(&err) {
            MetaError::RateLimited
        } else {
            MetaError::Failed(err.trim().lines().last().unwrap_or("unknown error").to_string())
        });
    }
    // 첫 줄은 영상 정보(객체), 둘째 줄은 형식 목록(배열)
    let mut parsed = None;
    let mut heights = None;
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(j @ serde_json::Value::Object(_)) => parsed = Some(j),
            Ok(serde_json::Value::Array(fs)) => heights = Some(video_heights(&fs)),
            _ => {}
        }
    }
    parsed.map(|j| (j, heights)).ok_or_else(|| MetaError::Failed("no video info in the output".into()))
}

/// 조회 결과를 저장한다. None이면 '정보 없음'으로 표시
fn save_meta(st: &AppState, id: i64, meta: Option<Meta>) {
    let (parsed, heights) = match meta {
        Some((j, h)) => (Some(j), h),
        None => (None, None),
    };
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
        .map_err(|e| log::warn!("ffprobe can't run: {e}"))
        .ok()
        .filter(|o| {
            if !o.status.success() {
                log::warn!("ffprobe failed for {path}: {}", String::from_utf8_lossy(&o.stderr).trim());
            }
            o.status.success()
        })?;
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
        log::warn!("playlist {list_id} failed:\n{}", err.trim());
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
    fn detects_rate_limit_errors() {
        assert!(is_rate_limited("ERROR: [youtube] abc: HTTP Error 429: Too Many Requests"));
        assert!(is_rate_limited("ERROR: [youtube] abc: Sign in to confirm you’re not a bot."));
        assert!(is_rate_limited("Your account has been rate-limited by YouTube for up to an hour"));
        assert!(!is_rate_limited("ERROR: [youtube] abc: Video unavailable. This video is private"));
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
    fn quality_from_ffprobe() {
        assert_eq!(quality_from_probe("1920,1080\n").as_deref(), Some("1080"));
        assert_eq!(quality_from_probe("1080,1920\n").as_deref(), Some("1080"), "세로 영상");
        assert_eq!(quality_from_probe("1080,608\n").as_deref(), Some("480"));
        assert_eq!(quality_from_probe("").as_deref(), Some("audio"));
        assert_eq!(quality_from_probe("N/A,N/A").as_deref(), None);
    }
}
