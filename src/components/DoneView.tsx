import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { useStore } from "../store";
import { fmtBytes, fmtDate, fmtDuration, thumbUrl } from "../format";
import { QUALITY_OPTIONS, type Video } from "../types";

const qualityLabel = (q: string) => QUALITY_OPTIONS.find((o) => o.value === q)?.label ?? q;

export function DoneView() {
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const done = useStore(useShallow((s) => Object.values(s.videos).filter((v) => v.status === "done")));
  const remove = useStore((s) => s.remove);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return done
      .filter((v) => !q || `${v.title ?? ""} ${v.channel ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  }, [done, query]);

  async function tryOpen(fn: () => Promise<void>) {
    try {
      await fn();
      setMsg(null);
    } catch (e) {
      setMsg(`파일을 열 수 없습니다. 옮겨졌거나 삭제됐을 수 있습니다. (${e})`);
    }
  }

  async function removeOne(v: Video) {
    await api.remove([v.id]);
    remove([v.id]);
  }

  return (
    <div className="view">
      <div className="toolbar">
        <input
          className="search"
          placeholder="제목·채널 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="spacer" />
        <span className="counts">완료 {done.length}개</span>
      </div>
      {msg && <div className="notice error">{msg}</div>}
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
                <button
                  className="ghost"
                  title="목록에서 제거 (파일은 지우지 않음 · 제거하면 다시 추가할 수 있음)"
                  onClick={() => removeOne(v)}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
