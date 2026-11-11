import { getCurrentWebview } from '@tauri-apps/api/webview';
import { create } from 'zustand';
import { toast } from './toast';

/** 고를 수 있는 배율. 단축키도 이 순서대로 한 칸씩 움직인다 */
export const ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
const KEY = 'zoom';

function loadZoom(): number {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (ZOOM_LEVELS.includes(saved)) {
      return saved;
    }
  } catch {
    // 저장소를 못 쓰면 100%로 시작한다
  }

  return 1;
}

/** 지금 배율. Settings의 선택 상자가 단축키로 바뀐 값도 따라가도록 스토어에 둔다 */
export const useZoom = create(() => ({ zoom: loadZoom() }));

/** 화면 전체(웹뷰)를 배율만큼 확대한다. 실패해도 앱 시작을 막지 않도록 조용히 넘어간다 */
export async function applyZoom(zoom: number) {
  if (!('__TAURI_INTERNALS__' in window)) {
    return;
  }

  try {
    // getCurrentWebview()는 창 정보가 없으면 바로 에러를 던지므로 함께 try 안에 둔다
    await getCurrentWebview().setZoom(zoom);
  } catch {
    // 확대만 안 될 뿐 앱은 그대로 쓸 수 있다
  }
}

export function saveZoom(zoom: number) {
  try {
    if (zoom === 1) {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, String(zoom));
    }
  } catch {
    // 저장하지 못해도 지금 화면에는 적용된다
  }

  useZoom.setState({ zoom });
  applyZoom(zoom);
}

/** 한 칸 확대(1), 축소(-1), 100%로(0) */
function stepZoom(step: 1 | -1 | 0) {
  const current = useZoom.getState().zoom;
  const index = ZOOM_LEVELS.indexOf(current);
  const next = step === 0 ? 1 : ZOOM_LEVELS[Math.min(Math.max(index + step, 0), ZOOM_LEVELS.length - 1)];
  if (next !== current) {
    saveZoom(next);
  }

  toast(`Zoom ${formatZoom(next)}`);
}

export function formatZoom(zoom: number) {
  return `${Math.round(zoom * 100)}%`;
}

/** 키 자리(e.code) → 배율 단계. 키보드 배열과 상관없이 같은 자리의 키로 판단한다 (숫자 패드 포함) */
const ZOOM_KEYS: Record<string, 1 | -1 | 0> = {
  Equal: 1,
  NumpadAdd: 1,
  Minus: -1,
  NumpadSubtract: -1,
  Digit0: 0,
  Numpad0: 0,
};

/** Ctrl/⌘ + = 확대, Ctrl/⌘ + - 축소, Ctrl/⌘ + 0 원래대로 */
export function installZoomShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) {
      return;
    }

    const step = ZOOM_KEYS[e.code];
    if (step === undefined) {
      return;
    }

    e.preventDefault();
    stepZoom(step);
  });
}
