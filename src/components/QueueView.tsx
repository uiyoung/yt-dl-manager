import { memo, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api } from '../api';
import { useStore } from '../store';
import { fmtBytes, fmtDuration, thumbUrl } from '../format';
import { sortVideos, useSort } from '../sort';
import { confirmRemove } from '../confirmRemove';
import { copyText, toast } from '../toast';
import type { Video } from '../types';
import { QualitySelect } from './QualitySelect';
import { RowMenu, type MenuItem } from './RowMenu';
import { SortControl } from './SortControl';
import { DownloadIcon, RetryIcon, StopIcon, TrashIcon } from './icons';

const ProgressInfo = memo(function ProgressInfo({ id }: { id: number }) {
  const p = useStore((s) => s.progress[id]);
  if (!p) return <div className='status-line'>Starting…</div>;
  if (p.stage === 'processing')
    return (
      <div className='status-line'>
        <div className='bar indeterminate' />
        <span>Processing file…</span>
      </div>
    );
  return (
    <div className='status-line'>
      <div className='bar'>
        <div className='fill' style={{ width: `${p.percent}%` }} />
      </div>
      <span className='nums'>
        {p.percent.toFixed(1)}%{p.total ? ` · ${fmtBytes(p.total)}` : ''}
        {p.speed ? ` · ${fmtBytes(p.speed)}/s` : ''}
        {p.eta != null ? ` · ${fmtDuration(p.eta)} left` : ''}
      </span>
    </div>
  );
});

function StatusCell({ v }: { v: Video }) {
  switch (v.status) {
    case 'downloading':
      return <ProgressInfo id={v.id} />;
    case 'queued':
      return (
        <div className='status-line'>
          <span className='badge pending'>Queued</span>
        </div>
      );
    case 'error':
      return (
        <div className='status-line error' title={v.errorMsg ?? ''}>
          <span className='badge error'>Failed</span>
          <span className='err-text'>{v.errorMsg}</span>
        </div>
      );
    default:
      return (
        <div className='status-line'>
          <span className='badge'>Ready</span>
        </div>
      );
  }
}

/** 상태에 따라 줄마다 하나의 주 동작 버튼 */
function RowAction({ v }: { v: Video }) {
  switch (v.status) {
    case 'ready':
      return (
        <button onClick={() => api.download([v.id])}>
          <DownloadIcon /> Download
        </button>
      );
    case 'error':
      return (
        <button className='retry' onClick={() => api.download([v.id])}>
          <RetryIcon /> Retry
        </button>
      );
    case 'queued':
    case 'downloading':
      return (
        <button onClick={() => api.stop([v.id])}>
          <StopIcon /> Stop
        </button>
      );
    default:
      return null;
  }
}

async function removeVideos(ids: number[]) {
  const all = useStore.getState().videos;
  if (!(await confirmRemove(ids.map((id) => all[id]).filter(Boolean)))) return;
  await api.remove(ids);
  useStore.getState().remove(ids);
}

function menuItems(v: Video): MenuItem[] {
  const editable = v.status === 'ready' || v.status === 'error';
  const items: MenuItem[] = [
    { label: 'Open on YouTube', onClick: () => openUrl(v.url) },
    { label: 'Copy YouTube link', onClick: () => copyText(v.url, 'Link copied') },
    'separator',
    {
      label: 'Change save folder…',
      disabled: !editable,
      hint: editable ? undefined : "Can't change while downloading or queued",
      onClick: async () => {
        const defaultPath = v.outputDir ?? useStore.getState().settings?.outputDir;
        const dir = await open({ directory: true, defaultPath, title: 'Save this video to' });
        if (typeof dir !== 'string') return;
        try {
          await api.setOutputDir(v.id, dir);
          toast('Save folder changed');
        } catch (e) {
          toast(String(e), 'error');
        }
      },
    },
  ];
  if (v.outputDir)
    items.push({
      label: 'Use default save folder',
      disabled: !editable,
      onClick: () => api.setOutputDir(v.id, null).catch((e) => toast(String(e), 'error')),
    });
  if (v.errorMsg) items.push({ label: 'Copy error message', onClick: () => copyText(v.errorMsg!) });
  items.push('separator', { label: 'Remove from list', danger: true, onClick: () => removeVideos([v.id]) });
  return items;
}

/** 행 안의 이 요소들을 누를 때는 선택을 바꾸지 않는다 */
const NO_SELECT = 'button, select, a, textarea, input, [role=menu], [role=menuitem]';

const QueueRow = memo(function QueueRow({
  id,
  onCheck,
}: {
  id: number;
  onCheck: (id: number, on: boolean, shift: boolean) => void;
}) {
  const v = useStore((s) => s.videos[id]);
  const checked = useStore((s) => !!s.selected[id]);
  if (!v) return null;
  const size = v.sizeEstimate ? `~${fmtBytes(v.sizeEstimate)}` : null;
  return (
    <li
      className={`row selectable status-${v.status}${checked ? ' selected' : ''}`}
      aria-selected={checked}
      // 키보드: Tab으로 행에 와서 Space로 선택 켜기/끄기
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== ' ' || e.target !== e.currentTarget) return;
        e.preventDefault();
        onCheck(id, !checked, e.shiftKey);
      }}
      // Shift+클릭 때 글자가 드래그 선택되지 않게
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onClick={(e) => {
        // 메뉴는 포털로 그려져도 이벤트가 행으로 올라오므로, 행 안에서 난 클릭만 받는다
        if (!e.currentTarget.contains(e.target as Node)) return;
        if ((e.target as HTMLElement).closest(NO_SELECT)) return;
        // 클릭·⌘/Ctrl+클릭: 이 행만 켜고 끄기 · Shift+클릭: 마지막으로 누른 행부터 범위
        onCheck(id, !checked, e.shiftKey);
      }}
    >
      <img className='thumb' src={thumbUrl(v.videoId)} alt='' loading='lazy' />
      <div className='info'>
        <div className='title' title={v.title ?? v.url}>
          {v.title ?? (v.metaState === 'pending' ? 'Loading info…' : v.url)}
        </div>
        <div className='meta'>
          {[v.channel, fmtDuration(v.duration)].filter(Boolean).join(' · ')}
          {size && (
            <span title='Estimated size at best quality'>
              {v.channel || v.duration ? ' · ' : ''}
              {size}
            </span>
          )}
        </div>
        {v.outputDir && (
          <div className='meta folder' title={v.outputDir}>
            Save folder: {v.outputDir}
          </div>
        )}
        <StatusCell v={v} />
      </div>
      <QualitySelect v={v} />
      <div className='actions'>
        <RowAction v={v} />
        <RowMenu items={menuItems(v)} />
        <button
          className='ghost icon-btn danger-hover'
          title='Remove from list (downloaded file is kept)'
          aria-label='Remove from list'
          onClick={() => removeVideos([v.id])}
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
});

export function QueueView() {
  const [sort, setSort] = useSort('sort.queue', { key: 'date', desc: false });
  const ids = useStore(
    useShallow((s) =>
      sortVideos(
        Object.values(s.videos).filter((v) => v.status !== 'done'),
        sort,
        'queue',
      ).map((v) => v.id),
    ),
  );
  const counts = useStore(
    useShallow((s) => {
      const c = { sel: 0, selStartable: 0, selStoppable: 0 };
      for (const v of Object.values(s.videos)) {
        if (v.status === 'done') continue;
        const startable = v.status === 'ready' || v.status === 'error';
        const stoppable = v.status === 'queued' || v.status === 'downloading';
        if (s.selected[v.id]) {
          c.sel++;
          if (startable) c.selStartable++;
          if (stoppable) c.selStoppable++;
        }
      }
      return c;
    }),
  );
  const setSelected = useStore((s) => s.setSelected);
  const clearSelection = useStore((s) => s.clearSelection);
  const lastClicked = useRef<number | null>(null);

  const idsRef = useRef(ids);
  idsRef.current = ids;

  // ⌘/Ctrl+A 전체 선택, Esc 선택 해제 (입력란에 있을 때는 그대로 둔다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input:not([type=checkbox]), textarea, select, [contenteditable=true]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(idsRef.current, true);
      } else if (
        e.key === 'Escape' &&
        // 열린 메뉴가 있으면 Esc는 메뉴만 닫는다
        !document.querySelector('[role=menu]') &&
        document.querySelector('.row.selected')
      ) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelected, clearSelection]);

  // Shift+클릭으로 범위 선택 (지금 보이는 정렬 순서 기준)
  const onCheck = useRef((id: number, on: boolean, shift: boolean) => {
    const list = idsRef.current;
    const from = lastClicked.current != null ? list.indexOf(lastClicked.current) : -1;
    const to = list.indexOf(id);
    if (shift && from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      setSelected(list.slice(a, b + 1), on);
    } else {
      setSelected([id], on);
    }
    lastClicked.current = id;
  }).current;

  const selectedIds = () => {
    const sel = useStore.getState().selected;
    return idsRef.current.filter((id) => sel[id]);
  };
  const allChecked = ids.length > 0 && counts.sel === ids.length;

  return (
    <div className='view'>
      <div className='toolbar'>
        <label className='check select-all' title='Select all'>
          <input
            type='checkbox'
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = counts.sel > 0 && !allChecked;
            }}
            onChange={() => (allChecked ? clearSelection() : setSelected(ids, true))}
            disabled={!ids.length}
          />
          {counts.sel ? `${counts.sel} selected` : 'Select all'}
        </label>
        <button className='primary' disabled={!counts.selStartable} onClick={() => api.download(selectedIds())}>
          <DownloadIcon /> Download selected{counts.selStartable ? ` (${counts.selStartable})` : ''}
        </button>
        <button disabled={!counts.selStoppable} onClick={() => api.stop(selectedIds())}>
          <StopIcon /> Stop selected
        </button>
        <button
          disabled={!counts.sel}
          onClick={() => removeVideos(selectedIds())}
          title='Remove selected videos from the list'
        >
          <TrashIcon /> Remove selected
        </button>
        <span className='spacer' />
        <SortControl sort={sort} onChange={setSort} dateLabel='Date added' />
      </div>

      {ids.length === 0 ? (
        <div className='empty'>The queue is empty. Paste links above to add videos.</div>
      ) : (
        <ul className='list'>
          {ids.map((id) => (
            <QueueRow key={id} id={id} onCheck={onCheck} />
          ))}
        </ul>
      )}
    </div>
  );
}
