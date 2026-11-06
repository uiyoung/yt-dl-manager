import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { CheckIcon, MoreIcon } from '../icons';
import { Button, buttonBase, cx } from '../ui';

export type MenuItem =
  | {
      label: string;
      onClick: () => void;
      disabled?: boolean;
      danger?: boolean;
      hint?: string;
      /** 고를 수 있는 항목: true면 ✓ 표시 */
      checked?: boolean;
    }
  | 'separator';

/** "더 보기" 버튼과 펼침 메뉴 */
export function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

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
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon />
      </Button>
      {open && (
        <MenuPopup
          items={items}
          // 버튼 오른쪽 끝에 맞춘다
          anchor={() => {
            const b = btn.current!.getBoundingClientRect();
            return { x: b.right, top: b.bottom + 4, bottom: b.top - 4, alignRight: true };
          }}
          // 버튼을 다시 누를 때는 버튼의 onClick이 닫는다
          ignore={btn}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** 우클릭 메뉴: 앱에 ContextMenuHost 하나를 두고, 행의 onContextMenu에서 openContextMenu를 부른다 */
const useContextMenu = create<{ menu: { items: MenuItem[]; x: number; y: number; target?: number } | null }>(() => ({
  menu: null,
}));

/** target: 메뉴가 열려 있는 동안 테두리로 표시할 행 (useIsMenuTarget) */
export function openContextMenu(e: React.MouseEvent, items: MenuItem[], target?: number) {
  e.preventDefault();
  useContextMenu.setState({ menu: { items, x: e.clientX, y: e.clientY, target } });
}

/** 이 행에 대한 우클릭 메뉴가 열려 있는지 */
export const useIsMenuTarget = (id: number) => useContextMenu((s) => s.menu?.target === id);

const closeContextMenu = () => useContextMenu.setState({ menu: null });

export function ContextMenuHost() {
  const menu = useContextMenu((s) => s.menu);
  if (!menu) return null;
  return (
    <MenuPopup
      // 다른 곳을 우클릭하면 그 자리에서 새로 연다
      key={`${menu.x},${menu.y}`}
      items={menu.items}
      anchor={() => ({ x: menu.x, top: menu.y, bottom: menu.y, alignRight: false })}
      onClose={closeContextMenu}
    />
  );
}

/**
 * 펼친 메뉴. 목록 스크롤 영역에 잘리지 않도록 body에 띄운다.
 * top 아래로 펼치고, 아래 공간이 모자라면 bottom 위로 펼친다.
 * x는 메뉴의 왼쪽 끝 (alignRight면 오른쪽 끝).
 */
export function MenuPopup({
  items,
  anchor,
  ignore,
  onClose,
}: {
  items: MenuItem[];
  anchor: () => { x: number; top: number; bottom: number; alignRight: boolean };
  ignore?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  // ✓ 표시가 있는 메뉴는 모든 항목에 같은 자리를 비워 글자 줄을 맞춘다
  const checkable = items.some((it) => it !== 'separator' && it.checked != null);

  // 열릴 때 한 번 자리를 잡는다
  useLayoutEffect(() => {
    if (!menu.current) return;
    const a = anchor();
    const m = menu.current.getBoundingClientRect();
    const below = a.top + m.height <= window.innerHeight - 8;
    const left = a.alignRight ? a.x - m.width : a.x;
    setPos({
      top: below ? a.top : Math.max(8, a.bottom - m.height),
      left: Math.max(8, Math.min(left, window.innerWidth - 8 - m.width)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 최신 onClose를 쓰되, 이벤트는 한 번만 건다
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === 'keydown') {
        if ((e as KeyboardEvent).key !== 'Escape') return;
        // Esc는 메뉴만 닫는다 (대기열의 '선택 해제'까지 가지 않게)
        e.stopPropagation();
      }
      if (
        e.type === 'mousedown' &&
        (menu.current?.contains(e.target as Node) || ignore?.current?.contains(e.target as Node))
      )
        return;
      closeRef.current();
    };
    const closeNow = () => closeRef.current();

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', closeNow);
    window.addEventListener('blur', closeNow);
    document.addEventListener('scroll', closeNow, true);

    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', closeNow);
      window.removeEventListener('blur', closeNow);
      document.removeEventListener('scroll', closeNow, true);
    };
  }, [ignore]);

  return createPortal(
    <div
      ref={menu}
      className='fixed z-100 flex min-w-50 flex-col rounded-lg border border-line bg-panel p-1 shadow-[0_8px_24px_rgba(0,0,0,0.18)]'
      role='menu'
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
      // 메뉴 위에서 우클릭해도 기본 메뉴를 띄우지 않는다
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === 'separator' ? (
          <div key={i} className='mx-0.5 my-1 h-px bg-line' />
        ) : (
          <button
            key={i}
            role={it.checked != null ? 'menuitemradio' : 'menuitem'}
            aria-checked={it.checked}
            className={cx(
              buttonBase,
              'justify-start rounded-[5px] px-2.5 py-1.75 text-left enabled:hover:bg-hover',
              it.danger && 'text-error',
            )}
            disabled={it.disabled}
            title={it.hint}
            onClick={() => {
              closeRef.current();
              it.onClick();
            }}
          >
            {checkable && (
              <span className='inline-flex w-4 shrink-0 justify-center'>{it.checked && <CheckIcon />}</span>
            )}
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
