import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreIcon } from "./icons";

export type MenuItem =
  | { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; hint?: string }
  | "separator";

/** "⋯" 버튼과 펼침 메뉴. 목록 스크롤 영역에 잘리지 않도록 body에 띄운다. */
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
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "mousedown" && (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)))
        return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", onScroll);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        className={`ghost icon-btn${open ? " active" : ""}`}
        title="더 보기"
        aria-label="더 보기"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setPos(null);
          setOpen((o) => !o);
        }}
      >
        <MoreIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="menu"
            role="menu"
            style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}
          >
            {items.map((it, i) =>
              it === "separator" ? (
                <div key={i} className="menu-sep" />
              ) : (
                <button
                  key={i}
                  role="menuitem"
                  className={it.danger ? "danger" : ""}
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
