import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CloseIcon } from './icons';
import { Badge, Button, control, cx } from '../ui';
import type { AddResult } from '../types';

type Tone = 'ok' | 'warn' | 'error';

const toneClass: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  error: 'bg-error-bg text-error',
};

/** 주소·메시지를 고정폭 글자로, 넘치면 말줄임 */
const urlClass = 'truncate font-mono text-dim select-text';
const li = 'flex min-w-0 items-center gap-1.5';

function summarize(r: AddResult): { text: string; tone: Tone } {
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

  if (!parts.length) return { text: 'No YouTube links found.', tone: 'error' };
  return { text: parts.join(' · '), tone: r.added.length ? 'ok' : 'warn' };
}

/** 항목이 많으면 접어서 보여준다 */
function DetailList({ title, children, count }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <details open={count <= 5}>
      <summary className='cursor-pointer text-[12px] font-semibold'>
        {title} ({count})
      </summary>
      <ul className='mt-1 flex max-h-[140px] flex-col gap-[3px] overflow-y-auto pl-3.5 text-[12px] text-fg'>
        {children}
      </ul>
    </details>
  );
}

export function AddPanel() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: Tone; result?: AddResult } | null>(null);
  const upsert = useStore((s) => s.upsert);

  async function add() {
    if (!text.trim() || busy) return;

    setBusy(true);

    try {
      const r = await api.addLinks(text);
      upsert(r.added);
      setNotice({ ...summarize(r), result: r });
      if (r.added.length || r.duplicates.length) setText('');
    } catch (e) {
      setNotice({ text: String(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const r = notice?.result;

  return (
    <section>
      <div className='flex gap-2'>
        <textarea
          className={cx(control, 'min-h-16 flex-1 resize-y')}
          value={text}
          placeholder={
            'Paste YouTube links or video IDs (e.g. dQw4w9WgXcQ). You can paste many at once.\n(Playlist links are expanded into their videos · Ctrl/⌘+Enter to add)'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
          rows={3}
        />
        <Button variant='primary' className='min-w-[88px]' onClick={add} disabled={busy || !text.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {notice && (
        <div className={cx('mt-2 flex items-start gap-2 rounded-md px-2.5 py-2', toneClass[notice.tone])}>
          <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
            <div>{notice.text}</div>
            {r && (
              <>
                <DetailList title='Already in list' count={r.duplicates.length}>
                  {r.duplicates.map((d) => (
                    <li key={d.videoId} className={li}>
                      <Badge>{d.status === 'done' ? 'Done' : 'Queue'}</Badge>
                      {d.title && <span className='max-w-[40%] truncate'>{d.title}</span>}
                      <span className={urlClass}>{d.url}</span>
                    </li>
                  ))}
                </DetailList>
                <DetailList title='Repeated in this paste' count={r.pasteDuplicates.length}>
                  {r.pasteDuplicates.map((u, i) => (
                    <li key={i} className={li}>
                      <span className={urlClass}>{u}</span>
                    </li>
                  ))}
                </DetailList>
                <DetailList title='Unrecognized links' count={r.unrecognized.length}>
                  {r.unrecognized.map((u, i) => (
                    <li key={i} className={li}>
                      <span className={urlClass}>{u}</span>
                    </li>
                  ))}
                </DetailList>
                <DetailList title='Playlist errors' count={r.playlistErrors.length}>
                  {r.playlistErrors.map((m, i) => (
                    <li key={i} className={li}>
                      <span className={urlClass}>{m}</span>
                    </li>
                  ))}
                </DetailList>
              </>
            )}
          </div>
          <Button variant='ghost' onClick={() => setNotice(null)} aria-label='Close'>
            <CloseIcon />
          </Button>
        </div>
      )}
    </section>
  );
}
