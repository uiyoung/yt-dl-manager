import { CloseIcon } from '../icons';
import { Badge, Button, cx } from '../ui';
import type { AddResult } from '../types';

type Tone = 'ok' | 'warn' | 'error';

export type Notice = { text: string; tone: Tone; result?: AddResult };

const toneClass: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  error: 'bg-error-bg text-error',
};

/** 주소·메시지를 고정폭 글자로, 넘치면 말줄임 */
const urlClass = 'truncate font-mono text-dim select-text';
const listItemClass = 'flex min-w-0 items-center gap-1.5';

/** 링크를 넣은 결과 알림: 요약 한 줄과, 건너뛴 항목들의 목록 */
export function AddNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const result = notice.result;

  return (
    <div className={cx('mt-2 flex items-start gap-2 rounded-md px-2.5 py-2', toneClass[notice.tone])}>
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <div>{notice.text}</div>
        {result && (
          <>
            <DetailList title='Already in list' count={result.duplicates.length}>
              {result.duplicates.map((d) => (
                <li key={d.videoId} className={listItemClass}>
                  <Badge>{d.status === 'done' ? 'Done' : 'Queue'}</Badge>
                  {d.title && <span className='max-w-[40%] truncate'>{d.title}</span>}
                  <span className={urlClass}>{d.url}</span>
                </li>
              ))}
            </DetailList>
            <TextDetailList title='Repeated in this paste' items={result.pasteDuplicates} />
            <TextDetailList title='Unrecognized links' items={result.unrecognized} />
            <TextDetailList title='Playlist errors' items={result.playlistErrors} />
          </>
        )}
      </div>
      <Button variant='ghost' onClick={onClose} aria-label='Close'>
        <CloseIcon />
      </Button>
    </div>
  );
}

/** 결과를 한 줄로 요약하고 색을 정한다 */
export function summarize(r: AddResult): Notice {
  const parts: string[] = [];

  if (r.added.length) {
    parts.push(`${r.added.length} added`);
  }

  if (r.duplicates.length) {
    parts.push(`${r.duplicates.length} already in list, skipped`);
  }

  if (r.pasteDuplicates.length) {
    parts.push(`${r.pasteDuplicates.length} repeated in paste`);
  }

  if (r.unrecognized.length) {
    parts.push(`${r.unrecognized.length} unrecognized`);
  }

  if (r.playlistErrors.length) {
    parts.push(`${r.playlistErrors.length} playlist ${r.playlistErrors.length === 1 ? 'error' : 'errors'}`);
  }

  if (!parts.length) {
    return { text: 'No YouTube links found.', tone: 'error', result: r };
  }

  return { text: parts.join(' · '), tone: r.added.length ? 'ok' : 'warn', result: r };
}

/** 항목이 많으면 접어서 보여준다 */
function DetailList({ title, children, count }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;

  return (
    <details open={count <= 5}>
      <summary className='cursor-pointer text-[12px] font-semibold'>
        {title} ({count})
      </summary>
      <ul className='mt-1 flex max-h-35 flex-col gap-0.75 overflow-y-auto pl-3.5 text-[12px] text-fg'>{children}</ul>
    </details>
  );
}

/** 글자 한 줄씩만 보여주는 목록 */
function TextDetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <DetailList title={title} count={items.length}>
      {items.map((item, i) => (
        <li key={i} className={listItemClass}>
          <span className={urlClass}>{item}</span>
        </li>
      ))}
    </DetailList>
  );
}
