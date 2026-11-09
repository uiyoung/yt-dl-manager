import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import type { Sort } from '../../sort';
import { removeDoneVideos } from '../../confirmRemove';
import { SelectAll } from '../SelectAll';
import { SortControl } from '../SortControl';
import { SearchIcon, TrashIcon } from '../../icons';
import { Button, cx, lineControl } from '../../ui';

/** done 탭 도구줄: 전체 선택, 선택 항목 삭제, 검색, 정렬 */
export function DoneToolbar({
  ids,
  query,
  onQueryChange,
  sort,
  onSortChange,
}: {
  /** 지금 보이는 항목 (검색 결과) */
  ids: number[];
  query: string;
  onQueryChange: (query: string) => void;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
}) {
  // 검색으로 가려진 항목은 세지도, 지우지도 않는다
  const selectedIds = useStore(useShallow((s) => ids.filter((id) => s.selected[id])));

  return (
    <div className='flex items-center gap-2'>
      <SelectAll ids={ids} selected={selectedIds.length} />

      <Button dangerHover disabled={!selectedIds.length} onClick={() => removeDoneVideos(selectedIds)}>
        <TrashIcon /> Remove{selectedIds.length ? ` (${selectedIds.length})` : ''}
      </Button>

      <span className='flex-1' />
      <label className='relative flex items-center'>
        <span className='pointer-events-none absolute left-2.5 text-dim'>
          <SearchIcon />
        </span>
        <input
          className={cx(lineControl, 'w-60 pl-8')}
          placeholder='Search title, channel or ID'
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </label>

      <SortControl sort={sort} onChange={onSortChange} dateLabel='Date completed' />
    </div>
  );
}
