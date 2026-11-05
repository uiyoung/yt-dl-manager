import { invoke } from "@tauri-apps/api/core";
import type { AddResult, Settings, ToolStatus, Video } from "./types";

export const api = {
  listVideos: () => invoke<Video[]>("list_videos"),
  addLinks: (text: string) => invoke<AddResult>("add_links", { text }),
  /** 선택한 항목 다운로드 (실패 항목은 다시 시도) */
  download: (ids: number[]) => invoke<void>("download_videos", { ids }),
  /** 받는 중이거나 순서를 기다리는 항목을 멈추고 '준비'로 되돌림 */
  stop: (ids: number[]) => invoke<void>("stop_videos", { ids }),
  setQuality: (id: number, quality: string) => invoke<void>("set_quality", { id, quality }),
  /** 아직 받지 않은 영상의 저장 폴더 (null이면 기본 폴더로) */
  setOutputDir: (id: number, dir: string | null) => invoke<void>("set_output_dir", { id, dir }),
  /** 완료한 파일을 다른 폴더로 옮김 */
  openDoneFile: (id: number) => invoke<void>("open_done_file", { id }),
  openDoneThumbnail: (id: number) => invoke<void>("open_done_thumbnail", { id }),
  moveDoneFile: (id: number, dir: string) => invoke<Video>("move_done_file", { id, dir }),
  remove: (ids: number[]) => invoke<void>("remove_videos", { ids }),
  trashDoneVideo: (id: number) => invoke<void>("trash_done_video", { id }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  checkTools: () => invoke<ToolStatus>("check_tools"),
};
