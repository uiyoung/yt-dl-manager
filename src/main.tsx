import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, getTheme } from "./theme";

// 첫 화면이 그려지기 전에 테마를 정해 깜빡임이 없게 한다
applyTheme(getTheme());

async function boot() {
  // 브라우저에서 개발 서버만 띄웠을 때는 가짜 백엔드로 화면을 확인한다
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    (await import("./devMock")).installDevMock();
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot();
