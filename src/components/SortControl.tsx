import { useRef, useState } from "react";
import { SORT_LABELS, type Sort, type SortKey } from "../sort";
import { ChevronDownIcon, SortDirIcon } from "../icons";
import { Button } from "../ui";
import { MenuPopup, type MenuItem } from "./RowMenu";

/** 기준마다 알아보기 쉬운 방향 이름. 기준을 바꾸면 첫 번째 방향으로 시작한다 */
const DIRECTIONS: Record<SortKey, { label: string; desc: boolean }[]> = {
  date: [
    { label: "Newest first", desc: true },
    { label: "Oldest first", desc: false },
  ],
  channel: [
    { label: "A → Z", desc: false },
    { label: "Z → A", desc: true },
  ],
  duration: [
    { label: "Longest first", desc: true },
    { label: "Shortest first", desc: false },
  ],
  size: [
    { label: "Largest first", desc: true },
    { label: "Smallest first", desc: false },
  ],
};

/** 정렬 버튼: 지금 기준과 방향을 보여 주고, 누르면 기준·방향을 고르는 메뉴를 연다 */
export function SortControl({ sort, onChange, dateLabel }: { sort: Sort; onChange: (s: Sort) => void; dateLabel: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  const keyLabel = (k: SortKey) => (k === "date" ? dateLabel : SORT_LABELS[k]);
  const dirs = DIRECTIONS[sort.key];
  const dirLabel = dirs.find((d) => d.desc === sort.desc)!.label;

  const items: MenuItem[] = [
    ...(Object.keys(SORT_LABELS) as SortKey[]).map((k) => ({
      label: keyLabel(k),
      checked: sort.key === k,
      onClick: () => k !== sort.key && onChange({ key: k, desc: DIRECTIONS[k][0].desc }),
    })),
    "separator",
    ...dirs.map((d) => ({ label: d.label, checked: sort.desc === d.desc, onClick: () => onChange({ ...sort, desc: d.desc }) })),
  ];

  return (
    <>
      <Button
        ref={btn}
        active={open}
        title={`Sorted by ${keyLabel(sort.key).toLowerCase()} (${dirLabel})`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SortDirIcon desc={sort.desc} />
        {keyLabel(sort.key)}
        <span className="text-dim">
          <ChevronDownIcon />
        </span>
      </Button>
      {open && (
        <MenuPopup
          items={items}
          anchor={() => {
            const b = btn.current!.getBoundingClientRect();
            return { x: b.right, top: b.bottom + 4, bottom: b.top - 4, alignRight: true };
          }}
          ignore={btn}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
