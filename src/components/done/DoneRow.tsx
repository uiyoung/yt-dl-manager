import { memo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { api } from '../../api';
import { useStore } from '../../store';
import { formatBytes, formatDate, formatDuration, formatHeight, thumbUrl } from '../../format';
import { removeDoneVideos } from '../../confirmRemove';
import { openRowMenu, selectableRow, selectableRowClass, type ListSelection } from '../../selection';
import { copyText, toast } from '../../toast';
import { QUALITY_OPTIONS, type Video } from '../../types';
import { RowMenu, useIsMenuTarget, type MenuItem } from '../RowMenu';
import { openCut } from '../CutDialog';
import { ClipBadge, VideoIdTag } from '../RowParts';
import { CutIcon, PlayIcon, TrashIcon } from '../../icons';
import { actionsClass, Button, cx, rowClass, thumbClass } from '../../ui';

/** 줄 높이 어림값. 실제 높이는 그린 뒤 재서 맞춘다 */
export const ROW_HEIGHT = 84;

const qualityLabel = (q: string) =>
  /^\d+$/.test(q) ? formatHeight(Number(q)) : (QUALITY_OPTIONS.find((o) => o.value === q)?.label ?? q);

/** done 목록 한 줄 */
export const DoneRow = memo(function DoneRow({
  video,
  index,
  top,
  last,
  measure,
  selection,
}: {
  video: Video;
  index: number;
  /** 목록 맨 위에서부터의 위치(px) */
  top: number;
  last: boolean;
  measure: (el: HTMLElement | null) => void;
  selection: ListSelection;
}) {
  const checked = useStore((s) => !!s.selected[video.id]);
  const menuTarget = useIsMenuTarget(video.id);

  return (
    <li
      ref={measure}
      data-index={index}
      // 보이는 줄만 그리므로 위치를 직접 잡는다. 맨 끝 줄만 아래 구분선을 뺀다
      className={cx(
        rowClass,
        selectableRowClass(checked, menuTarget),
        'absolute inset-x-0 top-0',
        last ? 'border-b-0' : 'border-b',
      )}
      style={{ transform: `translateY(${top}px)` }}
      {...selectableRow(video.id, checked, selection)}
      onContextMenu={(e) => openRowMenu(e, video.id, selection, () => menuItems(video), selectionMenuItems)}
    >
      <button
        // 마우스를 올리면 썸네일을 밝게 하고 강조색 테두리
        className='group shrink-0 cursor-pointer rounded-sm leading-0 disabled:cursor-default'
        title='Open thumbnail'
        aria-label='Open thumbnail'
        disabled={!video.filePath}
        onClick={() => tryOpen(() => api.openDoneThumbnail(video.id))}
      >
        <img
          className={cx(
            thumbClass,
            'group-enabled:group-hover:outline-2 group-enabled:group-hover:outline-offset-1 group-enabled:group-hover:outline-highlight group-enabled:group-hover:brightness-[1.15]',
          )}
          src={thumbUrl(video.videoId)}
          alt=''
          loading='lazy'
        />
      </button>
      <div className='flex min-w-0 flex-1 flex-col gap-0.75'>
        <div className='truncate font-semibold text-[13px]' title={video.filePath ?? ''}>
          {video.title ?? video.url}
        </div>
        <div className='text-[12px] text-dim'>
          {video.clipStart != null && video.clipEnd != null && <ClipBadge video={video} />}
          {[
            video.channel,
            formatDuration(video.duration),
            qualityLabel(video.gotQuality ?? video.quality),
            formatBytes(video.fileSize),
          ]
            .filter(Boolean)
            .join(' · ')}
          <VideoIdTag video={video} separated />
        </div>
        <div className='text-[12px] text-dim'>Completed {formatDate(video.completedAt)}</div>
      </div>
      <div className={actionsClass}>
        {video.filePath && (
          <Button onClick={() => tryOpen(() => api.openDoneFile(video.id))}>
            <PlayIcon /> Play
          </Button>
        )}
        <Button
          variant='ghost'
          icon
          disabled={video.clipStart != null || !video.filePath}
          title={
            video.clipStart != null
              ? 'Cut from the original video instead'
              : 'Cut a section — saves that part as a new file (the original is kept)'
          }
          aria-label='Cut a section'
          onClick={() => openCut(video.id, 'done')}
        >
          <CutIcon />
        </Button>
        <RowMenu items={menuItems(video)} />
        <Button
          variant='ghost'
          icon
          dangerHover
          title='Remove (choose whether to keep the file)'
          aria-label='Remove'
          onClick={() => removeDoneVideos([video.id])}
        >
          <TrashIcon />
        </Button>
      </div>
    </li>
  );
});

async function tryOpen(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    toast(`Can't open the file: ${e}`, 'error');
  }
}

function parentDir(p: string) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}

function menuItems(video: Video): MenuItem[] {
  return [
    { label: 'Open on YouTube', onClick: () => openUrl(video.url) },
    { label: 'Copy YouTube link', onClick: () => copyText(video.url, 'Link copied') },
    'separator',
    {
      label: 'Show in folder',
      disabled: !video.filePath,
      onClick: () => tryOpen(() => revealItemInDir(video.filePath!)),
    },
    {
      label: 'Copy file path',
      disabled: !video.filePath,
      onClick: () => copyText(video.filePath!, 'File path copied'),
    },
    {
      label: 'Move to another folder…',
      disabled: !video.filePath,
      hint: 'Moves the file (and thumbnail) to the folder you pick',
      onClick: async () => {
        const dir = await open({ directory: true, defaultPath: parentDir(video.filePath!), title: 'Move file to' });
        if (typeof dir !== 'string') return;
        try {
          await api.moveDoneFile(video.id, dir);
          toast('File moved');
        } catch (e) {
          toast(String(e), 'error');
        }
      },
    },
  ];
}

/** 여러 개를 골라 우클릭했을 때의 메뉴 */
function selectionMenuItems(ids: number[]): MenuItem[] {
  const all = useStore.getState().videos;
  const videos = ids.map((id) => all[id]).filter(Boolean);
  return [
    { label: 'Copy YouTube links', onClick: () => copyText(videos.map((v) => v.url).join('\n'), 'Links copied') },
    'separator',
    { label: `Remove ${ids.length} videos…`, danger: true, onClick: () => removeDoneVideos(ids) },
  ];
}
