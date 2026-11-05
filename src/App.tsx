import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { initStore, useStore } from './store';
import { AddPanel } from './components/AddPanel';
import { QueueView } from './components/QueueView';
import { DoneView } from './components/DoneView';
import { SettingsView } from './components/SettingsView';
import { Toast } from './toast';
import { buttonBase, cx } from './ui';

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
  if (tab === 'settings') return null;

  let text = '';

  if (tab === 'queue') {
    text = `Ready ${c.ready} · Active ${c.active} · Failed ${c.failed}`;
  } else if (tab === 'done') {
    text = `Done ${c.done}`;
  }
  return <footer className='truncate pt-2 pb-2.5 text-[12px] text-dim'>{text}</footer>;
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
          queue
          <span className='ml-1 rounded-[10px] bg-hover px-[7px] py-px text-[12px]'>{queueCount}</span>
        </button>
        <button className={tabClass(tab === 'done')} onClick={() => setTab('done')}>
          done
          {/* <span className='count'>{doneCount}</span> */}
        </button>
        <button className={tabClass(tab === 'settings')} onClick={() => setTab('settings')}>
          settings
        </button>
      </nav>
      {error && <div className='rounded-md bg-error-bg px-2.5 py-2 text-error'>{error}</div>}
      {tab === 'queue' && <QueueView />}
      {tab === 'done' && <DoneView />}
      {tab === 'settings' && <SettingsView />}
      <Toast />
      <StatusBar tab={tab} />
    </main>
  );
}
