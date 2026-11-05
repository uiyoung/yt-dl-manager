import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { initStore, useStore } from "./store";
import { AddPanel } from "./components/AddPanel";
import { QueueView } from "./components/QueueView";
import { DoneView } from "./components/DoneView";
import { SettingsView } from "./components/SettingsView";
import "./App.css";

type Tab = "queue" | "done" | "settings";

export default function App() {
  const [tab, setTab] = useState<Tab>("queue");
  const [error, setError] = useState<string | null>(null);
  const [queueCount, doneCount] = useStore(
    useShallow((s) => {
      let q = 0;
      let d = 0;
      for (const v of Object.values(s.videos)) v.status === "done" ? d++ : q++;
      return [q, d];
    }),
  );
  const outputDir = useStore((s) => s.settings?.outputDir);

  useEffect(() => {
    initStore().catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="app">
      <AddPanel />
      <nav className="tabs">
        <button className={tab === "queue" ? "active" : ""} onClick={() => setTab("queue")}>
          대기열 <span className="count">{queueCount}</span>
        </button>
        <button className={tab === "done" ? "active" : ""} onClick={() => setTab("done")}>
          완료 목록 <span className="count">{doneCount}</span>
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          설정
        </button>
      </nav>
      {error && <div className="notice error">{error}</div>}
      {tab === "queue" && <QueueView />}
      {tab === "done" && <DoneView />}
      {tab === "settings" && <SettingsView />}
      <footer className="footer" title={outputDir}>
        저장 폴더: {outputDir ?? ""}
      </footer>
    </main>
  );
}
