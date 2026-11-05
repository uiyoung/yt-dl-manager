import { memo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { useStore } from "../store";
import { fmtBytes, fmtDuration, thumbUrl } from "../format";
import { sortVideos, useSort } from "../sort";
import { copyText, toast } from "../toast";
import { QUALITY_OPTIONS, type Video } from "../types";
import { RowMenu, type MenuItem } from "./RowMenu";
import { SortControl } from "./SortControl";
import { TrashIcon } from "./icons";

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

async function removeVideos(ids: number[]) {
  await api.remove(ids);
  useStore.getState().remove(ids);
}

function menuItems(v: Video): MenuItem[] {
  const editable = v.status === "ready" || v.status === "error";
  const items: MenuItem[] = [
    { label: "YouTube에서 열기", onClick: () => openUrl(v.url) },
    { label: "YouTube 링크 복사", onClick: () => copyText(v.url, "링크를 복사했습니다") },
    "separator",
    {
      label: "저장 폴더 변경…",
      disabled: !editable,
      hint: editable ? undefined : "받는 중이거나 순서를 기다리는 영상은 바꿀 수 없습니다",
      onClick: async () => {
        const defaultPath = v.outputDir ?? useStore.getState().settings?.outputDir;
        const dir = await open({ directory: true, defaultPath, title: "이 영상을 저장할 폴더" });
        if (typeof dir !== "string") return;
        try {
          await api.setOutputDir(v.id, dir);
          toast("저장 폴더를 바꿨습니다");
        } catch (e) {
          toast(String(e), "error");
        }
      },
    },
  ];
  if (v.outputDir)
    items.push({
      label: "기본 저장 폴더로 되돌리기",
      disabled: !editable,
      onClick: () => api.setOutputDir(v.id, null).catch((e) => toast(String(e), "error")),
    });
  if (v.errorMsg) items.push({ label: "오류 메시지 복사", onClick: () => copyText(v.errorMsg!) });
  items.push("separator", { label: "목록에서 제거", danger: true, onClick: () => removeVideos([v.id]) });
  return items;
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
  if (!v) return null;
  const size = v.sizeEstimate ? `약 ${fmtBytes(v.sizeEstimate)}` : null;
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
        <div className="meta">
          {[v.channel, fmtDuration(v.duration)].filter(Boolean).join(" · ")}
          {size && (
            <span title="최고화질 기준 예상 크기">
              {v.channel || v.duration ? " · " : ""}
              {size}
            </span>
          )}
        </div>
        {v.outputDir && (
          <div className="meta folder" title={v.outputDir}>
            저장 폴더: {v.outputDir}
          </div>
        )}
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
        <RowMenu items={menuItems(v)} />
        <button
          className="ghost icon-btn danger-hover"
          title="목록에서 제거 (받은 파일은 지우지 않음)"
          aria-label="목록에서 제거"
          onClick={() => removeVideos([v.id])}
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
});

export function QueueView() {
  const [sort, setSort] = useSort("sort.queue", { key: "date", desc: false });
  const ids = useStore(
    useShallow((s) =>
      sortVideos(
        Object.values(s.videos).filter((v) => v.status !== "done"),
        sort,
        "queue",
      ).map((v) => v.id),
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
  const lastClicked = useRef<number | null>(null);

  const idsRef = useRef(ids);
  idsRef.current = ids;

  // Shift+클릭으로 범위 선택 (지금 보이는 정렬 순서 기준)
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
        <button disabled={!counts.sel} onClick={() => removeVideos(selectedIds())} title="선택한 영상을 목록에서 제거">
          <TrashIcon /> 선택 제거
        </button>
        <span className="spacer" />
        <span className="counts">
          준비 {counts.ready} · 진행/대기 {counts.active} · 실패 {counts.failed}
        </span>
        <SortControl sort={sort} onChange={setSort} dateLabel="추가한 날짜순" />
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
