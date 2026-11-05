/** ready: 추가됨(아직 받지 않음) · queued: 다운로드 요청됨(순서 대기) */
export type Status = "ready" | "queued" | "downloading" | "done" | "error";

export interface Video {
  id: number;
  videoId: string;
  url: string;
  title: string | null;
  channel: string | null;
  duration: number | null;
  thumbnail: string | null;
  metaState: "pending" | "ok" | "failed";
  status: Status;
  quality: string;
  filePath: string | null;
  fileSize: number | null;
  errorMsg: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface Progress {
  id: number;
  stage: "downloading" | "processing";
  percent: number;
  downloaded: number | null;
  total: number | null;
  speed: number | null;
  eta: number | null;
}

export interface Settings {
  outputDir: string;
  defaultQuality: string;
  filenameTemplate: string;
  saveThumbnail: boolean;
  concurrency: number;
}

export interface AddResult {
  added: Video[];
  duplicates: { videoId: string; title: string | null; status: Status }[];
  pasteDuplicates: number;
  unrecognized: string[];
  playlistErrors: string[];
}

export interface ToolStatus {
  ytdlp: string | null;
  ffmpeg: boolean;
}

export const QUALITY_OPTIONS: { value: string; label: string }[] = [
  { value: "best", label: "최고화질" },
  { value: "2160", label: "2160p (4K)" },
  { value: "1440", label: "1440p" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
  { value: "audio", label: "오디오만 (m4a)" },
];

export const FILENAME_PRESETS: { value: string; label: string }[] = [
  { value: "%(title)s [%(id)s].%(ext)s", label: "제목 [ID]" },
  { value: "%(title)s.%(ext)s", label: "제목" },
  { value: "%(upload_date>%Y-%m-%d)s - %(title)s.%(ext)s", label: "업로드일 - 제목" },
  { value: "%(channel)s - %(title)s.%(ext)s", label: "채널 - 제목" },
  { value: "%(channel)s/%(title)s [%(id)s].%(ext)s", label: "채널 폴더 / 제목 [ID]" },
];
