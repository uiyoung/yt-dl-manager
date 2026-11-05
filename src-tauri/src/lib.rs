mod commands;
mod db;
mod queue;
mod tools;
mod url_parser;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&data_dir.join("library.db"))?;
            let state = Arc::new(queue::AppState::new(conn));
            app.manage(state.clone());

            let handle = app.handle().clone();
            // 정보를 아직 못 가져온 항목(이전 실행에서 남은 것) 다시 조회
            if let Ok(pending) = db::pending_meta(&state.conn()) {
                for v in pending {
                    tauri::async_runtime::spawn(queue::fetch_meta(
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
            commands::download_videos,
            commands::stop_videos,
            commands::set_quality,
            commands::set_output_dir,
            commands::move_done_file,
            commands::remove_videos,
            commands::get_settings,
            commands::save_settings,
            commands::check_tools,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
