import { useState } from 'react';
import type { Video } from './types';

export type SortKey = 'date' | 'channel' | 'duration' | 'size';
export interface Sort {
  key: SortKey;
  desc: boolean;
}

export const SORT_LABELS: Record<SortKey, string> = {
  date: 'Date',
  channel: 'Channel',
  duration: 'Duration',
  size: 'Size',
};

/** 대기열은 추가한 날짜, 완료 목록은 완료한 날짜 */
const dateOf = (v: Video, list: 'queue' | 'done') => (list === 'done' ? (v.completedAt ?? 0) : v.createdAt);

/** 완료 전에는 실제 크기가 없으므로 예상 크기로 비교 */
export const sizeOf = (v: Video) => v.fileSize ?? v.sizeEstimate;

/** 값이 없는 항목은 방향과 상관없이 항상 맨 뒤로 */
function compareNullable<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  compare: (x: T, y: T) => number,
  desc: boolean,
) {
  const aMissing = a == null || a === '';
  const bMissing = b == null || b === '';
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  const result = compare(a as T, b as T);
  return desc ? -result : result;
}

const compareNumbers = (x: number, y: number) => x - y;
const compareText = (x: string, y: string) => x.localeCompare(y, 'ko');

export function sortVideos(list: Video[], sort: Sort, which: 'queue' | 'done'): Video[] {
  const { key, desc } = sort;
  return [...list].sort((a, b) => {
    let result = 0;
    if (key === 'date') result = desc ? dateOf(b, which) - dateOf(a, which) : dateOf(a, which) - dateOf(b, which);
    else if (key === 'channel') result = compareNullable(a.channel, b.channel, compareText, desc);
    else if (key === 'duration') result = compareNullable(a.duration, b.duration, compareNumbers, desc);
    else if (key === 'size') result = compareNullable(sizeOf(a), sizeOf(b), compareNumbers, desc);
    // 같으면 먼저 넣은 순서대로
    return result || a.id - b.id;
  });
}

/** 정렬 상태 (목록별로 기억) */
export function useSort(storageKey: string, initial: Sort) {
  const [sort, setSort] = useState<Sort>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return { ...initial, ...JSON.parse(saved) };
      }
    } catch {
      /* 저장소를 못 쓰면 기본값 */
    }

    return initial;
  });

  const update = (next: Sort) => {
    setSort(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* 무시 */
    }
  };

  return [sort, update] as const;
}
