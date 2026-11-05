import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import type { Progress, Settings, Video } from "./types";

interface AppStore {
  videos: Record<number, Video>;
  /** 진행률은 따로 보관해서, 바뀔 때 해당 줄만 다시 그린다 */
  progress: Record<number, Progress>;
  /** 대기열에서 체크한 항목 */
  selected: Record<number, true>;
  settings: Settings | null;
  upsert: (vs: Video[]) => void;
  remove: (ids: number[]) => void;
  setSelected: (ids: number[], on: boolean) => void;
  clearSelection: () => void;
  setSettings: (s: Settings) => void;
}

export const useStore = create<AppStore>((set) => ({
  videos: {},
  progress: {},
  selected: {},
  settings: null,
  upsert: (vs) =>
    set((st) => {
      const videos = { ...st.videos };
      let { progress, selected } = st;
      for (const v of vs) {
        videos[v.id] = v;
        if (v.status !== "downloading" && progress[v.id]) {
          progress = { ...progress };
          delete progress[v.id];
        }
        // 완료되면 대기열에서 빠지므로 선택도 해제
        if (v.status === "done" && selected[v.id]) {
          selected = { ...selected };
          delete selected[v.id];
        }
      }
      return { videos, progress, selected };
    }),
  remove: (ids) =>
    set((st) => {
      const videos = { ...st.videos };
      const progress = { ...st.progress };
      const selected = { ...st.selected };
      for (const id of ids) {
        delete videos[id];
        delete progress[id];
        delete selected[id];
      }
      return { videos, progress, selected };
    }),
  setSelected: (ids, on) =>
    set((st) => {
      const selected = { ...st.selected };
      for (const id of ids) {
        if (on) selected[id] = true;
        else delete selected[id];
      }
      return { selected };
    }),
  clearSelection: () => set({ selected: {} }),
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
  const [videos, settings] = await Promise.all([api.listVideos(), api.getSettings()]);
  useStore.getState().upsert(videos);
  useStore.setState({ settings });
}
