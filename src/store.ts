import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import type { Progress, Settings, Video } from "./types";
import { toast } from "./toast";

interface AppStore {
  videos: Record<number, Video>;
  /** 진행률은 따로 보관해서, 바뀔 때 해당 줄만 다시 그린다 */
  progress: Record<number, Progress>;
  /** 대기열에서 체크한 항목 */
  selected: Record<number, true>;
  settings: Settings | null;
  /** YouTube가 요청을 제한해서 영상 정보 조회를 쉬는 중이면 다시 시작하는 시각(밀리초) */
  metaPausedUntil: number | null;
  upsert: (vs: Video[]) => void;
  remove: (ids: number[]) => void;
  setSelected: (ids: number[], on: boolean) => void;
  setSettings: (s: Settings) => void;
}

export const useStore = create<AppStore>((set) => ({
  videos: {},
  progress: {},
  selected: {},
  settings: null,
  metaPausedUntil: null,
  upsert: (vs) =>
    set((state) => {
      const videos = { ...state.videos };
      let { progress, selected } = state;
      for (const video of vs) {
        videos[video.id] = video;
        if (video.status !== "downloading" && progress[video.id]) {
          progress = { ...progress };
          delete progress[video.id];
        }
        // 방금 완료되면 대기열에서 빠지므로 선택도 해제 (done 탭의 선택은 그대로)
        if (video.status === "done" && state.videos[video.id]?.status !== "done" && selected[video.id]) {
          selected = { ...selected };
          delete selected[video.id];
        }
      }
      return { videos, progress, selected };
    }),
  remove: (ids) =>
    set((state) => {
      const videos = { ...state.videos };
      const progress = { ...state.progress };
      const selected = { ...state.selected };
      for (const id of ids) {
        delete videos[id];
        delete progress[id];
        delete selected[id];
      }
      return { videos, progress, selected };
    }),
  setSelected: (ids, on) =>
    set((state) => {
      const selected = { ...state.selected };
      for (const id of ids) {
        if (on) selected[id] = true;
        else delete selected[id];
      }
      return { selected };
    }),
  setSettings: (settings) => set({ settings }),
}));

let initialized = false;

export async function initStore() {
  if (initialized) return;
  initialized = true;
  await listen<Video>("video-updated", (e) => useStore.getState().upsert([e.payload]));
  await listen<Progress>("download-progress", (e) =>
    useStore.setState((s) =>
      s.videos[e.payload.id]?.status === "downloading"
        ? { progress: { ...s.progress, [e.payload.id]: e.payload } }
        : s,
    ),
  );
  await listen<{ untilMs: number | null }>("meta-paused", (e) => {
    const until = e.payload.untilMs;
    useStore.setState({ metaPausedUntil: until });
    if (until) toast("YouTube is limiting requests. Video info lookup is paused for a while.", "error");
  });
  const [videos, settings] = await Promise.all([api.listVideos(), api.getSettings()]);
  useStore.getState().upsert(videos);
  useStore.setState({ settings });
}
