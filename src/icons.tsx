// 앱에서 쓰는 아이콘 (Lucide). 크기·굵기를 한곳에서 맞춘다.
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
  CircleCheck,
  Download,
  EllipsisVertical,
  ListVideo,
  Play,
  RotateCw,
  Scissors,
  Search,
  Settings,
  Square,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';

function icon(Icon: LucideIcon) {
  return function AppIcon() {
    return <Icon className='shrink-0' size={16} strokeWidth={2} aria-hidden />;
  };
}

export const TrashIcon = icon(Trash2);
export const CheckIcon = icon(Check);
export const ChevronDownIcon = icon(ChevronDown);
export const SearchIcon = icon(Search);
export const MoreIcon = icon(EllipsisVertical);
export const PlayIcon = icon(Play);
export const DownloadIcon = icon(Download);
export const RetryIcon = icon(RotateCw);
export const StopIcon = icon(Square);
export const CloseIcon = icon(X);
export const QueueIcon = icon(ListVideo);
export const DoneIcon = icon(CircleCheck);
export const SettingsIcon = icon(Settings);
export const CutIcon = icon(Scissors);

export function SortDirIcon({ desc }: { desc: boolean }) {
  const Icon = desc ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  return <Icon className='shrink-0' size={16} strokeWidth={2} aria-hidden />;
}
