mod clip;
mod commands;
mod db;
mod meta;
mod paths;
mod queue;
mod tools;
mod url_parser;

use std::sync::Arc;
use tauri::Manager;

/// 로그 파일: macOS ~/Library/Logs/<앱 id>/app.log, Windows %LOCALAPPDATA%\<앱 id>\logs\app.log.
/// 포터블 모드면 실행 파일 옆 logs\app.log.
/// 이 앱의 기록만 남기고(라이브러리는 경고 이상), 2MB가 넘으면 새 파일로 넘겨 최근 5개만 둔다.
fn log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
    let file_name = Some("app".to_string());
    let file = match paths::portable_dir() {
        Some(dir) => TargetKind::Folder { path: dir.join("logs"), file_name },
        None => TargetKind::LogDir { file_name },
    };
    let mut targets = vec![Target::new(file)];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(log::LevelFilter::Warn)
        .level_for("yt_dl_manager_lib", log::LevelFilter::Info)
        .max_file_size(2_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(5))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(log_plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 창 위치·크기·최대화를 닫을 때 저장하고 다음에 켤 때 되살린다.
        // 창은 숨긴 채 만들고(tauri.conf.json visible: false), 되살린 뒤 플러그인이 보여 준다
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .setup(|app| {
            let data_dir = paths::data_dir(app)?;
            std::fs::create_dir_all(&data_dir)?;
            log::info!(
                "data folder{}: {}",
                if paths::portable_dir().is_some() { " (portable)" } else { "" },
                data_dir.display()
            );

            let conn = db::open(&data_dir.join("library.db"))?;
            let state = Arc::new(queue::AppState::new(conn));
            app.manage(state.clone());

            let handle = app.handle().clone();
            // 정보를 아직 못 가져온 항목(이전 실행에서 남은 것) 다시 조회
            if let Ok(pending) = db::pending_meta(&state.conn()) {
                for v in pending {
                    tauri::async_runtime::spawn(meta::fetch_meta(
                        handle.clone(),
                        state.clone(),
                        v.id,
                        v.url,
                    ));
                }
            }
            // 이전 버전에서 추가해 화질 목록이 없는 영상도 다시 조회
            if let Ok(list) = db::missing_heights(&state.conn()) {
                for v in list {
                    tauri::async_runtime::spawn(meta::fetch_meta(
                        handle.clone(),
                        state.clone(),
                        v.id,
                        v.url,
                    ));
                }
            }
            tauri::async_runtime::spawn(queue::worker(handle, state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_videos,
            commands::add_links,
            commands::add_clip,
            commands::allow_preview,
            commands::cut_done_video,
            commands::cancel_cut,
            commands::open_log_folder,
            commands::playlist_video_links,
            commands::download_videos,
            commands::stop_videos,
            commands::set_quality,
            commands::set_output_dir,
            commands::open_done_file,
            commands::open_done_thumbnail,
            commands::move_done_file,
            commands::remove_videos,
            commands::trash_done_video,
            commands::get_settings,
            commands::save_settings,
            commands::check_tools,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
