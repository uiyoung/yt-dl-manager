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
    channel: "샘플 채널",
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
    ...p,
  };
}

const videos: Video[] = [
  mk("jNQXAC9IVRw", "Me at the zoo", { status: "downloading", channel: "jawed", duration: 19 }),
  mk("dQw4w9WgXcQ", "다운로드 순서를 기다리는 영상", { status: "queued", quality: "1080" }),
  mk("9bZkp7q19f0", "네트워크 오류로 실패한 영상", {
    status: "error",
    errorMsg: "unable to download video data: HTTP Error 403: Forbidden",
  }),
  mk("RgKAFK5djSk", "추가만 해둔 영상"),
  mk("kJQP7kiw5Fk", "비공개로 바뀐 영상", { status: "error", errorMsg: "[youtube] kJQP7kiw5Fk: Private video" }),
  mk("OPf0YbXqDm0", "완료된 영상", {
    status: "done",
    filePath: "/Users/me/Downloads/YT Downloads/완료된 영상 [OPf0YbXqDm0].mp4",
    fileSize: 48_000_000,
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
          return { ytdlp: "2026.10.26 (mock)", ffmpeg: true };
        case "add_links": {
          const ids = [...String(a.text).matchAll(/(?:v=|youtu\.be\/)([\w-]{11})/g)].map((m) => m[1]);
          const added: Video[] = [];
          const duplicates = [];
          for (const id of new Set(ids)) {
            const old = videos.find((v) => v.videoId === id);
            if (old) duplicates.push({ videoId: id, title: old.title, status: old.status });
            else {
              const v = mk(id, `새 영상 ${id}`);
              videos.push(v);
              added.push(v);
            }
          }
          return { added, duplicates, pasteDuplicates: ids.length - new Set(ids).size, unrecognized: [], playlistErrors: [] };
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
