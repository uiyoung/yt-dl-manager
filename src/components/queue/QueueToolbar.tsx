import { useShallow } from 'zustand/react/shallow';
import { api } from '../../api';
import { useStore } from '../../store';
import { removeVideos } from '../../confirmRemove';
import type { Sort } from '../../sort';
import { SortControl } from '../SortControl';
import { SelectAll } from '../SelectAll';
import { DownloadIcon, RetryIcon, StopIcon, TrashIcon } from '../../icons';
import { Button } from '../../ui';

/**
 * 대기열 위 도구줄: 전체 선택, 선택 항목 다운로드·멈춤·제거, 정렬.
 * 선택 개수는 여기서만 세서, 선택이 바뀌어도 목록 전체를 다시 그리지 않는다.
 */
export function QueueToolbar({
  ids,
  sort,
  onSortChange,
}: {
  /** 지금 보이는 순서의 대기열 항목 */
  ids: number[];
  sort: Sort;
  onSortChange: (s: Sort) => void;
}) {
  const counts = useStore(
    useShallow((s) => {
      const c = { sel: 0, selStartable: 0, selFailed: 0, selStoppable: 0 };
      for (const video of Object.values(s.videos)) {
        if (video.status === 'done' || !s.selected[video.id]) {
          continue;
        }

        c.sel++;
        if (video.status === 'ready' || video.status === 'error') c.selStartable++;
        if (video.status === 'error') c.selFailed++;
        if (video.status === 'queued' || video.status === 'downloading') c.selStoppable++;
      }

      return c;
    }),
  );

  /** 선택한 항목을 보이는 순서대로 (다운로드도 이 순서로 시작한다) */
  const selectedIds = () => {
    const sel = useStore.getState().selected;
    return ids.filter((id) => sel[id]);
  };

  return (
    <div className='flex items-center gap-2'>
      <SelectAll ids={ids} selected={counts.sel} />

      <SelectionAction counts={counts} selectedIds={selectedIds} />

      <Button
        dangerHover
        disabled={!counts.sel}
        onClick={() => removeVideos(selectedIds())}
        title='Remove selected videos from the list (downloaded files are kept)'
      >
        <TrashIcon /> Remove{counts.sel ? ` (${counts.sel})` : ''}
      </Button>

      <span className='flex-1' />
      <SortControl sort={sort} onChange={onSortChange} dateLabel='Date added' />
    </div>
  );
}

/**
 * 선택한 항목에 맞는 동작 버튼 하나 (행의 버튼과 같은 규칙):
 * 받을 수 있는 항목이 있으면 Download (모두 실패 항목이면 Retry), 없고 받는 중인 항목만 있으면 Stop.
 * 받을 항목과 받는 중인 항목이 섞여 있으면 Download를 보여주고, 받는 중인 항목은 그대로 둔다.
 */
function SelectionAction({
  counts,
  selectedIds,
}: {
  counts: Counts;
  selectedIds: () => number[];
}) {
  const n = (x: number) => (x ? ` (${x})` : '');
  const action = pickAction(counts);

  if (action === 'retry') {
    return (
      <Button variant='retry' onClick={() => api.download(selectedIds())}>
        <RetryIcon /> Retry{n(counts.selFailed)}
      </Button>
    );
  }

  if (action === 'stop') {
    return (
      <Button onClick={() => api.stop(selectedIds())}>
        <StopIcon /> Stop{n(counts.selStoppable)}
      </Button>
    );
  }

  return (
    <Button variant='primary' disabled={!counts.selStartable} onClick={() => api.download(selectedIds())}>
      <DownloadIcon /> Download{n(counts.selStartable)}
    </Button>
  );
}

type Counts = { selStartable: number; selFailed: number; selStoppable: number };

/** 선택에 맞는 동작 (도구줄 버튼과 우클릭 메뉴가 같은 규칙을 쓴다) */
export function pickAction(c: Counts): 'retry' | 'stop' | 'download' {
  if (c.selStartable && c.selFailed === c.selStartable) return 'retry';
  if (!c.selStartable && c.selStoppable) return 'stop';
  return 'download';
}

/** 고른 영상들에서 받을 수 있는·실패한·멈출 수 있는 개수 */
export function countSelection(videos: { status: string }[]): Counts {
  const c = { selStartable: 0, selFailed: 0, selStoppable: 0 };
  for (const video of videos) {
    if (video.status === 'ready' || video.status === 'error') c.selStartable++;
    if (video.status === 'error') c.selFailed++;
    if (video.status === 'queued' || video.status === 'downloading') c.selStoppable++;
  }
  return c;
}
