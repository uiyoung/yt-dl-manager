import { confirm, message } from "@tauri-apps/plugin-dialog";
import type { Video } from "./types";

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

/**
 * 완료 영상 제거: 목록에서만 지울지, 받은 파일도 휴지통으로 보낼지 묻는다.
 * 실수로 Enter를 눌러도 파일이 지워지지 않도록 기본 버튼은 '목록에서만'.
 */
export async function askRemoveDone(v: Video): Promise<"list" | "trash" | null> {
  const LIST = "Remove from list only";
  const TRASH = "Move file to Trash";
  const text = [
    `Remove "${v.title ?? v.url}"?`,
    "",
    `${LIST}: the downloaded file stays where it is.`,
    `${TRASH}: the video file and its thumbnail also go to the Trash, where you can still restore them.`,
  ].join("\n");
  const r = await message(text, {
    title: "Remove video",
    kind: "warning",
    buttons: { yes: LIST, no: TRASH, cancel: "Cancel" },
  });
  return r === LIST ? "list" : r === TRASH ? "trash" : null;
}
