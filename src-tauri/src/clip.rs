//! 구간 자르기: 파일 이름에 붙일 구간 표시, yt-dlp·ffmpeg 인자, 완료한 영상을 ffmpeg로 자르기.

use crate::db::{self, Video};
use crate::queue::AppState;
use serde::Serialize;
use tauri::AppHandle;

/// 구간을 파일 이름에 쓸 수 있는 꼴로: 90~165초 → "1m30s-2m45s".
/// Windows에서 쓸 수 없는 ':'은 쓰지 않는다.
pub fn label(start: f64, end: f64) -> String {
    format!("{}-{}", time_label(start), time_label(end))
}

fn time_label(t: f64) -> String {
    // 소수점은 0.1초까지만 (부동소수 오차로 생기는 긴 자릿수를 막는다)
    let tenths = (t * 10.0).round() as u64;
    let (whole, frac) = (tenths / 10, tenths % 10);
    let (h, m, s) = (whole / 3600, whole / 60 % 60, whole % 60);
    let sec = if frac > 0 { format!("{s}.{frac}s") } else { format!("{s}s") };
    match (h, m) {
        (0, 0) => sec,
        (0, m) => format!("{m}m{}", pad(&sec)),
        (h, m) => format!("{h}h{m:02}m{}", pad(&sec)),
    }
}

/// 분·시 뒤의 초는 두 자리로 맞춘다 (5s → 05s)
fn pad(sec: &str) -> String {
    if sec.split('.').next().unwrap().trim_end_matches('s').len() < 2 {
        format!("0{sec}")
    } else {
        sec.to_string()
    }
}

/// 파일 이름 틀의 확장자 앞에 구간 표시를 넣는다: "%(title)s.%(ext)s" → "%(title)s (1m30s-2m45s).%(ext)s"
pub fn template_with_label(template: &str, label: &str) -> String {
    match template.strip_suffix(".%(ext)s") {
        Some(stem) => format!("{stem} ({label}).%(ext)s"),
        None => format!("{template} ({label})"),
    }
}

/// 파일 경로의 확장자 앞에 구간 표시를 넣는다: "/a/b.mp4" → "/a/b (1m30s-2m45s).mp4"
pub fn path_with_label(path: &std::path::Path, label: &str) -> std::path::PathBuf {
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let name = match path.extension() {
        Some(ext) => format!("{stem} ({label}).{}", ext.to_string_lossy()),
        None => format!("{stem} ({label})"),
    };
    path.with_file_name(name)
}

/// path_with_label의 반대: "/a/b (1m30s-2m45s).mp4" → "/a/b.mp4" (원본 파일 이름 추정)
pub fn path_without_label(path: &std::path::Path, label: &str) -> std::path::PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(name.replacen(&format!(" ({label})"), "", 1))
}

/// yt-dlp로 구간만 받는 인자.
/// 빠르게: 시작점 앞의 키프레임부터 받아 그대로 잇는다 (시작이 몇 초 앞당겨질 수 있음).
/// 정확하게: 자르는 지점에 키프레임을 새로 만든다 (다시 인코딩하므로 느림).
pub fn ytdlp_args(start: f64, end: f64, precise: bool) -> Vec<String> {
    let mut a = vec!["--download-sections".to_string(), format!("*{start}-{end}")];
    if precise {
        a.push("--force-keyframes-at-cuts".into());
    }
    a
}

/// ffmpeg로 받은 파일에서 구간을 잘라 새 파일로 저장하는 인자.
/// 빠르게: 다시 인코딩하지 않고 복사한다 (시작이 앞 키프레임으로 맞춰짐).
/// 정확하게: 다시 인코딩해 프레임 단위로 맞춘다.
pub fn ffmpeg_args(input: &str, output: &str, start: f64, end: f64, precise: bool, audio_only: bool) -> Vec<String> {
    let mut a: Vec<String> = ["-hide_banner", "-nostdin", "-n", "-loglevel", "error", "-progress", "pipe:1", "-nostats"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    a.extend(["-ss".into(), format!("{start}"), "-to".into(), format!("{end}"), "-i".into(), input.into()]);
    if precise {
        if audio_only {
            a.extend(["-map", "0:a", "-c:a", "aac", "-b:a", "192k"].map(String::from));
        } else {
            a.extend(
                ["-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", "-b:a", "192k"]
                    .map(String::from),
            );
        }
    } else {
        a.extend(["-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero"].map(String::from));
    }
    a.extend(["-movflags".into(), "+faststart".into(), output.into()]);
    a
}

// ---------- 완료한 영상 자르기 ----------

/// 구간이 올바른지 확인한다. 영상 길이를 알면 그 안에 있어야 한다.
pub fn check_range(v: &Video, start: f64, end: f64) -> Result<(), String> {
    if v.clip().is_some() {
        return Err("This is already a clip. Cut from the original video instead.".into());
    }
    if !(start.is_finite() && end.is_finite()) || start < 0.0 || end <= start {
        return Err("The end must be after the start.".into());
    }
    if end - start < 0.5 {
        return Err("The section is too short.".into());
    }
    if let Some(d) = v.duration {
        // 길이는 초 단위로 반올림돼 있어 조금 넘는 것은 봐준다
        if end > d + 1.0 {
            return Err(format!("The end is past the end of the video ({}).", label(0.0, d).split('-').nth(1).unwrap()));
        }
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CutProgress {
    id: i64,
    percent: f64,
}

/// 완료한 영상에서 구간을 잘라 원본 옆에 새 파일로 저장하고, 완료 목록에 구간 항목으로 넣는다.
/// 원본은 그대로 둔다. 썸네일은 따로 만들지 않는다 (원본의 썸네일을 함께 쓴다).
pub async fn cut_file(app: &AppHandle, st: &AppState, v: &Video, start: f64, end: f64, precise: bool) -> Result<Video, String> {
    use tauri::Emitter;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let id = v.id;
    check_range(v, start, end)?;
    let src = v.file_path.clone().ok_or("No file path.")?;
    let src = std::path::PathBuf::from(src);
    if !src.is_file() {
        return Err("File not found. It may have been moved or deleted.".into());
    }
    if db::find_clip(&st.conn(), &v.video_id, start, end).map_err(|err| err.to_string())?.is_some() {
        return Err("A clip of this section is already in the list.".into());
    }
    let label = label(start, end);
    let out = path_with_label(&src, &label);
    if out.exists() {
        return Err(format!(
            "A file with this name already exists: {}",
            out.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    let ext = src.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
    let audio_only = v.got_quality.as_deref() == Some("audio") || matches!(ext.as_str(), "m4a" | "mp3" | "opus" | "aac");
    let args = ffmpeg_args(&src.to_string_lossy(), &out.to_string_lossy(), start, end, precise, audio_only);

    log::info!("cut start #{id}: {}", crate::tools::command_line("ffmpeg", &args));
    let started = std::time::Instant::now();
    let mut child = crate::tools::command("ffmpeg").args(&args).spawn().map_err(|err| {
        log::warn!("cut #{id}: can't run ffmpeg: {err}");
        format!("Can't run ffmpeg: {err}")
    })?;
    let (tx, mut stop_rx) = tokio::sync::oneshot::channel();
    st.cuts.lock().unwrap().insert(id, tx);

    // 진행률: ffmpeg -progress 출력의 out_time_us를 구간 길이로 나눈다
    let stdout = child.stdout.take().unwrap();
    let app2 = app.clone();
    let length = end - start;
    let progress = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            if let Some(us) = l.strip_prefix("out_time_us=").and_then(|x| x.parse::<f64>().ok()) {
                let percent = (us / 1e6 / length * 100.0).clamp(0.0, 100.0);
                let _ = app2.emit("cut-progress", CutProgress { id, percent });
            }
        }
    });
    let stderr = child.stderr.take().unwrap();
    let errors = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut last = Vec::new();
        while let Ok(Some(l)) = lines.next_line().await {
            if !l.trim().is_empty() {
                last.push(l);
            }
        }
        last
    });

    let result = tokio::select! {
        status = child.wait() => match status {
            Ok(s) if s.success() => Ok(()),
            Ok(code) => {
                let errs = errors.await.unwrap_or_default();
                log::warn!("cut #{id}: ffmpeg exited with {:?}:\n{}", code.code(), errs.join("\n"));
                Err(format!("ffmpeg failed: {}", errs.last().map(String::as_str).unwrap_or("unknown error")))
            }
            Err(err) => Err(format!("ffmpeg error: {err}")),
        },
        _ = &mut stop_rx => {
            let _ = child.kill().await;
            Err("Canceled.".to_string())
        }
    };
    st.cuts.lock().unwrap().remove(&id);
    let _ = progress.await;
    match &result {
        Ok(()) => log::info!("cut done #{id} in {:.1}s → {}", started.elapsed().as_secs_f64(), out.display()),
        Err(msg) => log::info!("cut #{id} ended: {msg}"),
    }
    if let Err(msg) = result {
        let _ = std::fs::remove_file(&out); // 만들다 만 파일은 지운다
        return Err(msg);
    }

    let size = std::fs::metadata(&out).ok().map(|m| m.len() as i64);
    let clip = db::insert_clip(&st.conn(), v, start, end, precise, Some((&out.to_string_lossy(), size)))
        .map_err(|err| err.to_string())?
        .ok_or("A clip of this section is already in the list.")?;
    Ok(clip)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn labels() {
        assert_eq!(label(90.0, 165.0), "1m30s-2m45s");
        assert_eq!(label(0.0, 5.0), "0s-5s");
        assert_eq!(label(65.0, 3725.5), "1m05s-1h02m05.5s");
        assert_eq!(label(1.1000000001, 2.0), "1.1s-2s");
    }

    #[test]
    fn names_with_label() {
        assert_eq!(template_with_label("%(title)s [%(id)s].%(ext)s", "0s-5s"), "%(title)s [%(id)s] (0s-5s).%(ext)s");
        assert_eq!(template_with_label("%(title)s", "0s-5s"), "%(title)s (0s-5s)");
        assert_eq!(
            path_with_label(Path::new("/a/My video [x].mp4"), "1m30s-2m45s"),
            Path::new("/a/My video [x] (1m30s-2m45s).mp4")
        );
        assert_eq!(
            path_without_label(Path::new("/a/My video [x] (1m30s-2m45s).mp4"), "1m30s-2m45s"),
            Path::new("/a/My video [x].mp4")
        );
    }

    #[test]
    fn cut_args() {
        assert_eq!(ytdlp_args(90.0, 165.5, false), ["--download-sections", "*90-165.5"]);
        assert!(ytdlp_args(1.0, 2.0, true).contains(&"--force-keyframes-at-cuts".to_string()));
        let fast = ffmpeg_args("in.mp4", "out.mp4", 1.0, 2.0, false, false).join(" ");
        assert!(fast.contains("-ss 1 -to 2 -i in.mp4") && fast.contains("-c copy") && fast.ends_with("out.mp4"));
        let precise = ffmpeg_args("in.m4a", "out.m4a", 1.0, 2.0, true, true).join(" ");
        assert!(precise.contains("-c:a aac") && !precise.contains("libx264"));
    }
}
