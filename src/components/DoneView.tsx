import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { useStore } from "../store";
import { fmtBytes, fmtDate, fmtDuration, thumbUrl } from "../format";
import { sortVideos, useSort } from "../sort";
import { askRemoveDone } from "../confirmRemove";
import { copyText, toast } from "../toast";
import { QUALITY_OPTIONS, type Video } from "../types";
import { heightLabel } from "./QualitySelect";
import { RowMenu, type MenuItem } from "./RowMenu";
import { SortControl } from "./SortControl";
import { PlayIcon, TrashIcon } from "./icons";
import { actionsClass, Button, cx, emptyClass, lineControl, listClass, rowClass, thumbClass, viewClass } from "../ui";

const qualityLabel = (q: string) =>
  /^\d+$/.test(q) ? heightLabel(Number(q)) : (QUALITY_OPTIONS.find((o) => o.value === q)?.label ?? q);

async function tryOpen(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    toast(`Can't open the file: ${e}`, "error");
  }
}

async function removeOne(v: Video) {
  const choice = await askRemoveDone(v);
  if (!choice) return;
  try {
    if (choice === "trash") await api.trashDoneVideo(v.id);
    else await api.remove([v.id]);
  } catch (e) {
    toast(String(e), "error");
    return;
  }
  useStore.getState().remove([v.id]);
  if (choice === "trash") toast("Moved the file to the Trash");
}

function parentDir(p: string) {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

function menuItems(v: Video): MenuItem[] {
  return [
    { label: "Open on YouTube", onClick: () => openUrl(v.url) },
    { label: "Copy YouTube link", onClick: () => copyText(v.url, "Link copied") },
    "separator",
    {
      label: "Copy file path",
      disabled: !v.filePath,
      onClick: () => copyText(v.filePath!, "File path copied"),
    },
    {
      label: "Move to another folder…",
      disabled: !v.filePath,
      hint: "Moves the file (and thumbnail) to the folder you pick",
      onClick: async () => {
        const dir = await open({ directory: true, defaultPath: parentDir(v.filePath!), title: "Move file to" });
        if (typeof dir !== "string") return;
        try {
          await api.moveDoneFile(v.id, dir);
          toast("File moved");
        } catch (e) {
          toast(String(e), "error");
        }
      },
    },
    "separator",
    { label: "Remove…", danger: true, hint: "Remove from the list, and choose whether to keep the file", onClick: () => removeOne(v) },
  ];
}

export function DoneView() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useSort("sort.done", { key: "date", desc: true });
  const done = useStore(useShallow((s) => Object.values(s.videos).filter((v) => v.status === "done")));

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = done.filter((v) => !q || `${v.title ?? ""} ${v.channel ?? ""}`.toLowerCase().includes(q));
    return sortVideos(filtered, sort, "done");
  }, [done, query, sort]);

  return (
    <div className={viewClass}>
      <div className="flex items-center gap-2">
        <input className={cx(lineControl, "w-[260px]")} placeholder="Search title or channel" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="flex-1" />
        <SortControl sort={sort} onChange={setSort} dateLabel="Date completed" />
      </div>
      {list.length === 0 ? (
        <div className={emptyClass}>{done.length ? "No results." : "No completed downloads yet."}</div>
      ) : (
        <ul className={listClass}>
          {list.map((v) => (
            <li key={v.id} className={rowClass}>
              <button
                // 마우스를 올리면 썸네일을 밝게 하고 강조색 테두리
                className="group shrink-0 cursor-pointer rounded-[4px] leading-[0] disabled:cursor-default"
                title="Open thumbnail"
                aria-label="Open thumbnail"
                disabled={!v.filePath}
                onClick={() => tryOpen(() => api.openDoneThumbnail(v.id))}
              >
                <img
                  className={cx(
                    thumbClass,
                    "group-enabled:group-hover:outline-2 group-enabled:group-hover:outline-offset-1 group-enabled:group-hover:outline-highlight group-enabled:group-hover:brightness-[1.15]",
                  )}
                  src={thumbUrl(v.videoId)}
                  alt=""
                  loading="lazy"
                />
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="truncate font-semibold" title={v.filePath ?? ""}>
                  {v.title ?? v.url}
                </div>
                <div className="text-[12px] text-dim">
                  {[v.channel, fmtDuration(v.duration), qualityLabel(v.gotQuality ?? v.quality), fmtBytes(v.fileSize)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="text-[12px] text-dim">Completed {fmtDate(v.completedAt)}</div>
              </div>
              <div className={actionsClass}>
                {v.filePath && (
                  <>
                    <Button onClick={() => tryOpen(() => api.openDoneFile(v.id))}>
                      <PlayIcon /> Play
                    </Button>
                    <Button onClick={() => tryOpen(() => revealItemInDir(v.filePath!))}>Show in folder</Button>
                  </>
                )}
                <RowMenu items={menuItems(v)} />
                <Button
                  variant="ghost"
                  icon
                  dangerHover
                  title="Remove (choose whether to keep the file)"
                  aria-label="Remove"
                  onClick={() => removeOne(v)}
                >
                  <TrashIcon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
