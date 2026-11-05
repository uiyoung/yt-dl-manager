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
    /// 사용자가 붙여넣은 주소
    pub url: String,
    pub title: Option<String>,
    /// 기존 항목의 상태 (ready, done 등)
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddResult {
    pub added: Vec<Video>,
    pub duplicates: Vec<Duplicate>,
    /// 같은 붙여넣기 안에서 앞의 링크와 겹친 주소
    pub paste_duplicates: Vec<String>,
    pub unrecognized: Vec<String>,
    pub playlist_errors: Vec<String>,
}

#[tauri::command]
pub async fn add_links(app: AppHandle, st: St<'_>, text: String) -> Res<AddResult> {
    let parsed = url_parser::parse_links(&text);
    let mut paste_duplicates = parsed.paste_duplicates;
    let mut playlist_errors = Vec::new();
    // (영상 ID, 붙여넣은 주소)
    let mut ids: Vec<(String, String)> = Vec::new();
    for found in parsed.links {
        match found.link {
            Link::Video(id) => ids.push((id, found.url)),
            Link::Playlist(pid) => match queue::expand_playlist(&pid).await {
                Ok(list) => ids.extend(list.into_iter().map(|id| {
                    let url = url_parser::video_url(&id);
                    (id, url)
                })),
                Err(err) => playlist_errors.push(format!("재생목록 {}: {err}", found.url)),
            },
        }
    }
    // 재생목록을 펼친 뒤 다시 한번 붙여넣기 내부 중복 제거
    let mut seen = std::collections::HashSet::new();
    ids.retain(|(id, url)| {
        let new = seen.insert(id.clone());
        if !new {
            paste_duplicates.push(url.clone());
        }
        new
    });

    let mut added = Vec::new();
    let mut duplicates = Vec::new();
    {
        let conn = st.conn();
        let quality = db::load_settings(&conn).default_quality;
        for (id, src_url) in ids {
            match db::insert(&conn, &id, &url_parser::video_url(&id), &quality).map_err(e)? {
                Some(v) => added.push(v),
                None => {
                    if let Some(old) = db::find_by_video_id(&conn, &id).map_err(e)? {
                        duplicates.push(Duplicate {
                            video_id: id,
                            url: src_url,
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

/// 아직 받지 않은 영상의 저장 폴더 지정. dir이 None이면 설정의 기본 폴더로 되돌린다.
#[tauri::command]
pub fn set_output_dir(app: AppHandle, st: St, id: i64, dir: Option<String>) -> Res<()> {
    if !db::set_output_dir(&st.conn(), id, dir.as_deref()).map_err(e)? {
        return Err("받는 중이거나 완료된 영상은 저장 폴더를 바꿀 수 없습니다.".into());
    }
    queue::emit_video(&app, &st, id);
    Ok(())
}

/// 완료한 파일(과 같은 이름의 썸네일)을 다른 폴더로 옮긴다.
#[tauri::command]
pub fn move_done_file(app: AppHandle, st: St, id: i64, dir: String) -> Res<Video> {
    let v = db::get(&st.conn(), id)
        .map_err(e)?
        .ok_or("영상을 찾을 수 없습니다.")?;
    let src = v.file_path.as_deref().ok_or("파일 경로가 없습니다.")?;
    let src = std::path::Path::new(src);
    if !src.is_file() {
        return Err("파일이 없습니다. 이미 옮겨졌거나 삭제됐을 수 있습니다.".into());
    }
    let dest_dir = std::path::Path::new(&dir);
    std::fs::create_dir_all(dest_dir).map_err(e)?;
    let dest = move_file(src, dest_dir)?;
    // 썸네일: 같은 이름의 .jpg / .webp / .png
    for ext in ["jpg", "webp", "png"] {
        let thumb = src.with_extension(ext);
        if thumb.is_file() {
            let _ = move_file(&thumb, dest_dir);
        }
    }
    let dest = dest.to_string_lossy().into_owned();
    db::set_file_path(&st.conn(), id, &dest).map_err(e)?;
    queue::emit_video(&app, &st, id);
    db::get(&st.conn(), id).map_err(e)?.ok_or_else(|| "영상을 찾을 수 없습니다.".into())
}

/// 같은 디스크면 이름만 바꾸고, 다른 디스크면 복사가 끝난 뒤에 원본을 지운다.
fn move_file(src: &std::path::Path, dest_dir: &std::path::Path) -> Res<std::path::PathBuf> {
    let name = src.file_name().ok_or("잘못된 파일 경로입니다.")?;
    let dest = dest_dir.join(name);
    if dest == src {
        return Ok(dest);
    }
    if dest.exists() {
        return Err(format!("옮길 폴더에 같은 이름의 파일이 이미 있습니다: {}", dest.display()));
    }
    if std::fs::rename(src, &dest).is_err() {
        std::fs::copy(src, &dest).map_err(|err| format!("파일을 복사하지 못했습니다: {err}"))?;
        std::fs::remove_file(src).map_err(|err| format!("복사는 됐지만 원본을 지우지 못했습니다: {err}"))?;
    }
    Ok(dest)
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

#[cfg(test)]
mod tests {
    use super::move_file;

    #[test]
    fn move_file_refuses_to_overwrite() {
        let base = std::env::temp_dir().join(format!("ytdm-move-{}", std::process::id()));
        let (a, b) = (base.join("a"), base.join("b"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let src = a.join("v.mp4");
        std::fs::write(&src, b"x").unwrap();

        let dest = move_file(&src, &b).unwrap();
        assert!(dest.is_file() && !src.exists());

        std::fs::write(&src, b"y").unwrap();
        assert!(move_file(&src, &b).is_err(), "같은 이름이 있으면 덮어쓰지 않음");
        assert!(src.exists(), "실패하면 원본은 그대로");
        std::fs::remove_dir_all(&base).unwrap();
    }
}
