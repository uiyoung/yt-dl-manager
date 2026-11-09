import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from '../../api';
import { useStore } from '../../store';
import { getTheme, saveTheme, type Theme } from '../../theme';
import { Button, cx, lineControl } from '../../ui';
import { FILENAME_PRESETS, QUALITY_OPTIONS, type Settings, type ToolInfo, type ToolStatus } from '../../types';

const field = 'flex flex-col gap-1.5';
const narrow = 'max-w-90';
const label = 'font-semibold';
// 브라우저 기본 <small> 크기(smaller)를 유지한다
const hint = 'text-dim [font-size:smaller]';
// 설정 묶음과 그 제목. 첫 묶음 뒤로는 위에 구분선을 둔다
const section = 'flex flex-col gap-4';
const divided = 'border-t border-line pt-4';
const sectionTitle = 'text-[12px] font-semibold tracking-wide text-dim uppercase';

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

/** 도구 한 줄: 이름·버전, 그 아래 실제로 쓰는 경로 */
function ToolRow({
  name,
  info,
  loading,
  use,
}: {
  name: string;
  info: ToolInfo | null | undefined;
  loading: boolean;
  use: string;
}) {
  return (
    <li className='flex flex-col gap-0.5'>
      <div className='flex items-baseline gap-2'>
        <span className='w-16 font-semibold'>{name}</span>
        {loading ? (
          <span className='text-dim'>Checking…</span>
        ) : info ? (
          <span>{info.version}</span>
        ) : (
          <span className='text-error'>Not found — {use}</span>
        )}
      </div>
      {info && (
        <code className='truncate pl-18 text-[12px] text-dim' title={info.path}>
          {info.path}
        </code>
      )}
    </li>
  );
}

export function SettingsView() {
  const saved = useStore((state) => state.settings);
  const setSettings = useStore((state) => state.setSettings);
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
      <section className={section}>
        <h2 className={sectionTitle}>Downloads</h2>
        <label className={field}>
          <span className={label}>Save folder</span>
          <div className='flex gap-2'>
            <input
              className={cx(lineControl, 'flex-1')}
              value={draft.outputDir}
              onChange={(e) => upd({ outputDir: e.target.value })}
            />
            <Button onClick={pickFolder}>Choose folder…</Button>
          </div>
        </label>

        <label className={field}>
          <span className={label}>Default quality</span>
          <select
            className={cx(lineControl, 'w-50')}
            value={draft.defaultQuality}
            onChange={(e) => upd({ defaultQuality: e.target.value })}
          >
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
              className={lineControl}
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
              className={cx(lineControl, 'flex-1 font-mono text-[13px]')}
              value={draft.filenameTemplate}
              onChange={(e) => upd({ filenameTemplate: e.target.value })}
            />
          </div>
          <small className={hint}>
            Available fields: %(title)s, %(id)s, %(channel)s, %(upload_date)s, %(ext)s
            <br />
            Preview: <code>{previewName(draft.filenameTemplate)}</code>
          </small>
        </label>

        <label className='flex items-center gap-2'>
          <input
            type='checkbox'
            // 브라우저 기본 체크박스 여백
            className='mt-0.75 mr-0.75 mb-0.75 ml-1'
            checked={draft.saveThumbnail}
            onChange={(e) => upd({ saveThumbnail: e.target.checked })}
          />
          Also save the thumbnail image
        </label>

        <label className={cx(field, narrow)}>
          <span className={label}>Concurrent downloads</span>
          <input
            type='number'
            className={lineControl}
            min={1}
            max={8}
            value={draft.concurrency}
            onChange={(e) => upd({ concurrency: Number(e.target.value) })}
          />
          <small className={hint}>If you start more videos than this, the rest wait as Queued.</small>
        </label>

        <div className='flex items-center gap-2'>
          <Button variant='primary' onClick={save} disabled={!dirty}>
            Save settings
          </Button>
          {dirty && <Button onClick={() => setDraft(saved)}>Revert</Button>}
          {msg && !dirty && <span className='text-dim'>{msg}</span>}
        </div>
      </section>

      {/* 화면 관련 설정은 고르는 즉시 적용·저장되므로 Save settings 아래에 따로 둔다 */}
      <section className={cx(section, divided)}>
        <h2 className={sectionTitle}>Appearance</h2>
        <label className={cx(field, narrow)}>
          <span className={label}>Theme</span>
          <select
            className={lineControl}
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
          <small className={hint}>
            Applies right away, no need to save. System follows your macOS or Windows appearance setting.
          </small>
        </label>
      </section>

      <section className={cx(section, divided)}>
        <h2 className={sectionTitle}>Tools</h2>
        <ul className='flex flex-col gap-1.5'>
          <ToolRow name='yt-dlp' info={tools?.ytdlp} loading={tools == null} use='Downloads videos.' />
          <ToolRow name='ffmpeg' info={tools?.ffmpeg} loading={tools == null} use='Merges video and audio.' />
          <ToolRow name='ffprobe' info={tools?.ffprobe} loading={tools == null} use='Reads the downloaded quality.' />
        </ul>
        <small className={hint}>
          Found on your system PATH. Install or upgrade them with your package manager (Chocolatey, winget, Homebrew…).
        </small>
      </section>

      <section className={cx(section, divided)}>
        <h2 className={sectionTitle}>Log</h2>

        <div className='flex items-center gap-2'>
          <Button onClick={() => api.openLogFolder().catch((e) => setMsg(String(e)))}>Open log folder</Button>
        </div>
        <small className={hint}>
          Downloads, video info lookups and cuts are recorded here, including full error output.
        </small>
      </section>
    </div>
  );
}
