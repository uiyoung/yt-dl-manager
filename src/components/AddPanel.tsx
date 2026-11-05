import { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { AddResult } from "../types";

function summarize(r: AddResult): { text: string; tone: "ok" | "warn" | "error" } {
  const parts: string[] = [];
  if (r.added.length) parts.push(`${r.added.length}개 추가`);
  if (r.duplicates.length) {
    const queued = r.duplicates.filter((d) => d.status !== "done").length;
    const done = r.duplicates.length - queued;
    const where = [queued && `대기열 ${queued}`, done && `완료 ${done}`].filter(Boolean).join(", ");
    parts.push(`${r.duplicates.length}개는 이미 있어서 건너뜀 (${where})`);
  }
  if (r.pasteDuplicates) parts.push(`붙여넣기 안 중복 ${r.pasteDuplicates}개`);
  if (r.unrecognized.length) parts.push(`인식하지 못한 링크 ${r.unrecognized.length}개`);
  parts.push(...r.playlistErrors);
  if (!parts.length) return { text: "YouTube 링크를 찾지 못했습니다.", tone: "error" };
  return { text: parts.join(" · "), tone: r.added.length ? "ok" : "warn" };
}

export function AddPanel() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: string } | null>(null);
  const upsert = useStore((s) => s.upsert);

  async function add() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api.addLinks(text);
      upsert(r.added);
      setNotice(summarize(r));
      if (r.added.length || r.duplicates.length) setText("");
    } catch (e) {
      setNotice({ text: String(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="add-panel">
      <div className="add-row">
        <textarea
          value={text}
          placeholder={"YouTube 링크를 붙여넣으세요. 여러 개를 한 번에 붙여넣어도 됩니다.\n(재생목록 링크는 안의 영상들로 펼쳐서 추가합니다 · Ctrl/⌘+Enter로 추가)"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
          rows={3}
        />
        <button className="primary add-btn" onClick={add} disabled={busy || !text.trim()}>
          {busy ? "추가 중…" : "추가"}
        </button>
      </div>
      {notice && (
        <div className={`notice ${notice.tone}`}>
          <span>{notice.text}</span>
          <button className="ghost" onClick={() => setNotice(null)} aria-label="닫기">
            ✕
          </button>
        </div>
      )}
    </section>
  );
}
