import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { QueueRow } from './QueueRow';
import { emptyClass, listClass } from '../ui';

/** 대기열 목록과 선택 처리: Shift+클릭 범위, ⌘/Ctrl+A 전체 선택, Esc 해제 */
export function QueueList({ ids }: { ids: number[] }) {
  const setSelected = useStore((s) => s.setSelected);
  const clearSelection = useStore((s) => s.clearSelection);
  const lastClicked = useRef<number | null>(null);

  const idsRef = useRef(ids);
  idsRef.current = ids;

  // ⌘/Ctrl+A 전체 선택, Esc 선택 해제 (입력란에 있을 때는 그대로 둔다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input:not([type=checkbox]), textarea, select, [contenteditable=true]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(idsRef.current, true);
      } else if (
        e.key === 'Escape' &&
        // 열린 메뉴가 있으면 Esc는 메뉴만 닫는다
        !document.querySelector('[role=menu]') &&
        document.querySelector('li[aria-selected="true"]')
      ) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelected, clearSelection]);

  // Shift+클릭으로 범위 선택 (지금 보이는 정렬 순서 기준)
  const onCheck = useRef((id: number, on: boolean, shift: boolean) => {
    const list = idsRef.current;
    const from = lastClicked.current != null ? list.indexOf(lastClicked.current) : -1;
    const to = list.indexOf(id);

    if (shift && from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      setSelected(list.slice(a, b + 1), on);
    } else {
      setSelected([id], on);
    }

    lastClicked.current = id;
  }).current;

  if (ids.length === 0) {
    return <div className={emptyClass}>The queue is empty. Paste links above to add videos.</div>;
  }

  return (
    <ul className={listClass}>
      {ids.map((id) => (
        <QueueRow key={id} id={id} onCheck={onCheck} />
      ))}
    </ul>
  );
}
