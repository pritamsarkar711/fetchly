export interface VideoInfo {
  title: string;
  fileName: string;
  fileSize: string;
  fileSizeBytes: number;
  thumbnail: string;
  sources: VideoSource[];
  originalUrl: string;
  downloadUrl: string | null;
}

export interface VideoSource {
  url: string;
  quality: string;
  format: string;
  isM3u8: boolean;
}

export interface FetchResult {
  success: boolean;
  data?: VideoInfo;
  error?: string;
}

export interface ParsedUrl {
  site: string;
  fileId: string;
  originalUrl: string;
}
