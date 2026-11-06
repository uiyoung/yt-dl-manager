import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { api } from '../api';
import { useStore } from '../store';
import { formatTime, formatTimeField, parseTime } from '../format';
import { toast } from '../toast';
import type { Video } from '../types';
import { Button, cx, lineControl } from '../ui';

/**
 * 구간 자르기 창.
 * - queue: 고른 구간을 새 대기열 항목으로 넣는다. 받을 때 그 구간만 받는다.
 * - done: 받은 파일을 미리보기로 보며 구간을 정하고, 원본 옆에 새 파일로 저장한다.
 */
type Mode = 'queue' | 'done';

const useCut = create<{ target: { id: number; mode: Mode } | null }>(() => ({ target: null }));

export const openCut = (id: number, mode: Mode) => useCut.setState({ target: { id, mode } });
const closeCut = () => useCut.setState({ target: null });

/** 앱에 한 번만 두면, openCut()으로 연 창을 띄운다 */
export function CutDialogHost() {
  const target = useCut((s) => s.target);
  const video = useStore((s) => (target ? s.videos[target.id] : undefined));
  if (!target || !video) return null;
  // key: 다른 영상을 열면 입력값을 새로 시작한다
  return <CutDialog key={`${target.mode}-${video.id}`} video={video} mode={target.mode} />;
}

const label = 'font-semibold';
const hint = 'text-dim [font-size:smaller]';

function CutDialog({ video, mode }: { video: Video; mode: Mode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  // 1시간 넘는 영상이면 시·분·초로 입력받는다
  const long = (video.duration ?? 0) >= 3600;
  const toText = (sec: number) => formatTimeField(sec, long);
  const [startText, setStartText] = useState(toText(0));
  const [endText, setEndText] = useState(video.duration ? toText(video.duration) : '');
  const [precise, setPrecise] = useState(false);
  const [preview, setPreview] = useState<{ src: string | null; error: string | null }>({ src: null, error: null });
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 미리보기 '구간 재생'에서 끝 지점에 멈추기 위해
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // done: 받은 파일을 미리보기로 연다
  useEffect(() => {
    if (mode !== 'done') return;
    api
      .allowPreview(video.id)
      .then((path) => setPreview({ src: convertFileSrc(path), error: null }))
      .catch((e) => setPreview({ src: null, error: String(e) }));
  }, [mode, video.id]);

  // 자르는 중 진행률
  useEffect(() => {
    if (mode !== 'done') return;
    const off = listen<{ id: number; percent: number }>('cut-progress', (e) => {
      if (e.payload.id === video.id) setPercent(e.payload.percent);
    });
    return () => {
      off.then((f) => f());
    };
  }, [mode, video.id]);

  const start = parseTime(startText);
  const end = parseTime(endText);
  const problem =
    start == null
      ? 'Enter the start like 1:30 or 90.'
      : end == null
        ? 'Enter the end like 2:45 or 165.'
        : end <= start
          ? 'The end must be after the start.'
          : video.duration && end > video.duration + 1
            ? `The end is past the end of the video (${formatTime(video.duration)}).`
            : null;

  function close() {
    if (busy) return;
    closeCut();
  }

  /** 미리보기의 지금 위치를 시작 또는 끝으로 */
  function setFromPlayer(which: 'start' | 'end') {
    const t = player.current?.currentTime;
    if (t == null) return;
    (which === 'start' ? setStartText : setEndText)(toText(t));
  }

  /** 정한 구간만 재생해 본다 */
  function playSection() {
    const el = player.current;
    if (!el || start == null || end == null) return;
    el.currentTime = start;
    stopAt.current = end;
    void el.play();
  }

  async function submit() {
    if (problem || start == null || end == null) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === 'queue') {
        const clip = await api.addClip(video.id, start, end, precise);
        useStore.getState().upsert([clip]);
        toast('Clip added to the queue');
      } else {
        player.current?.pause();
        setPercent(0);
        const clip = await api.cutDoneVideo(video.id, start, end, precise);
        useStore.getState().upsert([clip]);
        toast('Clip saved');
      }
      setBusy(false);
      closeCut();
    } catch (e) {
      setBusy(false);
      setPercent(null);
      if (String(e) !== 'Canceled.') setError(String(e));
    }
  }

  const fileName = video.filePath?.split(/[\\/]/).pop() ?? '';

  return (
    <dialog
      ref={dialog}
      className='m-auto max-h-[90vh] w-[min(640px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-line bg-panel p-0 text-fg shadow-[0_12px_40px_rgba(0,0,0,0.3)] backdrop:bg-black/40'
      // Esc: 자르는 중에는 닫지 않는다
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <form
        className='flex flex-col gap-4 p-5'
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className='flex flex-col gap-1'>
          <h2 className='text-[16px] font-semibold'>Cut a section</h2>
          <div className='truncate text-dim' title={video.title ?? video.url}>
            {video.title ?? video.url}
            {video.duration ? ` · ${formatTime(video.duration)}` : ''}
          </div>
        </header>

        {mode === 'done' &&
          (preview.src ? (
            <video
              ref={player}
              className='aspect-video w-full rounded-md bg-black'
              src={preview.src}
              controls
              preload='metadata'
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                if (stopAt.current != null && el.currentTime >= stopAt.current) {
                  el.pause();
                  stopAt.current = null;
                }
              }}
              onSeeking={() => {
                // 사용자가 직접 옮기면 '구간 재생'을 멈춘다
                if (!player.current || player.current.paused) stopAt.current = null;
              }}
              onError={() =>
                setPreview({
                  src: null,
                  error: "This file can't be previewed here (its format may not be supported). You can still type the times.",
                })
              }
            />
          ) : (
            <div className='flex aspect-video w-full items-center justify-center rounded-md bg-bar px-6 text-center text-dim'>
              {preview.error ?? 'Loading preview…'}
            </div>
          ))}

        <div className='flex flex-wrap items-end gap-3'>
          <TimeField label='Start' value={startText} onChange={setStartText} disabled={busy} long={long} max={video.duration}>
            {mode === 'done' && preview.src && (
              <Button type='button' onClick={() => setFromPlayer('start')} disabled={busy} title='Use the current position'>
                Set to current
              </Button>
            )}
          </TimeField>
          <TimeField label='End' value={endText} onChange={setEndText} disabled={busy} long={long} max={video.duration}>
            {mode === 'done' && preview.src && (
              <Button type='button' onClick={() => setFromPlayer('end')} disabled={busy} title='Use the current position'>
                Set to current
              </Button>
            )}
          </TimeField>
          {mode === 'done' && preview.src && (
            <Button type='button' onClick={playSection} disabled={busy || !!problem}>
              Play section
            </Button>
          )}
        </div>
        <div className={cx('-mt-2', problem ? 'text-error' : 'text-dim')}>
          {problem ?? `Length ${formatTime(end! - start!)}`}
        </div>

        <label className='flex cursor-pointer items-start gap-2'>
          <input
            type='checkbox'
            className='mt-0.75 mr-0.75 mb-0.75 ml-1'
            checked={precise}
            disabled={busy}
            onChange={(e) => setPrecise(e.target.checked)}
          />
          <span className='flex flex-col gap-0.5'>
            <span>Cut exactly at these times</span>
            <small className={hint}>
              Re-encodes the clip, so it takes longer. Without it the clip is cut quickly without re-encoding, but it
              starts at the nearest earlier keyframe, usually a few seconds before the start time.
            </small>
          </span>
        </label>

        <p className={hint}>
          {mode === 'queue'
            ? 'A new item is added to the queue. Downloading it gets only this section, with the times in the file name.'
            : `Saved next to the original as “${fileName.replace(/(\.[^.]+)?$/, ' (…)$1')}”. The original is kept.`}
        </p>

        {busy && percent != null && (
          <div className='flex items-center gap-2 text-[12px] text-dim'>
            <div className='relative h-1.5 flex-1 overflow-hidden rounded-[3px] bg-bar'>
              <div className='h-full bg-highlight transition-[width]' style={{ width: `${percent}%` }} />
            </div>
            <span className='tabular-nums'>{percent.toFixed(0)}%</span>
          </div>
        )}
        {error && <div className='rounded-md bg-error-bg px-2.5 py-2 text-error'>{error}</div>}

        <footer className='flex justify-end gap-2'>
          {busy && mode === 'done' ? (
            <Button type='button' onClick={() => api.cancelCut(video.id)}>
              Stop
            </Button>
          ) : (
            <Button type='button' onClick={close}>
              Cancel
            </Button>
          )}
          <Button variant='primary' type='submit' disabled={busy || !!problem}>
            {mode === 'queue' ? 'Add to queue' : busy ? 'Saving…' : 'Save clip'}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}

/**
 * 시간 입력칸. "90", "1:30", "1:02:05.5"처럼 자유롭게 쓰고, 칸을 벗어나면 일정한 모양으로 맞춘다.
 * ↑/↓: 1초씩, Shift+↑/↓: 0.1초씩 조정.
 */
function TimeField({
  label: text,
  value,
  onChange,
  disabled,
  long,
  max,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  long: boolean;
  /** 영상 길이 (알면 그 이상으로 올리지 않는다) */
  max: number | null;
  children?: React.ReactNode;
}) {
  const toText = (sec: number) => formatTimeField(sec, long);
  return (
    <label className='flex flex-col gap-1.5'>
      <span className={label}>{text}</span>
      <span className='flex gap-2'>
        <input
          className={cx(lineControl, 'w-27.5 font-mono text-[13px]')}
          value={value}
          placeholder={toText(0)}
          title='Type like 1:30 or 90 · ↑/↓ moves 1 second, Shift+↑/↓ 0.1 second'
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const t = parseTime(value);
            if (t != null) onChange(toText(t));
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            const step = (e.shiftKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
            let t = Math.max(0, Math.round(((parseTime(value) ?? 0) + step) * 10) / 10);
            if (max != null) t = Math.min(t, max);
            onChange(toText(t));
          }}
        />
        {children}
      </span>
    </label>
  );
}
