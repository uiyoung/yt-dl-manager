import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { useStore } from "../store";
import { fmtBytes, fmtDate, fmtDuration, thumbUrl } from "../format";
import { sortVideos, useSort } from "../sort";
import { copyText, toast } from "../toast";
import { QUALITY_OPTIONS, type Video } from "../types";
import { RowMenu, type MenuItem } from "./RowMenu";
import { SortControl } from "./SortControl";
import { TrashIcon } from "./icons";

const qualityLabel = (q: string) => QUALITY_OPTIONS.find((o) => o.value === q)?.label ?? q;

async function tryOpen(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    toast(`파일을 열 수 없습니다. 옮겨졌거나 삭제됐을 수 있습니다. (${e})`, "error");
  }
}

async function removeOne(v: Video) {
  await api.remove([v.id]);
  useStore.getState().remove([v.id]);
}

function parentDir(p: string) {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

function menuItems(v: Video): MenuItem[] {
  return [
    { label: "YouTube에서 열기", onClick: () => openUrl(v.url) },
    { label: "YouTube 링크 복사", onClick: () => copyText(v.url, "링크를 복사했습니다") },
    "separator",
    {
      label: "파일 경로 복사",
      disabled: !v.filePath,
      onClick: () => copyText(v.filePath!, "파일 경로를 복사했습니다"),
    },
    {
      label: "다른 폴더로 옮기기…",
      disabled: !v.filePath,
      hint: "받은 파일(과 썸네일)을 고른 폴더로 옮깁니다",
      onClick: async () => {
        const dir = await open({ directory: true, defaultPath: parentDir(v.filePath!), title: "파일을 옮길 폴더" });
        if (typeof dir !== "string") return;
        try {
          await api.moveDoneFile(v.id, dir);
          toast("파일을 옮겼습니다");
        } catch (e) {
          toast(String(e), "error");
        }
      },
    },
    "separator",
    { label: "목록에서 제거", danger: true, hint: "받은 파일은 지우지 않습니다", onClick: () => removeOne(v) },
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
    <div className="view">
      <div className="toolbar">
        <input className="search" placeholder="제목·채널 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="spacer" />
        <span className="counts">완료 {done.length}개</span>
        <SortControl sort={sort} onChange={setSort} dateLabel="완료한 날짜순" />
      </div>
      {list.length === 0 ? (
        <div className="empty">{done.length ? "검색 결과가 없습니다." : "아직 완료된 다운로드가 없습니다."}</div>
      ) : (
        <ul className="list">
          {list.map((v) => (
            <li key={v.id} className="row">
              <img className="thumb" src={thumbUrl(v.videoId)} alt="" loading="lazy" />
              <div className="info">
                <div className="title" title={v.filePath ?? ""}>
                  {v.title ?? v.url}
                </div>
                <div className="meta">
                  {[v.channel, fmtDuration(v.duration), qualityLabel(v.quality), fmtBytes(v.fileSize)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="meta dim">{fmtDate(v.completedAt)} 완료</div>
              </div>
              <div className="actions">
                {v.filePath && (
                  <>
                    <button onClick={() => tryOpen(() => openPath(v.filePath!))}>▶ 재생</button>
                    <button onClick={() => tryOpen(() => revealItemInDir(v.filePath!))}>폴더에서 보기</button>
                  </>
                )}
                <RowMenu items={menuItems(v)} />
                <button
                  className="ghost icon-btn danger-hover"
                  title="목록에서 제거 (받은 파일은 지우지 않음 · 제거하면 다시 추가할 수 있음)"
                  aria-label="목록에서 제거"
                  onClick={() => removeOne(v)}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
