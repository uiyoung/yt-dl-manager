import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CloseIcon } from './icons';
import type { AddResult } from '../types';

type Tone = 'ok' | 'warn' | 'error';

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
    <details className='detail' open={count <= 5}>
      <summary>
        {title} ({count})
      </summary>
      <ul>{children}</ul>
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
    <section className='add-panel'>
      <div className='add-row'>
        <textarea
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
        <button className='primary add-btn' onClick={add} disabled={busy || !text.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {notice && (
        <div className={`notice ${notice.tone}`}>
          <div className='notice-body'>
            <div>{notice.text}</div>
            {r && (
              <>
                <DetailList title='Already in list' count={r.duplicates.length}>
                  {r.duplicates.map((d) => (
                    <li key={d.videoId}>
                      <span className='badge'>{d.status === 'done' ? 'Done' : 'Queue'}</span>
                      {d.title && <span className='detail-title'>{d.title}</span>}
                      <span className='url'>{d.url}</span>
                    </li>
                  ))}
                </DetailList>
                <DetailList title='Repeated in this paste' count={r.pasteDuplicates.length}>
                  {r.pasteDuplicates.map((u, i) => (
                    <li key={i}>
                      <span className='url'>{u}</span>
                    </li>
                  ))}
                </DetailList>
                <DetailList title='Unrecognized links' count={r.unrecognized.length}>
                  {r.unrecognized.map((u, i) => (
                    <li key={i}>
                      <span className='url'>{u}</span>
                    </li>
                  ))}
                </DetailList>
                <DetailList title='Playlist errors' count={r.playlistErrors.length}>
                  {r.playlistErrors.map((m, i) => (
                    <li key={i}>
                      <span className='url'>{m}</span>
                    </li>
                  ))}
                </DetailList>
              </>
            )}
          </div>
          <button className='ghost' onClick={() => setNotice(null)} aria-label='Close'>
            <CloseIcon />
          </button>
        </div>
      )}
    </section>
  );
}
