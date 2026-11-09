import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { sortVideos, useSort } from '../../sort';
import { DoneList } from './DoneList';
import { DoneToolbar } from './DoneToolbar';
import { emptyClass, viewClass } from '../../ui';

/** done 탭: 검색·정렬로 보여 줄 목록을 정하고 도구줄과 목록에 넘긴다 */
export function DoneView() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useSort('sort.done', { key: 'date', desc: true });
  const done = useStore(useShallow((s) => Object.values(s.videos).filter((v) => v.status === 'done')));

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    // 제목·채널·영상 ID로 찾는다
    const filtered = done.filter(
      (video) => !q || `${video.title ?? ''} ${video.channel ?? ''} ${video.videoId}`.toLowerCase().includes(q),
    );

    return sortVideos(filtered, sort, 'done');
  }, [done, query, sort]);

  const ids = useMemo(() => list.map((v) => v.id), [list]);

  return (
    <div className={viewClass}>
      <DoneToolbar ids={ids} query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} />

      {list.length === 0 ? (
        <div className={emptyClass}>{done.length ? 'No results.' : 'No completed downloads yet.'}</div>
      ) : (
        <DoneList list={list} ids={ids} />
      )}
    </div>
  );
}
