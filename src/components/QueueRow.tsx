import { memo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api } from '../api';
import { useStore } from '../store';
import { fmtBytes, fmtClip, fmtDuration, thumbUrl } from '../format';
import { openCut } from './CutDialog';
import { removeVideos } from '../confirmRemove';
import { copyText, toast } from '../toast';
import type { Video } from '../types';
import { QualitySelect } from './QualitySelect';
import { RowMenu, type MenuItem } from './RowMenu';
import { CutIcon, DownloadIcon, RetryIcon, StopIcon, TrashIcon } from '../icons';
import { actionsClass, Badge, Button, cx, rowClass, thumbClass } from '../ui';

const statusLine = 'flex min-w-0 items-center gap-2 text-[12px]';
const bar = 'relative h-1.5 max-w-[320px] flex-1 overflow-hidden rounded-[3px] bg-bar';

const ProgressInfo = memo(function ProgressInfo({ id }: { id: number }) {
  const p = useStore((s) => s.progress[id]);
  if (!p) {
    return <div className={statusLine}>Starting…</div>;
  }

  if (p.stage === 'processing') {
    return (
      <div className={statusLine}>
        <div
          className={cx(
            bar,
            "after:absolute after:inset-0 after:w-[30%] after:animate-slide after:bg-highlight after:content-['']",
          )}
        />
        <span>Processing file…</span>
      </div>
    );
  }

  return (
    <div className={statusLine}>
      <div className={bar}>
        <div
          className='h-full bg-highlight transition-[width] duration-250 ease-linear'
          style={{ width: `${p.percent}%` }}
        />
      </div>
      <span className='whitespace-nowrap text-dim tabular-nums'>
        {p.percent.toFixed(1)}%{p.total ? ` · ${fmtBytes(p.total)}` : ''}
        {p.speed ? ` · ${fmtBytes(p.speed)}/s` : ''}
        {p.eta != null ? ` · ${fmtDuration(p.eta)} left` : ''}
      </span>
    </div>
  );
});

function StatusCell({ v }: { v: Video }) {
  switch (v.status) {
    case 'downloading':
      return <ProgressInfo id={v.id} />;
    case 'queued':
      return (
        <div className={statusLine}>
          <Badge tone='info'>Queued</Badge>
        </div>
      );
    case 'error':
      return (
        <div className={statusLine} title={v.errorMsg ?? ''}>
          <Badge tone='error'>Failed</Badge>
          <span className='min-w-0 truncate text-error'>{v.errorMsg}</span>
        </div>
      );
    default:
      return (
        <div className={statusLine}>
          <Badge>Ready</Badge>
        </div>
      );
  }
}

/** 상태에 따라 줄마다 하나의 주 동작 버튼 */
function RowAction({ v }: { v: Video }) {
  switch (v.status) {
    case 'ready':
      return (
        <Button onClick={() => api.download([v.id])}>
          <DownloadIcon /> Download
        </Button>
      );
    case 'error':
      return (
        <Button variant='retry' onClick={() => api.download([v.id])}>
          <RetryIcon /> Retry
        </Button>
      );
    case 'queued':
    case 'downloading':
      return (
        <Button onClick={() => api.stop([v.id])}>
          <StopIcon /> Stop
        </Button>
      );
    default:
      return null;
  }
}

function menuItems(v: Video): MenuItem[] {
  const editable = v.status === 'ready' || v.status === 'error';

  const items: MenuItem[] = [
    { label: 'Open on YouTube', onClick: () => openUrl(v.url) },
    { label: 'Copy YouTube link', onClick: () => copyText(v.url, 'Link copied') },
    'separator',
    // 구간 항목에서 또 자르면 헷갈리므로 원본에서만
    ...(v.clipStart == null
      ? [{ label: 'Cut a section…', hint: 'Add a new item that downloads only part of this video', onClick: () => openCut(v.id, 'queue') }]
      : []),
    {
      label: 'Change save folder…',
      disabled: !editable,
      hint: editable ? undefined : "Can't change while downloading or queued",
      onClick: async () => {
        const defaultPath = v.outputDir ?? useStore.getState().settings?.outputDir;
        const dir = await open({ directory: true, defaultPath, title: 'Save this video to' });
        if (typeof dir !== 'string') return;
        try {
          await api.setOutputDir(v.id, dir);
          toast('Save folder changed');
        } catch (e) {
          toast(String(e), 'error');
        }
      },
    },
  ];

  if (v.outputDir)
    items.push({
      label: 'Use default save folder',
      disabled: !editable,
      onClick: () => api.setOutputDir(v.id, null).catch((e) => toast(String(e), 'error')),
    });

  if (v.errorMsg) {
    items.push({ label: 'Copy error message', onClick: () => copyText(v.errorMsg!) });
  }

  items.push('separator', { label: 'Remove from list', danger: true, onClick: () => removeVideos([v.id]) });
  return items;
}

/** 구간 항목 표시: 원본에서 어느 구간인지 */
export function ClipBadge({ v }: { v: Video }) {
  return (
    <span className='mr-1.5 inline-flex align-middle'>
      <Badge tone='info'>
        <span title={v.clipPrecise ? 'Cut exactly at these times' : 'Cut quickly (may start a few seconds early)'}>
          Clip {fmtClip(v.clipStart!, v.clipEnd!)}
        </span>
      </Badge>
    </span>
  );
}

/** 행 안의 이 요소들을 누를 때는 선택을 바꾸지 않는다 */
const NO_SELECT = 'button, select, a, textarea, input, [role=menu], [role=menuitem]';

/** 대기열 한 줄. 클릭으로 선택을 켜고 끈다 (Shift+클릭 범위는 onCheck가 처리) */
export const QueueRow = memo(function QueueRow({
  id,
  onCheck,
}: {
  id: number;
  onCheck: (id: number, on: boolean, shift: boolean) => void;
}) {
  const v = useStore((s) => s.videos[id]);
  const checked = useStore((s) => !!s.selected[id]);
  if (!v) return null;

  const size = v.sizeEstimate ? `~${fmtBytes(v.sizeEstimate)}` : null;

  return (
    <li
      className={cx(
        rowClass,
        'cursor-pointer',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-highlight',
        // 선택: 배경과 왼쪽 강조색 세로줄
        checked ? 'bg-selected shadow-[inset_3px_0_0_var(--highlight)]' : 'hover:bg-hover',
      )}
      aria-selected={checked}
      // 키보드: Tab으로 행에 와서 Space로 선택 켜기/끄기
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== ' ' || e.target !== e.currentTarget) return;
        e.preventDefault();
        onCheck(id, !checked, e.shiftKey);
      }}
      // Shift+클릭 때 글자가 드래그 선택되지 않게
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onClick={(e) => {
        // 메뉴는 포털로 그려져도 이벤트가 행으로 올라오므로, 행 안에서 난 클릭만 받는다
        if (!e.currentTarget.contains(e.target as Node)) return;
        if ((e.target as HTMLElement).closest(NO_SELECT)) return;
        // 클릭·⌘/Ctrl+클릭: 이 행만 켜고 끄기 · Shift+클릭: 마지막으로 누른 행부터 범위
        onCheck(id, !checked, e.shiftKey);
      }}
    >
      <img className={thumbClass} src={thumbUrl(v.videoId)} alt='' loading='lazy' />
      <div className='flex min-w-0 flex-1 flex-col gap-[3px]'>
        <div className='truncate font-semibold text-[13px]' title={v.title ?? v.url}>
          {v.title ?? (v.metaState === 'pending' ? 'Loading info…' : v.url)}
        </div>
        <div className='text-[12px] text-dim'>
          {v.clipStart != null && v.clipEnd != null && <ClipBadge v={v} />}
          {[v.channel, fmtDuration(v.duration)].filter(Boolean).join(' · ')}
          {size && (
            <span title='Estimated size at best quality'>
              {v.channel || v.duration ? ' · ' : ''}
              {size}
            </span>
          )}
        </div>
        {v.outputDir && (
          <div className='truncate text-[12px] text-dim' title={v.outputDir}>
            Save folder: {v.outputDir}
          </div>
        )}
        <StatusCell v={v} />
      </div>

      <QualitySelect v={v} />

      <div className={actionsClass}>
        <RowAction v={v} />
        <Button
          variant='ghost'
          icon
          // 구간 항목은 원본에서 자르도록 (자리는 남겨서 줄마다 버튼 위치를 맞춘다)
          disabled={v.clipStart != null}
          title={v.clipStart != null ? 'Cut from the original video instead' : 'Cut a section'}
          aria-label='Cut a section'
          onClick={() => openCut(v.id, 'queue')}
        >
          <CutIcon />
        </Button>
        <RowMenu items={menuItems(v)} />
        <Button
          variant='ghost'
          icon
          dangerHover
          title='Remove from list (downloaded file is kept)'
          aria-label='Remove from list'
          onClick={() => removeVideos([v.id])}
        >
          <TrashIcon />
        </Button>
      </div>
    </li>
  );
});
