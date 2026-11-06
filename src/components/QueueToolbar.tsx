import { useShallow } from 'zustand/react/shallow';
import { api } from '../api';
import { useStore } from '../store';
import { removeVideos } from '../confirmRemove';
import type { Sort } from '../sort';
import { SortControl } from './SortControl';
import { DownloadIcon, StopIcon, TrashIcon } from '../icons';
import { Button } from '../ui';

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
      const c = { sel: 0, selStartable: 0, selStoppable: 0 };
      for (const v of Object.values(s.videos)) {
        if (v.status === 'done' || !s.selected[v.id]) continue;
        c.sel++;
        if (v.status === 'ready' || v.status === 'error') c.selStartable++;
        if (v.status === 'queued' || v.status === 'downloading') c.selStoppable++;
      }
      return c;
    }),
  );
  const setSelected = useStore((s) => s.setSelected);
  const clearSelection = useStore((s) => s.clearSelection);

  /** 선택한 항목을 보이는 순서대로 (다운로드도 이 순서로 시작한다) */
  const selectedIds = () => {
    const sel = useStore.getState().selected;
    return ids.filter((id) => sel[id]);
  };
  const allChecked = ids.length > 0 && counts.sel === ids.length;

  return (
    <div className='flex items-center gap-2'>
      <label className='flex min-w-[108px] cursor-pointer items-center gap-2 pr-1.5 pl-3 text-dim' title='Select all'>
        <input
          type='checkbox'
          className='m-0 size-4 shrink-0 cursor-pointer accent-highlight'
          checked={allChecked}
          ref={(el) => {
            if (el) el.indeterminate = counts.sel > 0 && !allChecked;
          }}
          onChange={() => (allChecked ? clearSelection() : setSelected(ids, true))}
          disabled={!ids.length}
        />
        {counts.sel ? `${counts.sel} selected` : 'Select all'}
      </label>

      <Button variant='primary' disabled={!counts.selStartable} onClick={() => api.download(selectedIds())}>
        <DownloadIcon /> Download {counts.selStartable ? ` (${counts.selStartable})` : ''}
      </Button>
      <Button disabled={!counts.selStoppable} onClick={() => api.stop(selectedIds())}>
        <StopIcon /> Stop
      </Button>

      <Button disabled={!counts.sel} onClick={() => removeVideos(selectedIds())} title='Remove selected videos from the list'>
        <TrashIcon />
      </Button>
      <span className='flex-1' />
      <SortControl sort={sort} onChange={onSortChange} dateLabel='Date added' />
    </div>
  );
}
