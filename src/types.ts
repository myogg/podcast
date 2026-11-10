export interface Env {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  SOURCE_RSS_URL?: string;
  ALLOWED_SOURCE_HOSTS?: string;
  SITE_TITLE?: string;
  SITE_DESCRIPTION?: string;
  PUBLIC_BASE_URL?: string;
  TTS_VOICE?: string;
  MIMO_API_KEY?: string;
  PODCAST_TEST_TOKEN?: string;
  MIMO_TTS_VOICE?: string;
  TTS_RATE?: string;
  EDGE_CHROMIUM_VERSION?: string;
  MAX_EPISODES_PER_RUN?: string;
  INITIAL_BACKFILL_COUNT?: string;
  MAX_ARTICLE_CHARACTERS?: string;
}

export interface SourceItem {
  slug: string;
  title: string;
  link: string;
  publishedAt: string;
  summary: string;
}

export interface EpisodeRow {
  slug: string;
  title: string;
  source_url: string;
  published_at: string;
  summary: string;
  status: "baseline" | "pending" | "processing" | "published" | "failed";
  audio_key: string | null;
  audio_bytes: number | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
