import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreIcon } from '../icons';
import { Button, buttonBase, cx } from '../ui';

export type MenuItem =
  | { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; hint?: string }
  | 'separator';

/** "더 보기" 버튼과 펼침 메뉴. 목록 스크롤 영역에 잘리지 않도록 body에 띄운다. */
export function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // 버튼 오른쪽에 맞추고, 아래 공간이 모자라면 위로 펼친다
  useLayoutEffect(() => {
    if (!open || !btn.current || !menu.current) return;
    const b = btn.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const below = b.bottom + 4 + m.height <= window.innerHeight - 8;
    setPos({
      top: below ? b.bottom + 4 : Math.max(8, b.top - 4 - m.height),
      left: Math.max(8, b.right - m.width),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const close = (e: Event) => {
      if (e.type === 'keydown') {
        if ((e as KeyboardEvent).key !== 'Escape') return;
        // Esc는 메뉴만 닫는다 (대기열의 '선택 해제'까지 가지 않게)
        e.stopPropagation();
      }
      if (
        e.type === 'mousedown' &&
        (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))
      )
        return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', onScroll);
    document.addEventListener('scroll', onScroll, true);

    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={btn}
        variant='ghost'
        icon
        active={open}
        title='More'
        aria-label='More'
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={() => {
          setPos(null);
          setOpen((o) => !o);
        }}
      >
        <MoreIcon />
      </Button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className='fixed z-100 flex min-w-[200px] flex-col rounded-lg border border-line bg-panel p-1 shadow-[0_8px_24px_rgba(0,0,0,0.18)]'
            role='menu'
            style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
          >
            {items.map((it, i) =>
              it === 'separator' ? (
                <div key={i} className='mx-0.5 my-1 h-px bg-line' />
              ) : (
                <button
                  key={i}
                  role='menuitem'
                  className={cx(
                    buttonBase,
                    'justify-start rounded-[5px] px-2.5 py-[7px] text-left enabled:hover:bg-hover',
                    it.danger && 'text-error',
                  )}
                  disabled={it.disabled}
                  title={it.hint}
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                >
                  {it.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
