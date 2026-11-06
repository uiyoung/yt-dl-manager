import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { sortVideos, useSort } from '../sort';
import { QueueList } from './QueueList';
import { QueueToolbar } from './QueueToolbar';
import { viewClass } from '../ui';

/** 대기열 탭: 정렬 순서를 정하고 도구줄과 목록에 넘긴다 */
export function QueueView() {
  const [sort, setSort] = useSort('sort.queue', { key: 'date', desc: false });

  const ids = useStore(
    useShallow((s) =>
      sortVideos(
        Object.values(s.videos).filter((v) => v.status !== 'done'),
        sort,
        'queue',
      ).map((v) => v.id),
    ),
  );

  return (
    <div className={viewClass}>
      <QueueToolbar ids={ids} sort={sort} onSortChange={setSort} />
      <QueueList ids={ids} />
    </div>
  );
}
