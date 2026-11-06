import { confirm, message } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { useStore } from "./store";
import type { Video } from "./types";
import { toast } from "./toast";

/** 목록에서 제거하기 전에 확인을 받는다. 받은 파일은 지우지 않는다는 점도 알린다. */
export async function confirmRemove(videos: Video[]): Promise<boolean> {
  if (!videos.length) return false;
  const head =
    videos.length === 1
      ? `Remove "${videos[0].title ?? videos[0].url}" from the list?`
      : `Remove ${videos.length} videos from the list?`;
  const lines = [head, "", "Downloaded files are not deleted."];
  if (videos.some((v) => v.status === "downloading" || v.status === "queued"))
    lines.push("Videos that are downloading or queued will be stopped.");
  return confirm(lines.join("\n"), { title: "Remove from list", kind: "warning", okLabel: "Remove", cancelLabel: "Cancel" });
}

/** 대기열 항목을 확인을 받고 목록에서 제거한다 */
export async function removeVideos(ids: number[]) {
  const all = useStore.getState().videos;
  if (!(await confirmRemove(ids.map((id) => all[id]).filter(Boolean)))) return;
  await api.remove(ids);
  useStore.getState().remove(ids);
}

/**
 * 완료 영상 제거: 목록에서만 지울지, 받은 파일도 휴지통으로 보낼지 묻는다.
 * 실수로 Enter를 눌러도 파일이 지워지지 않도록 기본 버튼은 '목록에서만'.
 */
export async function askRemoveDone(videos: Video[]): Promise<"list" | "trash" | null> {
  if (!videos.length) return null;
  const one = videos.length === 1;
  const LIST = "Remove from list only";
  const TRASH = one ? "Move file to Trash" : "Move files to Trash";
  const text = [
    one ? `Remove "${videos[0].title ?? videos[0].url}"?` : `Remove ${videos.length} videos?`,
    "",
    `${LIST}: the downloaded ${one ? "file stays" : "files stay"} where ${one ? "it is" : "they are"}.`,
    `${TRASH}: the video ${one ? "file and its thumbnail" : "files and their thumbnails"} also go to the Trash, where you can still restore them.`,
  ].join("\n");
  const r = await message(text, {
    title: one ? "Remove video" : "Remove videos",
    kind: "warning",
    buttons: { yes: LIST, no: TRASH, cancel: "Cancel" },
  });
  return r === LIST ? "list" : r === TRASH ? "trash" : null;
}

/**
 * 완료 영상을 물어보고 제거한다. 휴지통으로 보내다 실패한 항목은 목록에 남긴다.
 */
export async function removeDoneVideos(ids: number[]) {
  const all = useStore.getState().videos;
  const videos = ids.map((id) => all[id]).filter(Boolean);
  const choice = await askRemoveDone(videos);
  if (!choice) return;

  if (choice === "list") {
    try {
      await api.remove(ids);
    } catch (e) {
      toast(String(e), "error");
      return;
    }
    useStore.getState().remove(ids);
    return;
  }

  // 휴지통: 하나씩 보내고, 된 것만 목록에서 뺀다
  const done: number[] = [];
  const failed: string[] = [];
  for (const video of videos) {
    try {
      await api.trashDoneVideo(video.id);
      done.push(video.id);
    } catch (e) {
      failed.push(`${video.title ?? video.url}: ${e}`);
    }
  }
  useStore.getState().remove(done);
  if (failed.length) {
    toast(failed.length === 1 ? failed[0] : `${failed.length} files couldn't be moved to the Trash. ${failed[0]}`, "error");
  } else {
    toast(done.length === 1 ? "Moved the file to the Trash" : `Moved ${done.length} files to the Trash`);
  }
}
