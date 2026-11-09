//! 화면(React)에서 호출하는 Tauri 명령.

use crate::db::{self, Settings, Video};
use crate::meta;
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

/// 붙여넣기 안에서 '재생목록 안의 영상' 링크를 찾는다 (재생목록마다 하나씩).
/// 추가하기 전에 재생목록 전체를 넣을지 그 영상만 넣을지 물어보는 데 쓴다.
#[tauri::command]
pub fn playlist_video_links(text: String) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    url_parser::parse_links(&text)
        .links
        .into_iter()
        .filter(|f| f.playlist.as_ref().is_some_and(|p| seen.insert(p.clone())))
        .map(|f| f.url)
        .collect()
}

#[tauri::command]
pub async fn add_links(
    app: AppHandle,
    st: St<'_>,
    text: String,
    expand_playlists: Option<bool>,
) -> Res<AddResult> {
    let expand = expand_playlists.unwrap_or(false);
    let parsed = url_parser::parse_links(&text);
    let mut paste_duplicates = parsed.paste_duplicates;
    let mut playlist_errors = Vec::new();
    // (영상 ID, 붙여넣은 주소)
    let mut ids: Vec<(String, String)> = Vec::new();
    for found in parsed.links {
        match found.link {
            // 재생목록 안의 영상 링크: 사용자가 '재생목록 전체'를 고르면 펼친다.
            // 펼치지 못하면 그 영상 하나라도 넣는다.
            Link::Video(id) => match found.playlist.filter(|_| expand) {
                Some(pid) => match meta::expand_playlist(&pid).await {
                    Ok(list) => ids.extend(list.into_iter().map(|id| {
                        let url = url_parser::video_url(&id);
                        (id, url)
                    })),
                    Err(err) => {
                        playlist_errors.push(format!("Playlist {}: {err}", found.url));
                        ids.push((id, found.url));
                    }
                },
                None => ids.push((id, found.url)),
            },
            Link::Playlist(pid) => match meta::expand_playlist(&pid).await {
                Ok(list) => ids.extend(list.into_iter().map(|id| {
                    let url = url_parser::video_url(&id);
                    (id, url)
                })),
                Err(err) => playlist_errors.push(format!("Playlist {}: {err}", found.url)),
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
        tauri::async_runtime::spawn(meta::fetch_meta(
            app.clone(),
            st.inner().clone(),
            v.id,
            v.url.clone(),
        ));
    }
    st.notify.notify_one();
    log::info!(
        "add links: {} added, {} already in list, {} repeated, {} unrecognized, {} playlist errors{}",
        added.len(),
        duplicates.len(),
        paste_duplicates.len(),
        parsed.unrecognized.len(),
        playlist_errors.len(),
        if expand { " (playlists expanded)" } else { "" }
    );
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
        return Err("Can't change the save folder of a video that is downloading or done.".into());
    }
    queue::emit_video(&app, &st, id);
    Ok(())
}

/// 완료한 파일을 기본 앱으로 연다. 화면에 경로 열기 권한을 주지 않고,
/// 앱이 기록한 이 영상의 파일만 열 수 있게 한다.
#[tauri::command]
pub fn open_done_file(app: AppHandle, st: St, id: i64) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    let v = db::get(&st.conn(), id).map_err(e)?.ok_or("Video not found.")?;
    let path = v.file_path.ok_or("No file path.")?;
    if !std::path::Path::new(&path).is_file() {
        return Err("File not found. It may have been moved or deleted.".into());
    }
    app.opener().open_path(path, None::<&str>).map_err(e)
}

/// 영상 파일과 같은 이름으로 저장된 썸네일 이미지들
fn thumbnail_files(video: &std::path::Path) -> Vec<std::path::PathBuf> {
    ["webp", "jpg", "jpeg", "png"]
        .iter()
        .map(|ext| video.with_extension(ext))
        .filter(|p| p.is_file())
        .collect()
}

/// 완료한 영상의 썸네일 파일을 기본 앱으로 연다.
#[tauri::command]
pub fn open_done_thumbnail(app: AppHandle, st: St, id: i64) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    let v = db::get(&st.conn(), id).map_err(e)?.ok_or("Video not found.")?;
    let path = v.file_path.clone().ok_or("No file path.")?;
    let mut thumbs = thumbnail_files(std::path::Path::new(&path));
    // 구간 파일은 썸네일을 따로 두지 않으므로 원본의 썸네일을 연다
    if thumbs.is_empty() {
        if let Some((start, end)) = v.clip() {
            let original = db::find_by_video_id(&st.conn(), &v.video_id)
                .map_err(e)?
                .and_then(|o| o.file_path)
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| crate::clip::path_without_label(std::path::Path::new(&path), &crate::clip::label(start, end)));
            thumbs = thumbnail_files(&original);
        }
    }
    let thumb = thumbs
        .into_iter()
        .next()
        .ok_or("Thumbnail file not found. It may not have been saved, or was moved or deleted.")?;
    app.opener()
        .open_path(thumb.to_string_lossy(), None::<&str>)
        .map_err(e)
}

/// 파일들을 휴지통으로 보낸다. macOS에서는 Finder 제어 권한 창이 뜨지 않도록 시스템 API를 쓴다.
fn move_to_trash(files: &[std::path::PathBuf]) -> Result<(), trash::Error> {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete_all(files)
}

/// 완료한 영상을 목록에서 지우면서 받은 파일과 썸네일을 휴지통으로 보낸다.
/// 영구 삭제가 아니라 휴지통이라 되살릴 수 있다. 휴지통으로 못 보내면 목록도 그대로 둔다.
#[tauri::command]
pub fn trash_done_video(st: St, id: i64) -> Res<()> {
    let v = db::get(&st.conn(), id).map_err(e)?.ok_or("Video not found.")?;
    let mut files = Vec::new();
    if let Some(p) = v.file_path.as_deref().map(std::path::Path::new) {
        if p.is_file() {
            files.push(p.to_path_buf());
        }
        files.extend(thumbnail_files(p));
    }
    if !files.is_empty() {
        move_to_trash(&files).map_err(|err| format!("Couldn't move the file to the Trash: {err}"))?;
    }
    db::delete(&st.conn(), id).map_err(e)
}

/// 완료한 파일(과 같은 이름의 썸네일)을 다른 폴더로 옮긴다.
#[tauri::command]
pub fn move_done_file(app: AppHandle, st: St, id: i64, dir: String) -> Res<Video> {
    let v = db::get(&st.conn(), id)
        .map_err(e)?
        .ok_or("Video not found.")?;
    let src = v.file_path.as_deref().ok_or("No file path.")?;
    let src = std::path::Path::new(src);
    if !src.is_file() {
        return Err("File not found. It may have been moved or deleted.".into());
    }
    let dest_dir = std::path::Path::new(&dir);
    std::fs::create_dir_all(dest_dir).map_err(e)?;
    let dest = move_file(src, dest_dir)?;
    for thumb in thumbnail_files(src) {
        let _ = move_file(&thumb, dest_dir);
    }
    let dest = dest.to_string_lossy().into_owned();
    db::set_file_path(&st.conn(), id, &dest).map_err(e)?;
    queue::emit_video(&app, &st, id);
    db::get(&st.conn(), id).map_err(e)?.ok_or_else(|| "Video not found.".into())
}

/// 같은 디스크면 이름만 바꾸고, 다른 디스크면 복사가 끝난 뒤에 원본을 지운다.
fn move_file(src: &std::path::Path, dest_dir: &std::path::Path) -> Res<std::path::PathBuf> {
    let name = src.file_name().ok_or("Invalid file path.")?;
    let dest = dest_dir.join(name);
    if dest == src {
        return Ok(dest);
    }
    if dest.exists() {
        return Err(format!("A file with the same name already exists there: {}", dest.display()));
    }
    if std::fs::rename(src, &dest).is_err() {
        std::fs::copy(src, &dest).map_err(|err| format!("Couldn't copy the file: {err}"))?;
        std::fs::remove_file(src).map_err(|err| format!("Copied, but couldn't delete the original: {err}"))?;
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

/// 찾은 도구 하나: 버전과 실제로 쓰는 실행 파일 경로
#[derive(Serialize)]
pub struct ToolInfo {
    pub version: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct ToolStatus {
    pub ytdlp: Option<ToolInfo>,
    pub ffmpeg: Option<ToolInfo>,
    pub ffprobe: Option<ToolInfo>,
}

/// 도구를 버전 옵션으로 실행해 보고, 성공하면 출력 첫 줄에서 버전을 뽑는다
async fn probe_tool(name: &str, arg: &str) -> Option<ToolInfo> {
    let out = crate::tools::command(name).arg(arg).output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Some(ToolInfo {
        version: tool_version(name, &text),
        path: crate::tools::find(name).to_string_lossy().into_owned(),
    })
}

/// yt-dlp는 버전만 출력하고, ffmpeg/ffprobe는 "ffmpeg version 7.1 Copyright ..." 꼴이다
fn tool_version(name: &str, text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    let prefix = format!("{name} version ");
    match line.strip_prefix(&prefix) {
        Some(rest) => rest.split_whitespace().next().unwrap_or("").to_string(),
        None => line.to_string(),
    }
}

#[tauri::command]
pub async fn check_tools() -> ToolStatus {
    let (ytdlp, ffmpeg, ffprobe) = tokio::join!(
        probe_tool("yt-dlp", "--version"),
        probe_tool("ffmpeg", "-version"),
        probe_tool("ffprobe", "-version"),
    );
    ToolStatus { ytdlp, ffmpeg, ffprobe }
}

// ---------- 구간 자르기 ----------

/// 대기열 항목에서 구간 항목을 하나 만들어 대기열에 넣는다. 받을 때는 그 구간만 받는다.
#[tauri::command]
pub fn add_clip(app: AppHandle, st: St, id: i64, start: f64, end: f64, precise: bool) -> Res<Video> {
    let v = db::get(&st.conn(), id).map_err(e)?.ok_or("Video not found.")?;
    crate::clip::check_range(&v, start, end)?;
    let clip = db::insert_clip(&st.conn(), &v, start, end, precise, None)
        .map_err(e)?
        .ok_or("This section is already in the list.")?;
    log::info!("clip added #{} from #{id}: {} precise={precise}", clip.id, crate::clip::label(start, end));
    // 원본 정보를 아직 못 받았으면 구간 항목도 따로 조회한다
    if clip.meta_state == "pending" {
        tauri::async_runtime::spawn(meta::fetch_meta(app.clone(), st.inner().clone(), clip.id, clip.url.clone()));
    }
    Ok(clip)
}

/// 완료한 영상 파일을 미리보기로 재생할 수 있게 그 파일 하나만 화면에 열어 준다.
#[tauri::command]
pub fn allow_preview(app: AppHandle, st: St, id: i64) -> Res<String> {
    use tauri::Manager;
    let v = db::get(&st.conn(), id).map_err(e)?.ok_or("Video not found.")?;
    let path = v.file_path.ok_or("No file path.")?;
    if !std::path::Path::new(&path).is_file() {
        return Err("File not found. It may have been moved or deleted.".into());
    }
    app.asset_protocol_scope().allow_file(&path).map_err(e)?;
    Ok(path)
}

/// 완료한 영상에서 구간을 잘라 원본 옆에 새 파일로 저장하고, 완료 목록에 구간 항목으로 넣는다.
/// 원본은 그대로 둔다. 썸네일은 따로 만들지 않는다 (원본의 썸네일을 함께 쓴다).
#[tauri::command]
pub async fn cut_done_video(app: AppHandle, st: St<'_>, id: i64, start: f64, end: f64, precise: bool) -> Res<Video> {
    let v = db::get(&st.conn(), id).map_err(e)?.ok_or("Video not found.")?;
    crate::clip::cut_file(&app, &st, &v, start, end, precise).await
}

/// 진행 중인 구간 자르기를 멈춘다
#[tauri::command]
pub fn cancel_cut(st: St, id: i64) {
    if let Some(tx) = st.cuts.lock().unwrap().remove(&id) {
        let _ = tx.send(());
    }
}

/// 로그 파일을 Finder/탐색기에서 선택한 채로 보여준다.
/// 폴더를 바로 열지 않는 이유: 로그 폴더 이름이 앱 id(com.ytdlmanager.app)라서
/// macOS가 '.app'으로 끝나는 폴더를 앱으로 보고 실행하려다 실패한다.
#[tauri::command]
pub fn open_log_folder(app: AppHandle) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = crate::paths::log_dir(&app).map_err(e)?;
    let file = dir.join("app.log");
    let target = if file.is_file() { file } else { dir };
    app.opener().reveal_item_in_dir(&target).map_err(e)
}

#[cfg(test)]
mod tests {
    use super::{move_file, thumbnail_files, tool_version};

    /// 실제 휴지통에 파일을 하나 넣으므로 평소에는 건너뛴다: cargo test -- --ignored trash
    #[test]
    #[ignore]
    fn trash_moves_files() {
        let d = std::env::temp_dir().join(format!("ytdm-trash-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("ytdm-trash-test.txt");
        std::fs::write(&f, b"test").unwrap();
        super::move_to_trash(&[f.clone()]).unwrap();
        assert!(!f.exists());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn finds_thumbnail_next_to_video() {
        let d = std::env::temp_dir().join(format!("ytdm-thumb-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let video = d.join("Mr. Bean [abc].mp4");
        std::fs::write(&video, b"v").unwrap();
        assert!(thumbnail_files(&video).is_empty());
        std::fs::write(d.join("Mr. Bean [abc].webp"), b"t").unwrap();
        std::fs::write(d.join("Other [xyz].jpg"), b"t").unwrap();
        assert_eq!(thumbnail_files(&video), vec![d.join("Mr. Bean [abc].webp")]);
        std::fs::remove_dir_all(&d).unwrap();
    }

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

    #[test]
    fn reads_tool_versions() {
        assert_eq!(tool_version("yt-dlp", "2026.10.26\n"), "2026.10.26");
        assert_eq!(
            tool_version("ffmpeg", "ffmpeg version 7.1.1 Copyright (c) 2000-2025\nbuilt with"),
            "7.1.1"
        );
        assert_eq!(tool_version("ffprobe", "ffprobe version n7.1-12-g1a2b Copyright"), "n7.1-12-g1a2b");
    }
}
