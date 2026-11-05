import { message } from "@tauri-apps/plugin-dialog";

/**
 * 재생목록 안의 영상 링크(watch?v=…&list=…)를 추가할 때 무엇을 넣을지 묻는다.
 * 실수로 Enter를 눌러도 영상이 잔뜩 들어가지 않도록 기본 버튼은 '이 영상만'.
 */
export async function askPlaylist(urls: string[]): Promise<"video" | "playlist" | null> {
  const VIDEO = urls.length === 1 ? "Only this video" : "Only these videos";
  const LIST = urls.length === 1 ? "Whole playlist" : "Whole playlists";
  const head =
    urls.length === 1
      ? "This link points to a video inside a playlist."
      : `${urls.length} links point to videos inside playlists.`;
  const text = [
    head,
    "",
    `${VIDEO}: add just the linked video.`,
    `${LIST}: add every video in the playlist.`,
    "",
    ...urls.slice(0, 5),
    ...(urls.length > 5 ? [`…and ${urls.length - 5} more`] : []),
  ].join("\n");
  const r = await message(text, {
    title: "Add playlist?",
    kind: "info",
    buttons: { yes: VIDEO, no: LIST, cancel: "Cancel" },
  });
  return r === VIDEO ? "video" : r === LIST ? "playlist" : null;
}
