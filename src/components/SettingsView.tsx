import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useStore } from "../store";
import { FILENAME_PRESETS, QUALITY_OPTIONS, type Settings, type ToolStatus } from "../types";

/** 파일명 템플릿 미리보기 (예시 값으로 대충 치환) */
function previewName(tpl: string) {
  const sample: Record<string, string> = {
    title: "영상 제목",
    id: "dQw4w9WgXcQ",
    channel: "채널명",
    uploader: "채널명",
    ext: "mp4",
  };
  return tpl
    .replace(/%\(upload_date>[^)]*\)s/g, "2026-11-04")
    .replace(/%\(upload_date\)s/g, "20261104")
    .replace(/%\((\w+)\)s/g, (_, k) => sample[k] ?? k);
}

export function SettingsView() {
  const saved = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [draft, setDraft] = useState<Settings | null>(saved);
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => setDraft(saved), [saved]);
  useEffect(() => {
    api.checkTools().then(setTools);
  }, []);

  if (!draft) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const preset = FILENAME_PRESETS.find((p) => p.value === draft.filenameTemplate);
  const upd = (p: Partial<Settings>) => setDraft({ ...draft, ...p });

  async function pickFolder() {
    const dir = await open({ directory: true, defaultPath: draft!.outputDir });
    if (typeof dir === "string") upd({ outputDir: dir });
  }

  async function save() {
    try {
      setSettings(await api.saveSettings(draft!));
      setMsg("저장했습니다.");
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div className="view settings">
      <label className="field">
        <span>저장 폴더</span>
        <div className="inline">
          <input value={draft.outputDir} onChange={(e) => upd({ outputDir: e.target.value })} />
          <button onClick={pickFolder}>폴더 선택…</button>
        </div>
      </label>

      <label className="field">
        <span>기본 화질</span>
        <select value={draft.defaultQuality} onChange={(e) => upd({ defaultQuality: e.target.value })}>
          {QUALITY_OPTIONS.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
        <small>새로 추가하는 영상에 적용됩니다. 대기열에서 영상마다 바꿀 수 있습니다.</small>
      </label>

      <label className="field">
        <span>파일명 규칙</span>
        <div className="inline">
          <select
            value={preset ? preset.value : "custom"}
            onChange={(e) => e.target.value !== "custom" && upd({ filenameTemplate: e.target.value })}
          >
            {FILENAME_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="custom">직접 입력</option>
          </select>
          <input
            className="mono"
            value={draft.filenameTemplate}
            onChange={(e) => upd({ filenameTemplate: e.target.value })}
          />
        </div>
        <small>
          미리보기: <code>{previewName(draft.filenameTemplate)}</code> · 쓸 수 있는 항목: %(title)s, %(id)s,
          %(channel)s, %(upload_date)s, %(ext)s
        </small>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={draft.saveThumbnail}
          onChange={(e) => upd({ saveThumbnail: e.target.checked })}
        />
        썸네일 이미지도 함께 저장 (.jpg)
      </label>

      <label className="field narrow">
        <span>동시 다운로드 수</span>
        <input
          type="number"
          min={1}
          max={8}
          value={draft.concurrency}
          onChange={(e) => upd({ concurrency: Number(e.target.value) })}
        />
        <small>선택한 영상이 이보다 많으면 나머지는 '다운로드 대기'로 순서를 기다립니다.</small>
      </label>

      <div className="toolbar">
        <button className="primary" onClick={save} disabled={!dirty}>
          설정 저장
        </button>
        {dirty && <button onClick={() => setDraft(saved)}>되돌리기</button>}
        {msg && !dirty && <span className="dim">{msg}</span>}
      </div>

      <div className="tools">
        <div>
          yt-dlp:{" "}
          {tools == null ? "확인 중…" : tools.ytdlp ? <b>{tools.ytdlp}</b> : <b className="err-text">찾을 수 없음</b>}
        </div>
        <div>
          ffmpeg:{" "}
          {tools == null ? "확인 중…" : tools.ffmpeg ? <b>사용 가능</b> : <b className="err-text">찾을 수 없음</b>}
        </div>
      </div>
    </div>
  );
}
