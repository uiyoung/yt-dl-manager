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
function cmpNullable<T>(a: T | null | undefined, b: T | null | undefined, cmp: (x: T, y: T) => number, desc: boolean) {
  const an = a == null || a === '';
  const bn = b == null || b === '';
  if (an || bn) return an === bn ? 0 : an ? 1 : -1;
  const r = cmp(a as T, b as T);
  return desc ? -r : r;
}

const num = (x: number, y: number) => x - y;
const text = (x: string, y: string) => x.localeCompare(y, 'ko');

export function sortVideos(list: Video[], sort: Sort, which: 'queue' | 'done'): Video[] {
  const { key, desc } = sort;
  return [...list].sort((a, b) => {
    let r = 0;
    if (key === 'date') r = desc ? dateOf(b, which) - dateOf(a, which) : dateOf(a, which) - dateOf(b, which);
    else if (key === 'channel') r = cmpNullable(a.channel, b.channel, text, desc);
    else if (key === 'duration') r = cmpNullable(a.duration, b.duration, num, desc);
    else if (key === 'size') r = cmpNullable(sizeOf(a), sizeOf(b), num, desc);
    return r || a.id - b.id;
  });
}

/** 정렬 상태 (목록별로 기억) */
export function useSort(storageKey: string, initial: Sort) {
  const [sort, setSort] = useState<Sort>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return { ...initial, ...JSON.parse(saved) };
    } catch {
      /* 저장소를 못 쓰면 기본값 */
    }
    return initial;
  });
  const update = (s: Sort) => {
    setSort(s);
    try {
      localStorage.setItem(storageKey, JSON.stringify(s));
    } catch {
      /* 무시 */
    }
  };
  return [sort, update] as const;
}
