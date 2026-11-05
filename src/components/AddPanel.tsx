import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { AddResult } from '../types';

type Tone = 'ok' | 'warn' | 'error';

function summarize(r: AddResult): { text: string; tone: Tone } {
  const parts: string[] = [];

  if (r.added.length) {
    parts.push(`${r.added.length}개 추가`);
  }

  if (r.duplicates.length) {
    parts.push(`이미 있는 영상 ${r.duplicates.length}개 건너뜀`);
  }

  if (r.pasteDuplicates.length) {
    parts.push(`붙여넣기 안 중복 ${r.pasteDuplicates.length}개`);
  }

  if (r.unrecognized.length) {
    parts.push(`인식하지 못한 링크 ${r.unrecognized.length}개`);
  }

  if (r.playlistErrors.length) {
    parts.push(`재생목록 오류 ${r.playlistErrors.length}개`);
  }

  if (!parts.length) return { text: 'YouTube 링크를 찾지 못했습니다.', tone: 'error' };
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
            'YouTube 링크를 붙여넣으세요. 여러 개를 한 번에 붙여넣어도 됩니다.\n(재생목록 링크는 안의 영상들로 펼쳐서 추가합니다 · Ctrl/⌘+Enter로 추가)'
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
          {busy ? '추가 중…' : '추가'}
        </button>
      </div>
      {notice && (
        <div className={`notice ${notice.tone}`}>
          <div className='notice-body'>
            <div>{notice.text}</div>
            {r && (
              <>
                <DetailList title='이미 있는 영상' count={r.duplicates.length}>
                  {r.duplicates.map((d) => (
                    <li key={d.videoId}>
                      <span className='badge'>{d.status === 'done' ? '완료 목록' : '대기열'}</span>
                      {d.title && <span className='detail-title'>{d.title}</span>}
                      <span className='url'>{d.url}</span>
                    </li>
                  ))}
                </DetailList>
                <DetailList title='붙여넣기 안에서 겹친 주소' count={r.pasteDuplicates.length}>
                  {r.pasteDuplicates.map((u, i) => (
                    <li key={i}>
                      <span className='url'>{u}</span>
                    </li>
                  ))}
                </DetailList>
                <DetailList title='인식하지 못한 링크' count={r.unrecognized.length}>
                  {r.unrecognized.map((u, i) => (
                    <li key={i}>
                      <span className='url'>{u}</span>
                    </li>
                  ))}
                </DetailList>
                <DetailList title='재생목록 오류' count={r.playlistErrors.length}>
                  {r.playlistErrors.map((m, i) => (
                    <li key={i}>
                      <span className='url'>{m}</span>
                    </li>
                  ))}
                </DetailList>
              </>
            )}
          </div>
          <button className='ghost' onClick={() => setNotice(null)} aria-label='닫기'>
            ✕
          </button>
        </div>
      )}
    </section>
  );
}
