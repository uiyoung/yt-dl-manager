import { create } from "zustand";
import { cx } from "./ui";

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
    <div
      role="status"
      className={cx(
        "fixed bottom-9 left-1/2 z-200 max-w-[80vw] -translate-x-1/2 rounded-lg px-3.5 py-2 shadow-[0_6px_20px_rgba(0,0,0,0.2)]",
        tone === "error" ? "bg-error text-white" : "bg-fg text-bg",
      )}
    >
      {message}
    </div>
  );
}

export async function copyText(text: string, what = "Copied") {
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
    if (!ok) return toast("Couldn't copy.", "error");
  }
  toast(what);
}
