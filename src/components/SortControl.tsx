import { SORT_LABELS, type Sort, type SortKey } from "../sort";
import { SortDirIcon } from "./icons";
import { Button, control, cx } from "../ui";

export function SortControl({ sort, onChange, dateLabel }: { sort: Sort; onChange: (s: Sort) => void; dateLabel: string }) {
  return (
    <div className="flex items-center gap-1">
      <select
        className={cx(control, "h-8")}
        value={sort.key}
        title="Sort by"
        onChange={(e) => onChange({ ...sort, key: e.target.value as SortKey })}
      >
        {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
          <option key={k} value={k}>
            {k === "date" ? dateLabel : SORT_LABELS[k]}
          </option>
        ))}
      </select>
      <Button
        icon
        title={sort.desc ? "Descending (click for ascending)" : "Ascending (click for descending)"}
        aria-label={sort.desc ? "Descending" : "Ascending"}
        onClick={() => onChange({ ...sort, desc: !sort.desc })}
      >
        <SortDirIcon desc={sort.desc} />
      </Button>
    </div>
  );
}
