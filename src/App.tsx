import { useEffect, useState } from 'react';
import { initStore } from './store';
import { AddPanel } from './components/AddPanel';
import { TabBar, type Tab } from './components/TabBar';
import { QueueView } from './components/queue/QueueView';
import { DoneView } from './components/done/DoneView';
import { SettingsView } from './components/settings/SettingsView';
import { StatusBar } from './components/StatusBar';
import { Toast } from './toast';
import { CutDialogHost } from './components/CutDialog';
import { ContextMenuHost } from './components/RowMenu';

export default function App() {
  const [tab, setTab] = useState<Tab>('queue');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initStore().catch((e) => setError(String(e)));
  }, []);

  return (
    <div className='flex h-screen flex-col gap-3 px-4 pt-4'>
      <AddPanel />
      <TabBar tab={tab} onChange={setTab} />

      {error && (
        <div role='alert' className='rounded-md bg-error-bg px-2.5 py-2 text-error'>
          {error}
        </div>
      )}

      <main className='flex min-h-0 flex-1 flex-col'>
        <TabView tab={tab} />
      </main>
      <StatusBar tab={tab} />

      {/* 화면 위에 띄우는 것들 */}
      <Toast />
      <CutDialogHost />
      <ContextMenuHost />
    </div>
  );
}

function TabView({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'queue':
      return <QueueView />;
    case 'done':
      return <DoneView />;
    case 'settings':
      return <SettingsView />;
  }
}
