import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { openContextMenu, type MenuItem } from './components/RowMenu';

/**
 * 목록의 여러 항목 선택 (queue와 done이 같은 방식):
 * 클릭·Space로 켜고 끄기, Shift+클릭 범위, ⌘/Ctrl+A 전체 선택, Esc 해제.
 * ids는 지금 보이는 순서. 돌려주는 값은 바뀌지 않으므로 memo 행에 넘겨도 된다.
 */
export function useListSelection(ids: number[]): ListSelection {
  const setSelected = useStore((s) => s.setSelected);
  const lastClicked = useRef<number | null>(null);

  const idsRef = useRef(ids);
  idsRef.current = ids;

  // 입력란에 있을 때는 그대로 둔다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input:not([type=checkbox]), textarea, select, [contenteditable=true], dialog')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(idsRef.current, true);
      } else if (
        e.key === 'Escape' &&
        // 열린 메뉴가 있으면 Esc는 메뉴만 닫는다
        !document.querySelector('[role=menu]') &&
        document.querySelector('li[aria-selected="true"]')
      ) {
        setSelected(idsRef.current, false);
      }
    };
    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [setSelected]);

  // Shift+클릭으로 범위 선택 (지금 보이는 정렬 순서 기준)
  const onCheck = (id: number, on: boolean, shift: boolean) => {
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
  };

  /** 이 목록에서 선택된 항목 (보이는 순서) */
  const selectedIds = () => {
    const sel = useStore.getState().selected;
    return idsRef.current.filter((id) => sel[id]);
  };

  return useRef({ onCheck, selectedIds }).current;
}

export type OnCheck = (id: number, on: boolean, shift: boolean) => void;
export interface ListSelection {
  onCheck: OnCheck;
  selectedIds: () => number[];
}

/**
 * 행 우클릭 (macOS Finder 방식). 선택은 바꾸지 않는다.
 * - 선택된 행이고 둘 이상 선택돼 있으면: 선택 전체에 대한 메뉴
 * - 아니면: 그 행 하나의 메뉴. 메뉴가 열린 동안 그 행에 테두리를 그린다
 */
export function openRowMenu(
  e: React.MouseEvent<HTMLElement>,
  id: number,
  selection: ListSelection,
  rowItems: () => MenuItem[],
  selectionItems: (ids: number[]) => MenuItem[],
) {
  // 메뉴는 포털로 그려져도 이벤트가 행으로 올라오므로, 행 안에서 난 우클릭만 받는다
  if (!e.currentTarget.contains(e.target as Node)) return;
  const ids = selection.selectedIds();
  if (ids.length > 1 && ids.includes(id)) openContextMenu(e, selectionItems(ids));
  else openContextMenu(e, rowItems(), id);
}

/** 행 안의 이 요소들을 누를 때는 선택을 바꾸지 않는다 */
const NO_SELECT = 'button, select, a, textarea, input, [role=menu], [role=menuitem]';

/** 선택할 수 있는 행(li)에 붙이는 속성과 이벤트 */
export function selectableRow(id: number, checked: boolean, { onCheck }: ListSelection) {
  return {
    'aria-selected': checked,
    // 키보드: Tab으로 행에 와서 Space로 선택 켜기/끄기
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== ' ' || e.target !== e.currentTarget) return;
      e.preventDefault();
      onCheck(id, !checked, e.shiftKey);
    },
    // Shift+클릭 때 글자가 드래그 선택되지 않게
    onMouseDown: (e: React.MouseEvent) => e.shiftKey && e.preventDefault(),
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      // 메뉴는 포털로 그려져도 이벤트가 행으로 올라오므로, 행 안에서 난 클릭만 받는다
      if (!e.currentTarget.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest(NO_SELECT)) return;
      // 클릭·⌘/Ctrl+클릭: 이 행만 켜고 끄기 · Shift+클릭: 마지막으로 누른 행부터 범위
      onCheck(id, !checked, e.shiftKey);
    },
  };
}

/** 선택할 수 있는 행의 모양: 선택되면 배경과 왼쪽 강조색 세로줄 */
export function selectableRowClass(checked: boolean, menuTarget = false) {
  return [
    'cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-highlight',
    checked ? 'bg-selected shadow-[inset_3px_0_0_var(--highlight)]' : 'hover:bg-hover',
    // 우클릭 메뉴가 이 행에 대해 열려 있다
    menuTarget && 'rounded-md outline-2 -outline-offset-2 outline-highlight',
  ]
    .filter(Boolean)
    .join(' ');
}
