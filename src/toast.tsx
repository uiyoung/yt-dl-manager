import { create } from "zustand";

interface ToastState {
  message: string | null;
  tone: "ok" | "error";
  show: (message: string, tone?: "ok" | "error") => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: "ok",
  show: (message, tone = "ok") => {
    clearTimeout(timer);
    set({ message, tone });
    timer = setTimeout(() => set({ message: null }), tone === "error" ? 5000 : 2000);
  },
}));

export const toast = (m: string, tone?: "ok" | "error") => useToast.getState().show(m, tone);

export function Toast() {
  const { message, tone } = useToast();
  if (!message) return null;
  return (
    <div className={`toast ${tone}`} role="status">
      {message}
    </div>
  );
}

export async function copyText(text: string, what = "복사했습니다") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 클립보드 API를 못 쓰는 환경 대비
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) return toast("복사하지 못했습니다.", "error");
  }
  toast(what);
}
