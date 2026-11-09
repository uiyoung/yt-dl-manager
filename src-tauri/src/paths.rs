//! DB와 로그를 둘 폴더.
//! 보통은 OS가 정한 앱 데이터 폴더를 쓴다.
//! Windows에서 실행 파일 옆에 `portable`(또는 `portable.txt`) 파일이 있으면 포터블 모드: 실행 파일 폴더에 둔다.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{Manager, Runtime};

/// 포터블 모드로 볼 표시 파일 이름. 탐색기에서 만들다 .txt가 붙는 경우도 받아 준다
const MARKERS: [&str; 2] = ["portable", "portable.txt"];

/// 포터블 모드면 실행 파일 폴더. 실행 중에 바뀌지 않도록 처음 한 번만 확인한다
pub fn portable_dir() -> Option<&'static Path> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(find_portable_dir).as_deref()
}

#[cfg(windows)]
fn find_portable_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    has_marker(dir).then(|| dir.to_path_buf())
}

/// macOS는 실행 파일이 .app 안에 있어서 옆에 쓸 수 없으므로 지원하지 않는다
#[cfg(not(windows))]
fn find_portable_dir() -> Option<PathBuf> {
    None
}

#[cfg_attr(not(windows), allow(dead_code))]
fn has_marker(dir: &Path) -> bool {
    MARKERS.iter().any(|name| dir.join(name).is_file())
}

/// library.db를 두는 폴더
pub fn data_dir<R: Runtime>(app: &impl Manager<R>) -> tauri::Result<PathBuf> {
    match portable_dir() {
        Some(dir) => Ok(dir.to_path_buf()),
        None => app.path().app_data_dir(),
    }
}

/// app.log를 두는 폴더
pub fn log_dir<R: Runtime>(app: &impl Manager<R>) -> tauri::Result<PathBuf> {
    match portable_dir() {
        Some(dir) => Ok(dir.join("logs")),
        None => app.path().app_log_dir(),
    }
}

#[cfg(test)]
mod tests {
    use super::has_marker;

    #[test]
    fn marker_file() {
        let dir = std::env::temp_dir().join(format!("ytdl-portable-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!has_marker(&dir));

        std::fs::write(dir.join("portable.txt"), "").unwrap();
        assert!(has_marker(&dir));
        std::fs::remove_file(dir.join("portable.txt")).unwrap();

        // 같은 이름의 폴더는 표시로 보지 않는다
        std::fs::create_dir(dir.join("portable")).unwrap();
        assert!(!has_marker(&dir));
        std::fs::remove_dir(dir.join("portable")).unwrap();

        std::fs::write(dir.join("portable"), "").unwrap();
        assert!(has_marker(&dir));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
