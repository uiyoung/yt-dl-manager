import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from '../api';
import { useStore } from '../store';
import { getTheme, saveTheme, type Theme } from "../theme";
import { Button, control, cx } from '../ui';
import { FILENAME_PRESETS, QUALITY_OPTIONS, type Settings, type ToolStatus } from '../types';

const field = 'flex flex-col gap-1.5';
const narrow = 'max-w-[360px]';
const label = 'font-semibold';
// 브라우저 기본 <small> 크기(smaller)를 유지한다
const hint = 'text-dim [font-size:smaller]';

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
    // 스크롤 영역은 밖으로 나간 부분을 잘라서, 입력칸 포커스 테두리가 들어갈 자리를 좌우 안쪽에 둔다.
    // 같은 만큼 바깥으로 넓혀 입력칸 위치는 다른 탭과 맞추고, 아래 상태줄이 없으니 바닥과 띄운다.
    <div className='-mx-1 mb-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1'>
      <label className={field}>
        <span className={label}>Save folder</span>
        <div className='flex gap-2'>
          <input className={cx(control, 'flex-1')} value={draft.outputDir} onChange={(e) => upd({ outputDir: e.target.value })} />
          <Button onClick={pickFolder}>Choose folder…</Button>
        </div>
      </label>

      <label className={field}>
        <span className={label}>Default quality</span>
        <select className={control} value={draft.defaultQuality} onChange={(e) => upd({ defaultQuality: e.target.value })}>
          {QUALITY_OPTIONS.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
        <small className={hint}>
          Applies to newly added videos. If a video doesn't offer this quality, the next lower one is used. You can
          change each video's quality in the queue.
        </small>
      </label>

      <label className={field}>
        <span className={label}>Filename pattern</span>
        <div className='flex gap-2'>
          <select
            className={control}
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
            className={cx(control, 'flex-1 font-mono text-[13px]')}
            value={draft.filenameTemplate}
            onChange={(e) => upd({ filenameTemplate: e.target.value })}
          />
        </div>
        <small className={hint}>
          Preview: <code>{previewName(draft.filenameTemplate)}</code> · Available fields: %(title)s, %(id)s,
          %(channel)s, %(upload_date)s, %(ext)s
        </small>
      </label>

      <label className='flex items-center gap-2'>
        <input
          type='checkbox'
          // 브라우저 기본 체크박스 여백
          className='mt-[3px] mr-[3px] mb-[3px] ml-1'
          checked={draft.saveThumbnail}
          onChange={(e) => upd({ saveThumbnail: e.target.checked })}
        />
        Also save the thumbnail image
      </label>

      <label className={cx(field, narrow)}>
        <span className={label}>Concurrent downloads</span>
        <input
          type='number'
          className={control}
          min={1}
          max={8}
          value={draft.concurrency}
          onChange={(e) => upd({ concurrency: Number(e.target.value) })}
        />
        <small className={hint}>If you start more videos than this, the rest wait as Queued.</small>
      </label>

      <label className={cx(field, narrow)}>
        <span className={label}>Theme</span>
        <select
          className={control}
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
        <small className={hint}>Applies right away. System follows your macOS or Windows appearance setting.</small>
      </label>

      <div className='flex items-center gap-2'>
        <Button variant='primary' onClick={save} disabled={!dirty}>
          Save settings
        </Button>
        {dirty && <Button onClick={() => setDraft(saved)}>Revert</Button>}
        {msg && !dirty && <span className='text-dim'>{msg}</span>}
      </div>

      <div className='flex gap-4 border-t border-line pt-2 text-[12px] text-dim'>
        <div>
          yt-dlp:{' '}
          {tools == null ? 'Checking…' : tools.ytdlp ? <b>{tools.ytdlp}</b> : <b className='text-error'>Not found</b>}
        </div>
        <div>
          ffmpeg:{' '}
          {tools == null ? 'Checking…' : tools.ffmpeg ? <b>Available</b> : <b className='text-error'>Not found</b>}
        </div>
      </div>
    </div>
  );
}
