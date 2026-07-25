export interface VideoInfo {
  title: string;
  fileName: string;
  fileSize: string;
  fileSizeBytes: number;
  thumbnail: string;
  sources: VideoSource[];
  originalUrl: string;
  downloadUrl: string | null;
  iframeUrls?: string[];
}

export interface VideoSource {
  url: string;
  quality: string;
  format: string;
  isM3u8: boolean;
  /** Page URL that produced this temporary media URL. Used for hotlink protection. */
  referer?: string;
}

export interface FetchResult {
  success: boolean;
  data?: VideoInfo;
  error?: string;
}
