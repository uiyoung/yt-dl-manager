import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { sortVideos, useSort } from '../../sort';
import { QueueList } from './QueueList';
import { QueueToolbar } from './QueueToolbar';
import { emptyClass, viewClass } from '../../ui';

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

      {ids.length === 0 ? (
        <div className={emptyClass}>The queue is empty. Paste links above to add videos.</div>
      ) : (
        <QueueList ids={ids} />
      )}
    </div>
  );
}
