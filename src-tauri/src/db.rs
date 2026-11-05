//! SQLite 저장소: 영상 목록(대기열/완료)과 설정.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: i64,
    pub video_id: String,
    pub url: String,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    /// pending | ok | failed
    pub meta_state: String,
    /// ready(추가됨, 아직 요청 안 함) | queued(다운로드 요청됨, 순서 대기)
    /// | downloading | done | error
    pub status: String,
    pub quality: String,
    pub file_path: Option<String>,
    pub file_size: Option<i64>,
    pub error_msg: Option<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    /// 정보 조회 때 받은 예상 크기(바이트, 최고화질 기준)
    pub size_estimate: Option<i64>,
    /// 이 영상만의 저장 폴더. 없으면 설정의 저장 폴더를 쓴다.
    pub output_dir: Option<String>,
    /// 이 영상이 지원하는 화질 (짧은 변 기준, 높은 순). 아직 모르면 None.
    pub heights: Option<Vec<u32>>,
    /// 실제로 받은 화질 (받은 파일에서 읽음): "1080" 같은 표시 화질 또는 "audio". 모르면 None.
    pub got_quality: Option<String>,
}

const COLS: &str = "id, video_id, url, title, channel, duration, thumbnail, meta_state, status, quality, \
                    file_path, file_size, error_msg, created_at, completed_at, size_estimate, output_dir, heights, got_quality";

fn row_to_video(r: &Row) -> rusqlite::Result<Video> {
    Ok(Video {
        id: r.get(0)?,
        video_id: r.get(1)?,
        url: r.get(2)?,
        title: r.get(3)?,
        channel: r.get(4)?,
        duration: r.get(5)?,
        thumbnail: r.get(6)?,
        meta_state: r.get(7)?,
        status: r.get(8)?,
        quality: r.get(9)?,
        file_path: r.get(10)?,
        file_size: r.get(11)?,
        error_msg: r.get(12)?,
        created_at: r.get(13)?,
        completed_at: r.get(14)?,
        size_estimate: r.get(15)?,
        output_dir: r.get(16)?,
        heights: r
            .get::<_, Option<String>>(17)?
            .and_then(|s| serde_json::from_str(&s).ok()),
        got_quality: r.get(18)?,
    })
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    init(&conn)?;
    Ok(conn)
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id TEXT NOT NULL UNIQUE,
            url TEXT NOT NULL,
            title TEXT, channel TEXT, duration REAL, thumbnail TEXT,
            meta_state TEXT NOT NULL DEFAULT 'pending',
            status TEXT NOT NULL DEFAULT 'ready',
            quality TEXT NOT NULL DEFAULT 'best',
            file_path TEXT, file_size INTEGER, error_msg TEXT,
            created_at INTEGER NOT NULL,
            completed_at INTEGER,
            size_estimate INTEGER,
            output_dir TEXT,
            heights TEXT,
            got_quality TEXT
         );
         CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )?;
    // 이전 버전으로 만든 DB에 새 열 추가
    for (col, ty) in [("size_estimate", "INTEGER"), ("output_dir", "TEXT"), ("heights", "TEXT"), ("got_quality", "TEXT")] {
        if !has_column(conn, "videos", col)? {
            conn.execute_batch(&format!("ALTER TABLE videos ADD COLUMN {col} {ty}"))?;
        }
    }
    // 앱을 다시 켜면 받던/기다리던 항목은 '준비' 상태로 (자동으로 다시 받지 않음)
    conn.execute_batch(
        "UPDATE videos SET status='ready' WHERE status IN ('queued','downloading','canceled');",
    )
}

fn has_column(conn: &Connection, table: &str, col: &str) -> rusqlite::Result<bool> {
    let mut st = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = st.query_map([], |r| r.get::<_, String>(1))?;
    for n in names {
        if n? == col {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<Video>> {
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM videos ORDER BY id"))?;
    let rows = st.query_map([], row_to_video)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Video>> {
    conn.query_row(
        &format!("SELECT {COLS} FROM videos WHERE id=?1"),
        [id],
        row_to_video,
    )
    .optional()
}

pub fn find_by_video_id(conn: &Connection, video_id: &str) -> rusqlite::Result<Option<Video>> {
    conn.query_row(
        &format!("SELECT {COLS} FROM videos WHERE video_id=?1"),
        [video_id],
        row_to_video,
    )
    .optional()
}

/// 중복이면 None. UNIQUE 제약으로 대기열/완료 목록 전체에서 중복을 막는다.
pub fn insert(
    conn: &Connection,
    video_id: &str,
    url: &str,
    quality: &str,
) -> rusqlite::Result<Option<Video>> {
    // 상태를 직접 'ready'로 넣는다. 이전 버전으로 만든 DB는 기본값이 'queued'라서
    // 기본값에 맡기면 추가하자마자 다운로드가 시작된다.
    let n = conn.execute(
        "INSERT OR IGNORE INTO videos (video_id, url, quality, status, created_at)
         VALUES (?1, ?2, ?3, 'ready', ?4)",
        params![video_id, url, quality, now()],
    )?;
    if n == 0 {
        return Ok(None);
    }
    get(conn, conn.last_insert_rowid())
}

pub fn pending_meta(conn: &Connection) -> rusqlite::Result<Vec<Video>> {
    let mut st = conn.prepare(&format!(
        "SELECT {COLS} FROM videos WHERE meta_state='pending' ORDER BY id"
    ))?;
    let rows = st.query_map([], row_to_video)?;
    rows.collect()
}

/// 아직 받지 않았는데 화질 목록을 모르는 영상 (이전 버전에서 추가한 것)
pub fn missing_heights(conn: &Connection) -> rusqlite::Result<Vec<Video>> {
    let mut st = conn.prepare(&format!(
        "SELECT {COLS} FROM videos
         WHERE heights IS NULL AND meta_state!='pending' AND status IN ('ready','error') ORDER BY id"
    ))?;
    let rows = st.query_map([], row_to_video)?;
    rows.collect()
}

/// 고른 화질이 영상에 없으면 그보다 낮은 화질 중 가장 높은 것으로 (없으면 가장 낮은 화질)
pub fn fit_quality(quality: &str, heights: &[u32]) -> String {
    match quality.parse::<u32>() {
        Ok(q) if !heights.is_empty() && !heights.contains(&q) => heights
            .iter()
            .copied()
            .filter(|h| *h <= q)
            .max()
            .or_else(|| heights.iter().copied().min())
            .map(|h| h.to_string())
            .unwrap_or_else(|| quality.to_string()),
        _ => quality.to_string(),
    }
}

/// 화질 목록 저장. 고른 화질이 영상에 없으면 맞는 화질로 바꾼다.
pub fn set_heights(conn: &Connection, id: i64, heights: &[u32]) -> rusqlite::Result<()> {
    let Some(v) = get(conn, id)? else { return Ok(()) };
    let quality = if v.status == "downloading" {
        v.quality.clone()
    } else {
        fit_quality(&v.quality, heights)
    };
    conn.execute(
        "UPDATE videos SET heights=?2, quality=?3 WHERE id=?1",
        params![id, serde_json::to_string(heights).unwrap(), quality],
    )?;
    Ok(())
}

pub fn set_meta(
    conn: &Connection,
    id: i64,
    title: Option<&str>,
    channel: Option<&str>,
    duration: Option<f64>,
    thumbnail: Option<&str>,
    size_estimate: Option<i64>,
    ok: bool,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE videos SET title=COALESCE(?2,title), channel=COALESCE(?3,channel),
            duration=COALESCE(?4,duration), thumbnail=COALESCE(?5,thumbnail),
            size_estimate=COALESCE(?6,size_estimate), meta_state=?7
         WHERE id=?1",
        params![id, title, channel, duration, thumbnail, size_estimate, if ok { "ok" } else { "failed" }],
    )?;
    Ok(())
}

/// 다운로드 요청: '준비' 또는 '실패' 항목을 순서 대기(queued)로 바꾼다.
/// 실패 항목은 이것이 곧 '다시 시도'다. 바뀌었으면 true.
pub fn request_download(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "UPDATE videos SET status='queued', error_msg=NULL
         WHERE id=?1 AND status IN ('ready','error')",
        [id],
    )?;
    Ok(n > 0)
}

/// 다운로드 요청된 항목 중 가장 먼저 요청된 것을 꺼내 '진행 중'으로 바꾼다.
pub fn claim_next(conn: &Connection) -> rusqlite::Result<Option<Video>> {
    let id: Option<i64> = conn
        .query_row(
            "SELECT id FROM videos WHERE status='queued' ORDER BY id LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let Some(id) = id else { return Ok(None) };
    conn.execute("UPDATE videos SET status='downloading' WHERE id=?1", [id])?;
    get(conn, id)
}

pub fn mark_done(
    conn: &Connection,
    id: i64,
    file_path: Option<&str>,
    file_size: Option<i64>,
    got_quality: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE videos SET status='done', file_path=?2, file_size=?3, error_msg=NULL,
            completed_at=?4, got_quality=?5 WHERE id=?1",
        params![id, file_path, file_size, now(), got_quality],
    )?;
    Ok(())
}

/// 실패 기록. 자동으로 다시 시도하지 않고, 사용자가 '다시 시도'를 누를 때까지 그대로 둔다.
pub fn mark_failed(conn: &Connection, id: i64, msg: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE videos SET status='error', error_msg=?2 WHERE id=?1",
        params![id, msg],
    )?;
    Ok(())
}

pub fn set_status(conn: &Connection, id: i64, status: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE videos SET status=?2 WHERE id=?1", params![id, status])?;
    Ok(())
}

/// 아직 시작하지 않은 다운로드 요청을 취소해 '준비'로 되돌린다.
pub fn unqueue(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "UPDATE videos SET status='ready' WHERE id=?1 AND status='queued'",
        [id],
    )?;
    Ok(n > 0)
}

pub fn set_quality(conn: &Connection, id: i64, quality: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE videos SET quality=?2 WHERE id=?1 AND status!='downloading'",
        params![id, quality],
    )?;
    Ok(())
}

/// 아직 받지 않은 영상의 저장 폴더 지정 (None이면 설정의 저장 폴더)
pub fn set_output_dir(conn: &Connection, id: i64, dir: Option<&str>) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "UPDATE videos SET output_dir=?2 WHERE id=?1 AND status IN ('ready','error')",
        params![id, dir],
    )?;
    Ok(n > 0)
}

/// 완료한 파일을 옮긴 뒤 경로 갱신
pub fn set_file_path(conn: &Connection, id: i64, path: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE videos SET file_path=?2 WHERE id=?1",
        params![id, path],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM videos WHERE id=?1", [id])?;
    Ok(())
}

// ---------- 설정 ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub output_dir: String,
    /// best | 2160 | 1440 | 1080 | 720 | 480 | audio
    pub default_quality: String,
    pub filename_template: String,
    pub save_thumbnail: bool,
    pub concurrency: u32,
}

impl Default for Settings {
    fn default() -> Self {
        let dir = dirs::download_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_default()
            .join("YT Downloads");
        Self {
            output_dir: dir.to_string_lossy().into_owned(),
            default_quality: "best".into(),
            filename_template: "%(title)s [%(id)s].%(ext)s".into(),
            save_thumbnail: true,
            concurrency: 2,
        }
    }
}

pub fn load_settings(conn: &Connection) -> Settings {
    conn.query_row("SELECT value FROM settings WHERE key='app'", [], |r| {
        r.get::<_, String>(0)
    })
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or_default()
}

pub fn save_settings(conn: &Connection, s: &Settings) -> rusqlite::Result<()> {
    let json = serde_json::to_string(s).unwrap();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('app', ?1)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [json],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        c
    }

    #[test]
    fn duplicate_insert_is_ignored_in_any_status() {
        let c = mem();
        let v = insert(&c, "aaaaaaaaaaa", "u", "best").unwrap().unwrap();
        assert!(insert(&c, "aaaaaaaaaaa", "u2", "720").unwrap().is_none());
        mark_done(&c, v.id, Some("/x.mp4"), Some(1), Some("720")).unwrap();
        assert!(insert(&c, "aaaaaaaaaaa", "u", "best").unwrap().is_none());
        delete(&c, v.id).unwrap();
        assert!(insert(&c, "aaaaaaaaaaa", "u", "best").unwrap().is_some());
    }

    #[test]
    fn only_requested_items_are_downloaded() {
        let c = mem();
        let a = insert(&c, "aaaaaaaaaaa", "u", "best").unwrap().unwrap();
        let b = insert(&c, "bbbbbbbbbbb", "u", "best").unwrap().unwrap();
        assert_eq!(a.status, "ready");
        assert!(claim_next(&c).unwrap().is_none(), "추가만 한 항목은 받지 않음");

        assert!(request_download(&c, b.id).unwrap());
        assert_eq!(claim_next(&c).unwrap().unwrap().id, b.id, "선택한 항목만 받음");
        assert!(claim_next(&c).unwrap().is_none());
        assert!(!request_download(&c, b.id).unwrap(), "진행 중 항목은 다시 요청 불가");

        assert!(request_download(&c, a.id).unwrap());
        assert!(unqueue(&c, a.id).unwrap());
        assert!(claim_next(&c).unwrap().is_none(), "요청 취소한 항목은 받지 않음");
    }

    #[test]
    fn added_items_are_ready_even_with_old_schema() {
        // 이전 버전 DB: status 기본값이 'queued'
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL UNIQUE,
                url TEXT NOT NULL, title TEXT, channel TEXT, duration REAL, thumbnail TEXT,
                meta_state TEXT NOT NULL DEFAULT 'pending', status TEXT NOT NULL DEFAULT 'queued',
                quality TEXT NOT NULL DEFAULT 'best', file_path TEXT, file_size INTEGER,
                error_msg TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
                completed_at INTEGER);",
        )
        .unwrap();
        init(&c).unwrap();
        let v = insert(&c, "ddddddddddd", "u", "best").unwrap().unwrap();
        assert_eq!(v.status, "ready");
        assert!(has_column(&c, "videos", "output_dir").unwrap(), "새 열이 추가됨");
        set_meta(&c, v.id, Some("t"), None, None, None, Some(1234), true).unwrap();
        assert!(set_output_dir(&c, v.id, Some("/tmp/x")).unwrap());
        let v = get(&c, v.id).unwrap().unwrap();
        assert_eq!((v.size_estimate, v.output_dir.as_deref()), (Some(1234), Some("/tmp/x")));
        assert!(claim_next(&c).unwrap().is_none(), "추가만 하면 다운로드가 시작되지 않음");
    }

    #[test]
    fn quality_is_fitted_to_available_heights() {
        let hs = [1080, 720, 480, 360];
        assert_eq!(fit_quality("2160", &hs), "1080");
        assert_eq!(fit_quality("1440", &hs), "1080");
        assert_eq!(fit_quality("720", &hs), "720");
        assert_eq!(fit_quality("240", &hs), "360", "더 낮은 게 없으면 가장 낮은 화질");
        assert_eq!(fit_quality("best", &hs), "best");
        assert_eq!(fit_quality("audio", &hs), "audio");
        assert_eq!(fit_quality("1080", &[]), "1080");

        let c = mem();
        let v = insert(&c, "eeeeeeeeeee", "u", "2160").unwrap().unwrap();
        set_heights(&c, v.id, &hs).unwrap();
        let v = get(&c, v.id).unwrap().unwrap();
        assert_eq!((v.quality.as_str(), v.heights), ("1080", Some(hs.to_vec())));
    }

    #[test]
    fn failure_waits_for_manual_retry() {
        let c = mem();
        let v = insert(&c, "ccccccccccc", "u", "best").unwrap().unwrap();
        request_download(&c, v.id).unwrap();
        claim_next(&c).unwrap();
        mark_failed(&c, v.id, "HTTP Error 403").unwrap();
        let r = get(&c, v.id).unwrap().unwrap();
        assert_eq!((r.status.as_str(), r.error_msg.as_deref()), ("error", Some("HTTP Error 403")));
        assert!(claim_next(&c).unwrap().is_none(), "실패 항목은 자동으로 다시 받지 않음");

        // 다시 시도
        assert!(request_download(&c, v.id).unwrap());
        let r = get(&c, v.id).unwrap().unwrap();
        assert_eq!((r.status.as_str(), r.error_msg), ("queued", None));
        assert_eq!(claim_next(&c).unwrap().unwrap().id, v.id);
    }
}
