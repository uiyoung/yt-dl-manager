import { api } from '../../api';
import { formatHeight } from '../../format';
import { QUALITY_OPTIONS, type Video } from '../../types';
import { cx, lineControl } from '../../ui';

export function QualitySelect({ video }: { video: Video }) {
  const loading = video.metaState === 'pending';
  const title = loading
    ? 'Loading available qualities'
    : video.heights?.length
      ? 'Qualities this video offers'
      : "Couldn't load quality info, showing the default list";

  return (
    <select
      className={cx(lineControl, 'w-32.5 shrink-0')}
      value={video.quality}
      disabled={video.status === 'downloading'}
      onChange={(e) => api.setQuality(video.id, e.target.value)}
      title={title}
    >
      {options(video).map((q) => (
        <option key={q.value} value={q.value}>
          {q.label}
        </option>
      ))}
    </select>
  );
}

/** 영상이 지원하는 화질만 보여준다. 화질 정보를 아직 모르면 정해진 목록. */
function options(video: Video): { value: string; label: string }[] {
  const hs = video.heights;
  if (!hs?.length) return QUALITY_OPTIONS;

  const opts = [
    { value: 'best', label: `Best (${hs[0] >= 4320 ? '8K' : hs[0] >= 2160 ? '4K' : `${hs[0]}p`})` },
    ...hs.map((h) => ({ value: String(h), label: formatHeight(h) })),
    { value: 'audio', label: 'Audio only (m4a)' },
  ];

  // 예전에 고른 값이 목록에 없을 때도 보이도록
  if (!opts.some((o) => o.value === video.quality)) {
    const known = QUALITY_OPTIONS.find((o) => o.value === video.quality);
    opts.push({ value: video.quality, label: `${known?.label ?? video.quality} (not available)` });
  }

  return opts;
}
