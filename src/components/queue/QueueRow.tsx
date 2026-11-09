import { memo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api } from '../../api';
import { useStore } from '../../store';
import { formatBytes, formatDuration, thumbUrl } from '../../format';
import { openCut } from '../CutDialog';
import { removeVideos } from '../../confirmRemove';
import { copyText, toast } from '../../toast';
import type { Video } from '../../types';
import { QualitySelect } from './QualitySelect';
import { ClipBadge, VideoIdTag } from '../RowParts';
import { openRowMenu, selectableRow, selectableRowClass, type ListSelection } from '../../selection';
import { countSelection, pickAction } from './QueueToolbar';
import { RowMenu, useIsMenuTarget, type MenuItem } from '../RowMenu';
import { CutIcon, DownloadIcon, RetryIcon, StopIcon, TrashIcon } from '../../icons';
import { actionsClass, Badge, Button, cx, rowClass, thumbClass } from '../../ui';

const statusLine = 'flex min-w-0 items-center gap-2 text-[12px]';
const bar = 'relative h-1.5 max-w-[320px] flex-1 overflow-hidden rounded-[3px] bg-bar';

/** 대기열 한 줄. 클릭으로 선택을 켜고 끈다 (Shift+클릭 범위는 selection이 처리) */
export const QueueRow = memo(function QueueRow({ id, selection }: { id: number; selection: ListSelection }) {
  const video = useStore((state) => state.videos[id]);
  if (!video) return null;

  const size = video.sizeEstimate ? `~${formatBytes(video.sizeEstimate)}` : null;
  const checked = useStore((state) => !!state.selected[id]);
  const menuTarget = useIsMenuTarget(id);

  return (
    <li
      className={cx(rowClass, selectableRowClass(checked, menuTarget))}
      {...selectableRow(id, checked, selection)}
      onContextMenu={(e) => openRowMenu(e, id, selection, () => menuItems(video), selectionMenuItems)}
    >
      <img className={thumbClass} src={thumbUrl(video.videoId)} alt='' loading='lazy' />
      <div className='flex min-w-0 flex-1 flex-col gap-0.75'>
        <div className='truncate font-semibold text-[13px]' title={video.title ?? video.url}>
          {video.title ?? (video.metaState === 'pending' ? 'Loading info…' : video.url)}
        </div>
        <div className='text-[12px] text-dim'>
          {video.clipStart != null && video.clipEnd != null && <ClipBadge video={video} />}
          {[video.channel, formatDuration(video.duration)].filter(Boolean).join(' · ')}
          {size && (
            <span title='Estimated size at best quality'>
              {video.channel || video.duration ? ' · ' : ''}
              {size}
            </span>
          )}
          <VideoIdTag video={video} separated={!!(video.channel || video.duration || size)} />
        </div>
        {video.outputDir && (
          <div className='truncate text-[12px] text-dim' title={video.outputDir}>
            Save folder: {video.outputDir}
          </div>
        )}
        <StatusCell video={video} />
      </div>

      <QualitySelect video={video} />

      <div className={actionsClass}>
        <RowAction video={video} />
        <Button
          variant='ghost'
          icon
          // 구간 항목은 원본에서 자르도록 (자리는 남겨서 줄마다 버튼 위치를 맞춘다)
          disabled={video.clipStart != null}
          title={
            video.clipStart != null
              ? 'Cut from the original video instead'
              : 'Cut a section — adds a new item that downloads only that part'
          }
          aria-label='Cut a section'
          onClick={() => openCut(video.id, 'queue')}
        >
          <CutIcon />
        </Button>
        <RowMenu items={menuItems(video)} />
        <Button
          variant='ghost'
          icon
          dangerHover
          title='Remove from list (downloaded file is kept)'
          aria-label='Remove from list'
          onClick={() => removeVideos([video.id])}
        >
          <TrashIcon />
        </Button>
      </div>
    </li>
  );
});

const ProgressInfo = memo(function ProgressInfo({ id }: { id: number }) {
  const progress = useStore((state) => state.progress[id]);
  if (!progress) {
    return <div className={statusLine}>Starting…</div>;
  }

  if (progress.stage === 'processing') {
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
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <span className='whitespace-nowrap text-dim tabular-nums'>
        {progress.percent.toFixed(1)}%{progress.total ? ` · ${formatBytes(progress.total)}` : ''}
        {progress.speed ? ` · ${formatBytes(progress.speed)}/s` : ''}
        {progress.eta != null ? ` · ${formatDuration(progress.eta)} left` : ''}
      </span>
    </div>
  );
});

function StatusCell({ video }: { video: Video }) {
  switch (video.status) {
    case 'downloading':
      return <ProgressInfo id={video.id} />;
    case 'queued':
      return (
        <div className={statusLine}>
          <Badge tone='info'>Queued</Badge>
        </div>
      );
    case 'error':
      return (
        <div className={statusLine} title={video.errorMsg ?? ''}>
          <Badge tone='error'>Failed</Badge>
          <span className='min-w-0 truncate text-error'>{video.errorMsg}</span>
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
function RowAction({ video }: { video: Video }) {
  switch (video.status) {
    case 'ready':
      return (
        <Button onClick={() => api.download([video.id])}>
          <DownloadIcon /> Download
        </Button>
      );
    case 'error':
      return (
        <Button variant='retry' onClick={() => api.download([video.id])}>
          <RetryIcon /> Retry
        </Button>
      );
    case 'queued':
    case 'downloading':
      return (
        <Button onClick={() => api.stop([video.id])}>
          <StopIcon /> Stop
        </Button>
      );
    default:
      return null;
  }
}

function menuItems(video: Video): MenuItem[] {
  const editable = video.status === 'ready' || video.status === 'error';

  const items: MenuItem[] = [
    { label: 'Open on YouTube', onClick: () => openUrl(video.url) },
    { label: 'Copy YouTube link', onClick: () => copyText(video.url, 'Link copied') },
    'separator',
    {
      label: 'Change save folder…',
      disabled: !editable,
      hint: editable ? undefined : "Can't change while downloading or queued",
      onClick: async () => {
        const defaultPath = video.outputDir ?? useStore.getState().settings?.outputDir;
        const dir = await open({ directory: true, defaultPath, title: 'Save this video to' });
        if (typeof dir !== 'string') return;
        try {
          await api.setOutputDir(video.id, dir);
          toast('Save folder changed');
        } catch (e) {
          toast(String(e), 'error');
        }
      },
    },
  ];

  if (video.outputDir)
    items.push({
      label: 'Use default save folder',
      disabled: !editable,
      onClick: () => api.setOutputDir(video.id, null).catch((e) => toast(String(e), 'error')),
    });

  if (video.errorMsg) {
    items.push({ label: 'Copy error message', onClick: () => copyText(video.errorMsg!) });
  }

  return items;
}

/** 여러 개를 골라 우클릭했을 때의 메뉴 */
function selectionMenuItems(ids: number[]): MenuItem[] {
  const all = useStore.getState().videos;
  const videos = ids.map((id) => all[id]).filter(Boolean);
  const c = countSelection(videos);
  const action = pickAction(c);
  const n = (x: number) => (x === 1 ? '1 video' : `${x} videos`);

  return [
    action === 'stop'
      ? { label: `Stop ${n(c.selStoppable)}`, onClick: () => api.stop(ids) }
      : {
          label: action === 'retry' ? `Retry ${n(c.selFailed)}` : `Download ${n(c.selStartable)}`,
          disabled: !c.selStartable,
          onClick: () => api.download(ids),
        },
    'separator',
    { label: 'Copy YouTube links', onClick: () => copyText(videos.map((v) => v.url).join('\n'), 'Links copied') },
    'separator',
    { label: `Remove ${n(ids.length)}…`, danger: true, onClick: () => removeVideos(ids) },
  ];
}
