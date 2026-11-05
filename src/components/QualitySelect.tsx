import { api } from "../api";
import { QUALITY_OPTIONS, type Video } from "../types";
import { control, cx } from "../ui";

export function heightLabel(h: number) {
  if (h >= 4320) return `${h}p (8K)`;
  if (h >= 2160) return `${h}p (4K)`;
  return `${h}p`;
}

/** 영상이 지원하는 화질만 보여준다. 화질 정보를 아직 모르면 정해진 목록. */
function options(v: Video): { value: string; label: string }[] {
  const hs = v.heights;
  if (!hs?.length) return QUALITY_OPTIONS;
  const opts = [
    { value: "best", label: `Best (${hs[0] >= 4320 ? "8K" : hs[0] >= 2160 ? "4K" : `${hs[0]}p`})` },
    ...hs.map((h) => ({ value: String(h), label: heightLabel(h) })),
    { value: "audio", label: "Audio only (m4a)" },
  ];
  // 예전에 고른 값이 목록에 없을 때도 보이도록
  if (!opts.some((o) => o.value === v.quality)) {
    const known = QUALITY_OPTIONS.find((o) => o.value === v.quality);
    opts.push({ value: v.quality, label: `${known?.label ?? v.quality} (not available)` });
  }
  return opts;
}

export function QualitySelect({ v }: { v: Video }) {
  const loading = v.metaState === "pending";
  return (
    <select
      className={cx(control, "w-[130px] shrink-0")}
      value={v.quality}
      disabled={v.status === "downloading"}
      onChange={(e) => api.setQuality(v.id, e.target.value)}
      title={
        loading
          ? "Loading available qualities"
          : v.heights?.length
            ? "Qualities this video offers"
            : "Couldn't load quality info, showing the default list"
      }
    >
      {options(v).map((q) => (
        <option key={q.value} value={q.value}>
          {q.label}
        </option>
      ))}
    </select>
  );
}
