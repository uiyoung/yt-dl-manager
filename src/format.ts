export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtDate(unix: number | null | undefined): string {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const thumbUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

/** 구간 시간 표시: 90 → "1:30", 3725.5 → "1:02:05.5" (0.1초 단위) */
export function fmtTime(sec: number): string {
  const tenths = Math.round(sec * 10);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return fmtDuration(whole) + (frac ? `.${frac}` : "");
}

/**
 * 시간 입력칸에 보여줄 모양: 1시간 넘는 영상은 "0:01:30", 짧은 영상은 "01:30" (0.1초 단위).
 * 짧은 영상이라도 1시간이 넘는 값은 시·분·초로 쓴다.
 */
export function fmtTimeField(sec: number, long: boolean): string {
  const tenths = Math.round(sec * 10);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  const base = long || h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return base + (frac ? `.${frac}` : "");
}

/** "90", "1:30", "1:02:05.5" 같은 시간을 초로. 읽을 수 없으면 null */
export function parseTime(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  const parts = t.split(":").map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** 구간 항목 표시: "1:30–2:45" */
export const fmtClip = (start: number, end: number) => `${fmtTime(start)}–${fmtTime(end)}`;
