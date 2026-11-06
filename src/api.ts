import { invoke } from "@tauri-apps/api/core";
import type { AddResult, Settings, ToolStatus, Video } from "./types";

export const api = {
  listVideos: () => invoke<Video[]>("list_videos"),
  /** expandPlaylists: 재생목록 안의 영상 링크를 재생목록 전체로 펼칠지 */
  addLinks: (text: string, expandPlaylists = false) => invoke<AddResult>("add_links", { text, expandPlaylists }),
  /** 붙여넣기 안의 '재생목록 안의 영상' 링크 (재생목록마다 하나) */
  playlistVideoLinks: (text: string) => invoke<string[]>("playlist_video_links", { text }),
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
  /** 대기열 항목에서 구간 항목을 만들어 대기열에 넣는다 (받을 때 그 구간만 받음) */
  addClip: (id: number, start: number, end: number, precise: boolean) =>
    invoke<Video>("add_clip", { id, start, end, precise }),
  /** 완료한 파일을 미리보기로 열 수 있게 하고 경로를 돌려준다 */
  allowPreview: (id: number) => invoke<string>("allow_preview", { id }),
  /** 완료한 파일에서 구간을 잘라 새 파일로 저장한다 (진행률은 cut-progress 이벤트) */
  cutDoneVideo: (id: number, start: number, end: number, precise: boolean) =>
    invoke<Video>("cut_done_video", { id, start, end, precise }),
  cancelCut: (id: number) => invoke<void>("cancel_cut", { id }),
  /** 로그 폴더를 Finder/탐색기로 연다 */
  openLogFolder: () => invoke<void>("open_log_folder"),
};
