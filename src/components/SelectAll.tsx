import { useStore } from '../store';

/** 도구줄의 전체 선택 체크박스. 고른 개수를 함께 보여 준다 (ids: 지금 보이는 항목) */
export function SelectAll({ ids, selected }: { ids: number[]; selected: number }) {
  const setSelected = useStore((state) => state.setSelected);
  const allChecked = ids.length > 0 && selected === ids.length;

  return (
    <label className='flex min-w-27 cursor-pointer items-center gap-2 pr-1.5 pl-3 text-dim'>
      <input
        type='checkbox'
        className='m-0 size-4 shrink-0 cursor-pointer accent-highlight'
        checked={allChecked}
        ref={(el) => {
          if (el) {
            el.indeterminate = selected > 0 && !allChecked;
          }
        }}
        onChange={() => setSelected(ids, !allChecked)}
        disabled={!ids.length}
      />
      {selected ? `${selected} selected` : 'Select all'}
    </label>
  );
}
