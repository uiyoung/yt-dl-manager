// 개발용: Tauri 없이 브라우저(npm run dev)에서 화면을 확인할 수 있도록 가짜 백엔드를 붙인다.
// 실제 앱에서는 불러오지 않는다 (main.tsx 참고).
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { Settings, Video } from "./types";

const now = () => Math.floor(Date.now() / 1000);
let nextId = 1;

function mk(videoId: string, title: string, p: Partial<Video> = {}): Video {
  return {
    id: nextId++,
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    channel: "Sample channel",
    duration: 245,
    thumbnail: null,
    metaState: "ok",
    status: "ready",
    quality: "best",
    filePath: null,
    fileSize: null,
    errorMsg: null,
    createdAt: now(),
    completedAt: null,
    sizeEstimate: 30_000_000 + ((nextId * 37_000_000) % 400_000_000),
    outputDir: null,
    heights: [1080, 720, 480, 360, 240, 144],
    gotQuality: null,
    ...p,
  };
}

const videos: Video[] = [
  mk("jNQXAC9IVRw", "Me at the zoo", { status: "downloading", channel: "jawed", duration: 19, heights: [240, 144] }),
  mk("dQw4w9WgXcQ", "Video waiting in queue", { status: "queued", quality: "1080", heights: [2160, 1440, 1080, 720, 480, 360, 240, 144] }),
  mk("9bZkp7q19f0", "Video that failed with a network error", {
    status: "error",
    errorMsg: "unable to download video data: HTTP Error 403: Forbidden",
  }),
  mk("RgKAFK5djSk", "Video added but not started", { channel: "Another channel", duration: 61, outputDir: "/Users/me/Movies/Separate" }),
  mk("kJQP7kiw5Fk", "Video that became private", { status: "error", errorMsg: "[youtube] kJQP7kiw5Fk: Private video" }),
  mk("OPf0YbXqDm0", "Finished video", {
    status: "done",
    filePath: "/Users/me/Downloads/YT Downloads/Finished video [OPf0YbXqDm0].mp4",
    fileSize: 48_000_000,
    gotQuality: "1080",
    completedAt: now() - 3600,
  }),
];

let settings: Settings = {
  outputDir: "/Users/me/Downloads/YT Downloads",
  defaultQuality: "best",
  filenameTemplate: "%(title)s [%(id)s].%(ext)s",
  saveThumbnail: true,
  concurrency: 2,
};

export function installDevMock() {
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "list_videos":
          return videos;
        case "get_settings":
          return settings;
        case "save_settings":
          settings = a.settings as Settings;
          return settings;
        case "check_tools":
          return {
            ytdlp: { version: "2026.10.26 (mock)", path: "/opt/homebrew/bin/yt-dlp" },
            ffmpeg: { version: "7.1.1", path: "/opt/homebrew/bin/ffmpeg" },
            ffprobe: null,
          };
        case "playlist_video_links":
          return (String(a.text).match(/\S+/g) ?? []).filter((u) => /v=[\w-]{11}.*list=(?!RD|WL\b|LL\b)/.test(u));
        case "add_links": {
          const urls: string[] = String(a.text).match(/\S+/g) ?? [];
          const added: Video[] = [];
          const duplicates = [];
          const pasteDuplicates: string[] = [];
          const unrecognized: string[] = [];
          const seen = new Set<string>();
          if (a.expandPlaylists)
            for (const u of [...urls])
              if (/list=/.test(u)) urls.push(...["plist000001", "plist000002", "plist000003"]);
          for (const url of urls) {
            const id =
              url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)?.[1] ?? url.match(/^([\w-]{11})\.?$/)?.[1];
            if (!id) {
              if (/youtu/.test(url)) unrecognized.push(url);
              continue;
            }
            if (seen.has(id)) {
              pasteDuplicates.push(url);
              continue;
            }
            seen.add(id);
            const old = videos.find((v) => v.videoId === id);
            if (old) duplicates.push({ videoId: id, url, title: old.title, status: old.status });
            else {
              const v = mk(id, `New video ${id}`, { metaState: "pending", heights: null });
              videos.push(v);
              added.push(v);
            }
          }
          return { added, duplicates, pasteDuplicates, unrecognized, playlistErrors: [] };
        }
        case "download_videos":
        case "stop_videos": {
          const start = cmd === "download_videos";
          for (const v of videos)
            if ((a.ids as number[]).includes(v.id)) {
              if (start && (v.status === "ready" || v.status === "error"))
                Object.assign(v, { status: "queued", errorMsg: null });
              else if (!start && (v.status === "queued" || v.status === "downloading")) v.status = "ready";
              else continue;
              emit("video-updated", { ...v });
            }
          return;
        }
        case "set_output_dir": {
          const v = videos.find((x) => x.id === a.id)!;
          v.outputDir = (a.dir as string | null) ?? null;
          emit("video-updated", { ...v });
          return;
        }
        case "move_done_file": {
          const v = videos.find((x) => x.id === a.id)!;
          v.filePath = `${a.dir}/${v.filePath!.split("/").pop()}`;
          emit("video-updated", { ...v });
          return v;
        }
        case "plugin:dialog|message": {
          // confirm()은 눌린 버튼 이름을 돌려받는다
          const b = a.buttons as { OkCancelCustom?: [string, string]; YesNoCancelCustom?: [string, string, string] } | string;
          if (typeof b === "object" && b.YesNoCancelCustom) {
            const [yes, no, cancel] = b.YesNoCancelCustom;
            if (window.confirm(`${a.message}\n\nOK = ${yes}`)) return yes;
            return window.confirm(`OK = ${no}`) ? no : cancel;
          }
          const [ok, cancel] = typeof b === "object" && b.OkCancelCustom ? b.OkCancelCustom : ["Ok", "Cancel"];
          return window.confirm(String(a.message)) ? ok : cancel;
        }
        case "open_done_file":
        case "open_done_thumbnail":
          return;
        case "trash_done_video":
          videos.splice(videos.findIndex((v) => v.id === a.id), 1);
          return;
        case "remove_videos":
          for (const id of a.ids as number[]) videos.splice(videos.findIndex((v) => v.id === id), 1);
          return;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );

  // 진행률 흉내
  let pct = 0;
  setInterval(() => {
    pct = (pct + 3) % 100;
    emit("download-progress", {
      id: 1,
      stage: "downloading",
      percent: pct,
      downloaded: pct * 1e5,
      total: 1e7,
      speed: 2.4e6,
      eta: (100 - pct) / 3,
    });
  }, 500);
}
