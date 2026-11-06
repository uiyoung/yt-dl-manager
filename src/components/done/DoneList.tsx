import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useListSelection } from '../../selection';
import type { Video } from '../../types';
import { DoneRow, ROW_HEIGHT } from './DoneRow';
import { listClass } from '../../ui';

/**
 * done 목록. 선택 방식은 useListSelection. 빈 목록일 때는 DoneView가 안내를 보여 준다.
 * 완료 영상이 몇천 개여도 느려지지 않도록 화면에 보이는 줄(과 위아래 몇 줄)만 그린다.
 * 스크롤 길이는 전체 개수만큼 잡으므로 스크롤바는 평소처럼 동작한다.
 */
export function DoneList({ list, ids }: { list: Video[]; ids: number[] }) {
  const selection = useListSelection(ids);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: list.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (i) => list[i].id,
    overscan: 6,
  });

  return (
    <div ref={scrollRef} className={listClass}>
      <ul className='relative' style={{ height: virt.getTotalSize() }}>
        {virt.getVirtualItems().map((item) => (
          <DoneRow
            key={item.key}
            video={list[item.index]}
            index={item.index}
            top={item.start}
            last={item.index === list.length - 1}
            measure={virt.measureElement}
            selection={selection}
          />
        ))}
      </ul>
    </div>
  );
}
