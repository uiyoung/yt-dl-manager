import { memo, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { openCut } from "./CutDialog";
import { ClipBadge } from "./QueueRow";
import { SortControl } from "./SortControl";
import { CutIcon, PlayIcon, TrashIcon } from "../icons";
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
    // 구간 파일에서 또 자르면 헷갈리므로 원본에서만
    ...(v.clipStart == null
      ? [
          {
            label: "Cut a section…",
            disabled: !v.filePath,
            hint: "Save part of this video as a new file (the original is kept)",
            onClick: () => openCut(v.id, "done"),
          },
        ]
      : []),
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

/** done 목록 한 줄 */
const DoneRow = memo(function DoneRow({
  v,
  index,
  top,
  last,
  measure,
}: {
  v: Video;
  index: number;
  /** 목록 맨 위에서부터의 위치(px) */
  top: number;
  last: boolean;
  measure: (el: HTMLElement | null) => void;
}) {
  return (
    <li
      ref={measure}
      data-index={index}
      // 보이는 줄만 그리므로 위치를 직접 잡는다. 맨 끝 줄만 아래 구분선을 뺀다
      className={cx(rowClass, "absolute inset-x-0 top-0", last ? "border-b-0" : "border-b")}
      style={{ transform: `translateY(${top}px)` }}
    >
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
          {v.clipStart != null && v.clipEnd != null && <ClipBadge v={v} />}
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
        <Button
          variant="ghost"
          icon
          disabled={v.clipStart != null || !v.filePath}
          title={v.clipStart != null ? "Cut from the original video instead" : "Cut a section"}
          aria-label="Cut a section"
          onClick={() => openCut(v.id, "done")}
        >
          <CutIcon />
        </Button>
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
  );
});

/** 줄 높이 어림값. 실제 높이는 그린 뒤 재서 맞춘다 */
const ROW_HEIGHT = 84;

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
        <DoneList list={list} />
      )}
    </div>
  );
}

/**
 * 완료 영상이 몇천 개여도 느려지지 않도록 화면에 보이는 줄(과 위아래 몇 줄)만 그린다.
 * 스크롤 길이는 전체 개수만큼 잡으므로 스크롤바는 평소처럼 동작한다.
 */
function DoneList({ list }: { list: Video[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: list.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (i) => list[i].id,
    overscan: 6,
  });

  return (
    <div ref={scrollRef} className={listClass}>
      <ul className="relative" style={{ height: virt.getTotalSize() }}>
        {virt.getVirtualItems().map((item) => (
          <DoneRow
            key={item.key}
            v={list[item.index]}
            index={item.index}
            top={item.start}
            last={item.index === list.length - 1}
            measure={virt.measureElement}
          />
        ))}
      </ul>
    </div>
  );
}
