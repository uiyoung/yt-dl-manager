import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from '../api';
import { useStore } from '../store';
import { getTheme, saveTheme, type Theme } from "../theme";
import { FILENAME_PRESETS, QUALITY_OPTIONS, type Settings, type ToolStatus } from '../types';

/** 파일명 템플릿 미리보기 (예시 값으로 대충 치환) */
function previewName(tpl: string) {
  const sample: Record<string, string> = {
    title: 'Video title',
    id: 'dQw4w9WgXcQ',
    channel: 'Channel name',
    uploader: 'Channel name',
    ext: 'mp4',
  };
  return tpl
    .replace(/%\(upload_date>[^)]*\)s/g, '2026-11-04')
    .replace(/%\(upload_date\)s/g, '20261104')
    .replace(/%\((\w+)\)s/g, (_, k) => sample[k] ?? k);
}

export function SettingsView() {
  const saved = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [draft, setDraft] = useState<Settings | null>(saved);
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(getTheme);

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
    if (typeof dir === 'string') {
      upd({ outputDir: dir });
    }
  }

  async function save() {
    try {
      setSettings(await api.saveSettings(draft!));
      setMsg('Saved.');
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div className='view settings'>
      <label className='field'>
        <span>Save folder</span>
        <div className='inline'>
          <input value={draft.outputDir} onChange={(e) => upd({ outputDir: e.target.value })} />
          <button onClick={pickFolder}>Choose folder…</button>
        </div>
      </label>

      <label className='field'>
        <span>Default quality</span>
        <select value={draft.defaultQuality} onChange={(e) => upd({ defaultQuality: e.target.value })}>
          {QUALITY_OPTIONS.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
        <small>
          Applies to newly added videos. If a video doesn't offer this quality, the next lower one is used. You can
          change each video's quality in the queue.
        </small>
      </label>

      <label className='field'>
        <span>Filename pattern</span>
        <div className='inline'>
          <select
            value={preset ? preset.value : 'custom'}
            onChange={(e) => e.target.value !== 'custom' && upd({ filenameTemplate: e.target.value })}
          >
            {FILENAME_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value='custom'>Custom</option>
          </select>
          <input
            className='mono'
            value={draft.filenameTemplate}
            onChange={(e) => upd({ filenameTemplate: e.target.value })}
          />
        </div>
        <small>
          Preview: <code>{previewName(draft.filenameTemplate)}</code> · Available fields: %(title)s, %(id)s,
          %(channel)s, %(upload_date)s, %(ext)s
        </small>
      </label>

      <label className='check'>
        <input
          type='checkbox'
          checked={draft.saveThumbnail}
          onChange={(e) => upd({ saveThumbnail: e.target.checked })}
        />
        Also save the thumbnail image
      </label>

      <label className='field narrow'>
        <span>Concurrent downloads</span>
        <input
          type='number'
          min={1}
          max={8}
          value={draft.concurrency}
          onChange={(e) => upd({ concurrency: Number(e.target.value) })}
        />
        <small>If you start more videos than this, the rest wait as Queued.</small>
      </label>

      <label className='field narrow'>
        <span>Theme</span>
        <select
          value={theme}
          onChange={(e) => {
            const t = e.target.value as Theme;
            setTheme(t);
            saveTheme(t);
          }}
        >
          <option value='system'>System</option>
          <option value='light'>Light</option>
          <option value='dark'>Dark</option>
        </select>
        <small>Applies right away. System follows your macOS or Windows appearance setting.</small>
      </label>

      <div className='toolbar'>
        <button className='primary' onClick={save} disabled={!dirty}>
          Save settings
        </button>
        {dirty && <button onClick={() => setDraft(saved)}>Revert</button>}
        {msg && !dirty && <span className='dim'>{msg}</span>}
      </div>

      <div className='tools'>
        <div>
          yt-dlp:{' '}
          {tools == null ? 'Checking…' : tools.ytdlp ? <b>{tools.ytdlp}</b> : <b className='err-text'>Not found</b>}
        </div>
        <div>
          ffmpeg:{' '}
          {tools == null ? 'Checking…' : tools.ffmpeg ? <b>Available</b> : <b className='err-text'>Not found</b>}
        </div>
      </div>
    </div>
  );
}
