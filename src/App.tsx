import { useEffect, useState } from 'react';
import { initStore, useStore } from './store';
import { AddPanel } from './components/AddPanel';
import { QueueView } from './components/QueueView';
import { DoneView } from './components/DoneView';
import { SettingsView } from './components/SettingsView';
import './App.css';

type Tab = 'queue' | 'done' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('queue');
  const [error, setError] = useState<string | null>(null);
  const queueCount = useStore((s) => {
    let q = 0;
    for (const v of Object.values(s.videos)) if (v.status !== 'done') q++;
    return q;
  });
  const outputDir = useStore((s) => s.settings?.outputDir);

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
      <footer className='footer' title={outputDir}>
        저장 폴더: {outputDir ?? ''}
      </footer>
    </main>
  );
}
