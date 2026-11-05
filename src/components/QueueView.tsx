import { memo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api";
import { useStore } from "../store";
import { fmtBytes, fmtDuration, thumbUrl } from "../format";
import { QUALITY_OPTIONS, type Video } from "../types";

const ProgressInfo = memo(function ProgressInfo({ id }: { id: number }) {
  const p = useStore((s) => s.progress[id]);
  if (!p) return <div className="status-line">시작하는 중…</div>;
  if (p.stage === "processing")
    return (
      <div className="status-line">
        <div className="bar indeterminate" />
        <span>파일 처리 중…</span>
      </div>
    );
  return (
    <div className="status-line">
      <div className="bar">
        <div className="fill" style={{ width: `${p.percent}%` }} />
      </div>
      <span className="nums">
        {p.percent.toFixed(1)}%
        {p.total ? ` · ${fmtBytes(p.total)}` : ""}
        {p.speed ? ` · ${fmtBytes(p.speed)}/s` : ""}
        {p.eta != null ? ` · ${fmtDuration(p.eta)} 남음` : ""}
      </span>
    </div>
  );
});

function StatusCell({ v }: { v: Video }) {
  switch (v.status) {
    case "downloading":
      return <ProgressInfo id={v.id} />;
    case "queued":
      return (
        <div className="status-line">
          <span className="badge pending">다운로드 대기</span>
        </div>
      );
    case "error":
      return (
        <div className="status-line error" title={v.errorMsg ?? ""}>
          <span className="badge error">실패</span>
          <span className="err-text">{v.errorMsg}</span>
        </div>
      );
    default:
      return (
        <div className="status-line">
          <span className="badge">준비</span>
        </div>
      );
  }
}

/** 상태에 따라 줄마다 하나의 주 동작 버튼 */
function RowAction({ v }: { v: Video }) {
  switch (v.status) {
    case "ready":
      return <button onClick={() => api.download([v.id])}>↓ 다운로드</button>;
    case "error":
      return (
        <button className="retry" onClick={() => api.download([v.id])}>
          ↻ 다시 시도
        </button>
      );
    case "queued":
    case "downloading":
      return <button onClick={() => api.stop([v.id])}>■ 중지</button>;
    default:
      return null;
  }
}

const QueueRow = memo(function QueueRow({
  id,
  onCheck,
}: {
  id: number;
  onCheck: (id: number, on: boolean, shift: boolean) => void;
}) {
  const v = useStore((s) => s.videos[id]);
  const checked = useStore((s) => !!s.selected[id]);
  const remove = useStore((s) => s.remove);
  if (!v) return null;
  return (
    <li className={`row status-${v.status}${checked ? " selected" : ""}`}>
      <input
        type="checkbox"
        className="row-check"
        checked={checked}
        onChange={() => {}}
        onClick={(e) => onCheck(id, !checked, e.shiftKey)}
        aria-label="선택"
      />
      <img className="thumb" src={thumbUrl(v.videoId)} alt="" loading="lazy" />
      <div className="info">
        <div className="title" title={v.title ?? v.url}>
          {v.title ?? (v.metaState === "pending" ? "정보 불러오는 중…" : v.url)}
        </div>
        <div className="meta">{[v.channel, fmtDuration(v.duration)].filter(Boolean).join(" · ")}</div>
        <StatusCell v={v} />
      </div>
      <select
        value={v.quality}
        disabled={v.status === "downloading"}
        onChange={(e) => api.setQuality(v.id, e.target.value)}
        title="화질"
      >
        {QUALITY_OPTIONS.map((q) => (
          <option key={q.value} value={q.value}>
            {q.label}
          </option>
        ))}
      </select>
      <div className="actions">
        <RowAction v={v} />
        <button
          className="ghost"
          title="목록에서 제거"
          onClick={async () => {
            await api.remove([v.id]);
            remove([v.id]);
          }}
        >
          ✕
        </button>
      </div>
    </li>
  );
});

export function QueueView() {
  const ids = useStore(
    useShallow((s) =>
      Object.values(s.videos)
        .filter((v) => v.status !== "done")
        .sort((a, b) => a.id - b.id)
        .map((v) => v.id),
    ),
  );
  const counts = useStore(
    useShallow((s) => {
      const c = { ready: 0, active: 0, failed: 0, sel: 0, selStartable: 0, selStoppable: 0 };
      for (const v of Object.values(s.videos)) {
        if (v.status === "done") continue;
        const startable = v.status === "ready" || v.status === "error";
        const stoppable = v.status === "queued" || v.status === "downloading";
        if (v.status === "ready") c.ready++;
        if (stoppable) c.active++;
        if (v.status === "error") c.failed++;
        if (s.selected[v.id]) {
          c.sel++;
          if (startable) c.selStartable++;
          if (stoppable) c.selStoppable++;
        }
      }
      return c;
    }),
  );
  const setSelected = useStore((s) => s.setSelected);
  const clearSelection = useStore((s) => s.clearSelection);
  const remove = useStore((s) => s.remove);
  const lastClicked = useRef<number | null>(null);

  const idsRef = useRef(ids);
  idsRef.current = ids;

  // Shift+클릭으로 범위 선택
  const onCheck = useRef((id: number, on: boolean, shift: boolean) => {
    const list = idsRef.current;
    const from = lastClicked.current != null ? list.indexOf(lastClicked.current) : -1;
    const to = list.indexOf(id);
    if (shift && from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      setSelected(list.slice(a, b + 1), on);
    } else {
      setSelected([id], on);
    }
    lastClicked.current = id;
  }).current;

  const selectedIds = () => {
    const sel = useStore.getState().selected;
    return idsRef.current.filter((id) => sel[id]);
  };
  const allChecked = ids.length > 0 && counts.sel === ids.length;

  return (
    <div className="view">
      <div className="toolbar">
        <label className="check select-all" title="전체 선택">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = counts.sel > 0 && !allChecked;
            }}
            onChange={() => (allChecked ? clearSelection() : setSelected(ids, true))}
            disabled={!ids.length}
          />
          {counts.sel ? `${counts.sel}개 선택` : "전체 선택"}
        </label>
        <button className="primary" disabled={!counts.selStartable} onClick={() => api.download(selectedIds())}>
          ↓ 선택 다운로드{counts.selStartable ? ` (${counts.selStartable})` : ""}
        </button>
        <button disabled={!counts.selStoppable} onClick={() => api.stop(selectedIds())}>
          ■ 선택 중지
        </button>
        <button
          disabled={!counts.sel}
          onClick={async () => {
            const sel = selectedIds();
            await api.remove(sel);
            remove(sel);
          }}
        >
          선택 제거
        </button>
        <span className="spacer" />
        <span className="counts">
          준비 {counts.ready} · 진행/대기 {counts.active} · 실패 {counts.failed}
        </span>
      </div>
      {ids.length === 0 ? (
        <div className="empty">대기열이 비어 있습니다. 위에 링크를 붙여넣어 추가하세요.</div>
      ) : (
        <ul className="list">
          {ids.map((id) => (
            <QueueRow key={id} id={id} onCheck={onCheck} />
          ))}
        </ul>
      )}
    </div>
  );
}
