import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { initStore, useStore } from './store';
import { AddPanel } from './components/AddPanel';
import { QueueView } from './components/QueueView';
import { DoneView } from './components/DoneView';
import { SettingsView } from './components/SettingsView';
import { Toast } from './toast';
import './App.css';

type Tab = 'queue' | 'done' | 'settings';

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
  return <footer className='footer'>{text}</footer>;
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
    <main className='app'>
      <AddPanel />
      <nav className='tabs'>
        <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>
          queue
          <span className='count'>{queueCount}</span>
        </button>
        <button className={tab === 'done' ? 'active' : ''} onClick={() => setTab('done')}>
          done
          {/* <span className='count'>{doneCount}</span> */}
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          settings
        </button>
      </nav>
      {error && <div className='notice error'>{error}</div>}
      {tab === 'queue' && <QueueView />}
      {tab === 'done' && <DoneView />}
      {tab === 'settings' && <SettingsView />}
      <Toast />
      <StatusBar tab={tab} />
    </main>
  );
}
