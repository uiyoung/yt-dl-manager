//! 화면(React)에서 호출하는 Tauri 명령.

use crate::db::{self, Settings, Video};
use crate::queue::{self, AppState};
use crate::url_parser::{self, Link};
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, State};

type St<'a> = State<'a, Arc<AppState>>;
type Res<T> = Result<T, String>;

fn e(err: impl std::fmt::Display) -> String {
    err.to_string()
}

#[tauri::command]
pub fn list_videos(st: St) -> Res<Vec<Video>> {
    db::list_all(&st.conn()).map_err(e)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Duplicate {
    pub video_id: String,
    pub title: Option<String>,
    /// 기존 항목의 상태 (queued, done 등)
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddResult {
    pub added: Vec<Video>,
    pub duplicates: Vec<Duplicate>,
    pub paste_duplicates: usize,
    pub unrecognized: Vec<String>,
    pub playlist_errors: Vec<String>,
}

#[tauri::command]
pub async fn add_links(app: AppHandle, st: St<'_>, text: String) -> Res<AddResult> {
    let parsed = url_parser::parse_links(&text);
    let mut paste_duplicates = parsed.paste_duplicates;
    let mut playlist_errors = Vec::new();
    let mut ids: Vec<String> = Vec::new();
    for link in parsed.links {
        match link {
            Link::Video(id) => ids.push(id),
            Link::Playlist(pid) => match queue::expand_playlist(&pid).await {
                Ok(list) => ids.extend(list),
                Err(err) => playlist_errors.push(format!("재생목록 {pid}: {err}")),
            },
        }
    }
    // 재생목록을 펼친 뒤 다시 한번 붙여넣기 내부 중복 제거
    let mut seen = std::collections::HashSet::new();
    ids.retain(|id| {
        let new = seen.insert(id.clone());
        if !new {
            paste_duplicates += 1;
        }
        new
    });

    let mut added = Vec::new();
    let mut duplicates = Vec::new();
    {
        let conn = st.conn();
        let quality = db::load_settings(&conn).default_quality;
        for id in ids {
            match db::insert(&conn, &id, &url_parser::video_url(&id), &quality).map_err(e)? {
                Some(v) => added.push(v),
                None => {
                    if let Some(old) = db::find_by_video_id(&conn, &id).map_err(e)? {
                        duplicates.push(Duplicate {
                            video_id: id,
                            title: old.title,
                            status: old.status,
                        });
                    }
                }
            }
        }
    }
    for v in &added {
        tauri::async_runtime::spawn(queue::fetch_meta(
            app.clone(),
            st.inner().clone(),
            v.id,
            v.url.clone(),
        ));
    }
    st.notify.notify_one();
    Ok(AddResult {
        added,
        duplicates,
        paste_duplicates,
        unrecognized: parsed.unrecognized,
        playlist_errors,
    })
}

/// 선택한 항목 다운로드. '준비' 항목은 다운로드를, '실패' 항목은 다시 시도를 한다.
/// 요청한 순서대로 동시 다운로드 수만큼 받는다.
#[tauri::command]
pub fn download_videos(app: AppHandle, st: St, ids: Vec<i64>) -> Res<()> {
    for id in ids {
        if db::request_download(&st.conn(), id).map_err(e)? {
            queue::emit_video(&app, &st, id);
        }
    }
    st.notify.notify_one();
    Ok(())
}

/// 선택한 항목 중지: 받는 중이거나 순서를 기다리는 항목을 '준비'로 되돌린다.
#[tauri::command]
pub fn stop_videos(app: AppHandle, st: St, ids: Vec<i64>) -> Res<()> {
    for id in ids {
        if !st.stop(id) && db::unqueue(&st.conn(), id).map_err(e)? {
            queue::emit_video(&app, &st, id);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_quality(app: AppHandle, st: St, id: i64, quality: String) -> Res<()> {
    db::set_quality(&st.conn(), id, &quality).map_err(e)?;
    queue::emit_video(&app, &st, id);
    Ok(())
}

/// 목록에서 제거(파일은 지우지 않음). 진행 중이면 먼저 취소한다.
#[tauri::command]
pub fn remove_videos(st: St, ids: Vec<i64>) -> Res<()> {
    for id in ids {
        st.stop(id);
        db::delete(&st.conn(), id).map_err(e)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_settings(st: St) -> Settings {
    db::load_settings(&st.conn())
}

#[tauri::command]
pub fn save_settings(st: St, settings: Settings) -> Res<Settings> {
    let mut s = settings;
    s.concurrency = s.concurrency.clamp(1, 8);
    if s.filename_template.trim().is_empty() {
        s.filename_template = Settings::default().filename_template;
    }
    db::save_settings(&st.conn(), &s).map_err(e)?;
    st.notify.notify_one();
    Ok(s)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub ytdlp: Option<String>,
    pub ffmpeg: bool,
}

#[tauri::command]
pub async fn check_tools() -> ToolStatus {
    let ytdlp = crate::tools::ytdlp()
        .arg("--version")
        .output()
        .await
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let ffmpeg = crate::tools::command("ffmpeg")
        .arg("-version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);
    ToolStatus { ytdlp, ffmpeg }
}
