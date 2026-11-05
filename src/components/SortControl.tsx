import { SORT_LABELS, type Sort, type SortKey } from "../sort";
import { SortDirIcon } from "./icons";

export function SortControl({ sort, onChange, dateLabel }: { sort: Sort; onChange: (s: Sort) => void; dateLabel: string }) {
  return (
    <div className="sort-control">
      <select
        value={sort.key}
        title="정렬 기준"
        onChange={(e) => onChange({ ...sort, key: e.target.value as SortKey })}
      >
        {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
          <option key={k} value={k}>
            {k === "date" ? dateLabel : `${SORT_LABELS[k]}순`}
          </option>
        ))}
      </select>
      <button
        className="icon-btn"
        title={sort.desc ? "내림차순 (누르면 오름차순)" : "오름차순 (누르면 내림차순)"}
        aria-label={sort.desc ? "내림차순" : "오름차순"}
        onClick={() => onChange({ ...sort, desc: !sort.desc })}
      >
        <SortDirIcon desc={sort.desc} />
      </button>
    </div>
  );
}
