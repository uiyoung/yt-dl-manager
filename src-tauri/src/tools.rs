//! 외부 프로그램(yt-dlp, ffmpeg, deno) 찾기와 실행 준비.
//! 맥에서 Finder로 앱을 실행하면 PATH에 Homebrew 경로가 없으므로 직접 보충한다.

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

/// 시스템 PATH에 없을 수 있는 흔한 설치 위치
fn extra_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
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

/// 찾는 순서: 시스템 PATH → 흔한 설치 위치. 도구는 앱에 넣지 않고 사용자가 직접 설치한다
/// (Chocolatey, winget, Homebrew 등). 그래서 업그레이드도 그 설치 도구로 하면 앱이 바로 새 판을 쓴다.
fn ordered_dirs(path: Vec<PathBuf>, extra: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for d in path.into_iter().chain(extra) {
        if !d.as_os_str().is_empty() && !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

/// 자식 프로세스에도 같은 순서를 넘겨서, yt-dlp가 ffmpeg를 찾을 때도 같은 판을 쓰게 한다
pub fn search_path() -> OsString {
    let path = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    std::env::join_paths(ordered_dirs(path, extra_dirs())).unwrap_or_default()
}

/// 실행 파일 경로. 못 찾으면 이름만 돌려주고, 실행하면 "찾을 수 없음" 오류가 난다
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

/// 로그에 남길 명령 줄: 실제로 실행하는 파일 경로와, 터미널에 그대로 붙여넣을 수 있게 따옴표를 붙인 인자.
/// macOS/Linux는 sh 방식('…'), Windows는 PowerShell·cmd 방식("…").
pub fn command_line(name: &str, args: &[String]) -> String {
    std::iter::once(find(name).to_string_lossy().into_owned())
        .chain(args.iter().cloned())
        .map(|a| shell_quote(&a))
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote(a: &str) -> String {
    let plain = !a.is_empty()
        && a.chars().all(|c| c.is_ascii_alphanumeric() || "_@+=:,./-".contains(c));
    if plain {
        a.to_string()
    } else if cfg!(windows) {
        format!("\"{}\"", a.replace('"', "\\\""))
    } else {
        format!("'{}'", a.replace('\'', "'\\''"))
    }
}

pub fn ytdlp() -> Command {
    command("yt-dlp")
}

#[cfg(test)]
mod tests {
    use super::ordered_dirs;
    use std::path::PathBuf;

    #[test]
    fn path_comes_first_without_duplicates() {
        let p = |s: &str| PathBuf::from(s);
        let dirs = ordered_dirs(
            vec![p(r"C:\ProgramData\chocolatey\bin"), p("/usr/bin"), p("")],
            vec![p("/opt/homebrew/bin"), p("/usr/bin")],
        );
        assert_eq!(
            dirs,
            vec![p(r"C:\ProgramData\chocolatey\bin"), p("/usr/bin"), p("/opt/homebrew/bin")]
        );
    }
}

#[cfg(all(test, not(windows)))]
mod quote_tests {
    use super::shell_quote;

    #[test]
    fn quotes_only_when_needed() {
        assert_eq!(shell_quote("--no-playlist"), "--no-playlist");
        assert_eq!(shell_quote("https://youtu.be/abc?t=1"), "'https://youtu.be/abc?t=1'");
        assert_eq!(shell_quote("/Users/me/YT Downloads"), "'/Users/me/YT Downloads'");
        assert_eq!(shell_quote("%(title)s [%(id)s].%(ext)s"), "'%(title)s [%(id)s].%(ext)s'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote(""), "''");
    }
}
