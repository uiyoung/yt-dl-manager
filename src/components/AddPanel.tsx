import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Button, control, cx } from '../ui';
import { askPlaylist } from '../askPlaylist';
import { AddNotice, summarize, type Notice } from './AddNotice';

export function AddPanel() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const upsert = useStore((state) => state.upsert);

  async function add() {
    if (!text.trim() || busy) {
      return;
    }

    setBusy(true);

    try {
      // 재생목록 안의 영상 링크가 있으면 재생목록 전체를 넣을지 먼저 묻는다
      const inPlaylist = await api.playlistVideoLinks(text);
      let expand = false;
      if (inPlaylist.length) {
        const choice = await askPlaylist(inPlaylist);
        if (!choice) return;
        expand = choice === 'playlist';
      }
      const r = await api.addLinks(text, expand);
      upsert(r.added);
      setNotice(summarize(r));
      if (r.added.length || r.duplicates.length) {
        setText('');
      }
    } catch (e) {
      setNotice({ text: String(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <header>
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
        <Button variant='primary' className='min-w-22' onClick={add} disabled={busy || !text.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>

      {notice && <AddNotice notice={notice} onClose={() => setNotice(null)} />}
    </header>
  );
}
