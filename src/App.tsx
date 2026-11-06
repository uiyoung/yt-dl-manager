import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { initStore, useStore } from './store';
import { AddPanel } from './components/AddPanel';
import { QueueView } from './components/QueueView';
import { DoneView } from './components/DoneView';
import { SettingsView } from './components/SettingsView';
import { Toast } from './toast';
import { CutDialogHost } from './components/CutDialog';
import { buttonBase, cx } from './ui';
import { DoneIcon, QueueIcon, SettingsIcon } from './icons';

type Tab = 'queue' | 'done' | 'settings';

/** 탭 버튼: 아래 밑줄로 현재 탭을 표시 */
function tabClass(active: boolean) {
  return cx(
    buttonBase,
    'border-b-2 px-3.5 py-2 enabled:hover:bg-hover',
    active ? 'border-highlight font-semibold text-fg' : 'border-transparent text-dim',
  );
}

/** 아래 상태줄: 탭마다 그 탭의 건수를 보여준다 (settings에서는 보이지 않음) */
function StatusBar({ tab }: { tab: Tab }) {
  const c = useStore(
    useShallow((s) => {
      const c = { ready: 0, active: 0, failed: 0, done: 0 };
      for (const v of Object.values(s.videos)) {
        if (v.status === 'ready') c.ready++;
        else if (v.status === 'queued' || v.status === 'downloading') c.active++;
        else if (v.status === 'error') c.failed++;
        else if (v.status === 'done') c.done++;
      }
      return c;
    }),
  );
  const pausedUntil = useStore((s) => s.metaPausedUntil);
  if (tab === 'settings') return null;

  let text = '';

  if (tab === 'queue') {
    text = `Ready ${c.ready} · Active ${c.active} · Failed ${c.failed}`;
  } else if (tab === 'done') {
    text = `Done ${c.done}`;
  }
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

export default function App() {
  const [tab, setTab] = useState<Tab>('queue');
  const [error, setError] = useState<string | null>(null);
  const queueCount = useStore((s) => {
    let q = 0;
    for (const v of Object.values(s.videos)) if (v.status !== 'done') q++;
    return q;
  });

  useEffect(() => {
    initStore().catch((e) => setError(String(e)));
  }, []);

  return (
    <main className='flex h-screen flex-col gap-3 px-4 pt-4'>
      <AddPanel />
      <nav className='flex gap-1 border-b border-line'>
        <button className={tabClass(tab === 'queue')} onClick={() => setTab('queue')}>
          <QueueIcon />
          queue
          {/* 대기열에 항목이 있으면 파란색으로, 비었으면 흐리게 */}
          <span
            className={cx(
              'rounded-[10px] px-[7px] py-px text-[12px] tabular-nums',
              queueCount ? 'bg-info-bg font-semibold text-info' : 'bg-hover text-dim',
            )}
          >
            {queueCount}
          </span>
        </button>
        <button className={tabClass(tab === 'done')} onClick={() => setTab('done')}>
          <DoneIcon />
          done
          {/* <span className='count'>{doneCount}</span> */}
        </button>
        {/* 설정은 오른쪽 끝에 톱니바퀴 아이콘만 */}
        <button
          className={cx(tabClass(tab === 'settings'), 'ml-auto px-2.5')}
          onClick={() => setTab('settings')}
          title='Settings'
          aria-label='Settings'
        >
          <SettingsIcon />
        </button>
      </nav>
      {error && <div className='rounded-md bg-error-bg px-2.5 py-2 text-error'>{error}</div>}
      {tab === 'queue' && <QueueView />}
      {tab === 'done' && <DoneView />}
      {tab === 'settings' && <SettingsView />}
      <Toast />
      <CutDialogHost />
      <StatusBar tab={tab} />
    </main>
  );
}
