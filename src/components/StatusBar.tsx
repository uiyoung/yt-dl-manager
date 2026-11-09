import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import type { Tab } from './TabBar';

/** 아래 상태줄: 탭마다 그 탭의 건수를 보여준다 (settings에서는 보이지 않음) */
export function StatusBar({ tab }: { tab: Tab }) {
  const counts = useStore(
    useShallow((state) => {
      const counts = { ready: 0, active: 0, failed: 0, done: 0 };
      for (const video of Object.values(state.videos)) {
        if (video.status === 'ready') {
          counts.ready++;
        } else if (video.status === 'queued' || video.status === 'downloading') {
          counts.active++;
        } else if (video.status === 'error') {
          counts.failed++;
        } else if (video.status === 'done') {
          counts.done++;
        }
      }

      return counts;
    }),
  );

  const pausedUntil = useStore((s) => s.metaPausedUntil);

  if (tab === 'settings') {
    return null;
  }

  const text =
    tab === 'queue'
      ? `Ready ${counts.ready} · Active ${counts.active} · Failed ${counts.failed}`
      : `Done ${counts.done}`;

  // 정보 조회를 쉬는 중이면 언제 다시 시작하는지 알린다
  const paused =
    tab === 'queue' && pausedUntil
      ? `Video info paused by YouTube's request limit · retrying at ${new Date(pausedUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
      : null;

  return (
    <footer className='truncate pt-2 pb-2.5 text-[12px] text-dim'>
      {text}
      {paused && <span className='text-warn'> · {paused}</span>}
    </footer>
  );
}
