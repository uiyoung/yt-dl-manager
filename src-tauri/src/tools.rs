//! 외부 프로그램(yt-dlp, ffmpeg, deno) 찾기와 실행 준비.
//! 맥에서 Finder로 앱을 실행하면 PATH에 Homebrew 경로가 없으므로 직접 보충한다.

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

fn extra_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.to_path_buf()); // 앱과 함께 묶은 실행 파일
        }
    }
    #[cfg(not(windows))]
    {
        v.push("/opt/homebrew/bin".into());
        v.push("/usr/local/bin".into());
        if let Some(h) = dirs::home_dir() {
            v.push(h.join(".deno/bin"));
            v.push(h.join(".local/bin"));
        }
    }
    v
}

pub fn search_path() -> OsString {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in extra_dirs() {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

pub fn find(name: &str) -> PathBuf {
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    for dir in std::env::split_paths(&search_path()) {
        let p = dir.join(&file);
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from(file)
}

pub fn command(name: &str) -> Command {
    let mut c = Command::new(find(name));
    c.env("PATH", search_path())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        // 콘솔 창이 깜빡이지 않도록
        c.creation_flags(0x0800_0000);
    }
    c
}

pub fn ytdlp() -> Command {
    command("yt-dlp")
}
