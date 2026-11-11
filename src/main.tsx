import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTheme, getTheme } from './theme';
import { applyZoom, installZoomShortcuts, useZoom } from './zoom';

// 첫 화면이 그려지기 전에 테마를 정해 깜빡임이 없게 한다
applyTheme(getTheme());
installZoomShortcuts();

// 배포 빌드: 웹뷰 기본 우클릭 메뉴(새로 고침 등)와 새로 고침 단축키를 막는다.
// 입력칸은 붙여넣기·복사를 위해 기본 메뉴를 남긴다. 개발 중에는 Inspect Element를 위해 그대로 둔다.
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable=true]')) return;
    e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'f5' || ((e.metaKey || e.ctrlKey) && k === 'r')) e.preventDefault();
  });
}

async function boot() {
  // 브라우저에서 개발 서버만 띄웠을 때는 가짜 백엔드로 화면을 확인한다
  if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
    (await import('./devMock')).installDevMock();
  }

  // 저장해 둔 배율. 웹뷰 확대는 백엔드 호출이라, 개발용 가짜 백엔드를 붙인 다음에 한다
  applyZoom(useZoom.getState().zoom);

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot();
