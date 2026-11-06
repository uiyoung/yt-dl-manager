import { QueueRow } from './QueueRow';
import { useListSelection } from '../../selection';
import { listClass } from '../../ui';

/** 대기열 목록. 선택 방식은 useListSelection (done 목록과 같다). 빈 목록일 때는 QueueView가 안내를 보여 준다 */
export function QueueList({ ids }: { ids: number[] }) {
  const selection = useListSelection(ids);

  return (
    <ul className={listClass}>
      {ids.map((id) => (
        <QueueRow key={id} id={id} selection={selection} />
      ))}
    </ul>
  );
}
