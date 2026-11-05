import { setTheme as setAppTheme } from "@tauri-apps/api/app";

export type Theme = "system" | "light" | "dark";
const KEY = "theme";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    // 저장소를 못 쓰면 시스템 설정을 따른다
  }
  return "system";
}

/** 화면 색과, 창 제목 표시줄·확인창 같은 기본 창의 테마를 함께 바꾼다. */
export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
  if ("__TAURI_INTERNALS__" in window) {
    setAppTheme(t === "system" ? null : t).catch(() => {});
  }
}

export function saveTheme(t: Theme) {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    // 저장하지 못해도 지금 화면에는 적용된다
  }
  applyTheme(t);
}
