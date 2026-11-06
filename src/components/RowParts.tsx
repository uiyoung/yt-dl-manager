import { formatClip } from '../format';
import { copyText } from '../toast';
import type { Video } from '../types';
import { Badge } from '../ui';

/** 구간 항목 표시: 원본에서 어느 구간인지 */
export function ClipBadge({ video }: { video: Video }) {
  return (
    <span className='mr-1.5 inline-flex align-middle'>
      <Badge tone='info'>
        <span title={video.clipPrecise ? 'Cut exactly at these times' : 'Cut quickly (may start a few seconds early)'}>
          Clip {formatClip(video.clipStart!, video.clipEnd!)}
        </span>
      </Badge>
    </span>
  );
}

/** 메타 줄 끝의 YouTube 영상 ID. 누르면 복사한다 (separated: 앞에 다른 정보가 있어 ' · '로 띄운다) */
export function VideoIdTag({ video, separated }: { video: Video; separated: boolean }) {
  return (
    <>
      {separated && ' · '}
      <button
        type='button'
        className='cursor-pointer font-mono text-[11px] hover:text-fg hover:underline'
        title='YouTube video ID (click to copy)'
        onClick={() => copyText(video.videoId, 'Video ID copied')}
      >
        {video.videoId}
      </button>
    </>
  );
}
