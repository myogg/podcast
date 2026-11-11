import type { EpisodeRow, Env } from "./types";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>") }]]>`;
}

// 统一输出 HH:MM:SS，避免 MM:SS 被部分客户端误读成 HH:MM。
function formatItunesDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

// enclosure 的 length 必须是音频文件的真实字节数。
// 优先用上传 R2 时记录的大小；历史数据缺列时回源 head 一次补齐，
// 避免向播客客户端报 0 或沿用拼接前的估算值。
async function resolveAudioSize(env: Env, episode: EpisodeRow): Promise<number> {
  const stored = episode.audio_size ?? episode.audio_bytes;
  if (typeof stored === "number" && stored > 0) return stored;
  if (!episode.audio_key) return 0;
  try {
    const object = await env.AUDIO_BUCKET.head(episode.audio_key);
    return object?.size ?? 0;
  } catch (error) {
    console.error("Could not read audio size from R2", episode.slug, error);
    return 0;
  }
}

// 0003 之前入库的老集没有 duration_seconds；按 128 kbps ≈ 16 KB/s 用真实
// 字节数（含上面的 R2 head 兜底）估算，保证每个 item 都带时长标签、不留空。
const ESTIMATED_BYTES_PER_SECOND = 16000;

function resolveDurationSeconds(episode: EpisodeRow, audioSize: number): number {
  const stored = episode.duration_seconds;
  if (typeof stored === "number" && stored > 0) return stored;
  if (audioSize > 0) {
    return Math.max(1, Math.round(audioSize / ESTIMATED_BYTES_PER_SECOND));
  }
  return 1;
}

export async function buildPodcastFeed(
  env: Env,
  origin: string,
): Promise<string> {
  const result = await env.DB.prepare(
    `SELECT slug, title, source_url, published_at, summary, status, audio_key,
            audio_bytes, audio_size, duration_seconds, tts_provider,
            attempts, last_error, created_at, updated_at
       FROM episodes
      WHERE status = 'published'
      ORDER BY published_at DESC
      LIMIT 100`,
  ).all<EpisodeRow>();

  const siteBase = (env.PUBLIC_BASE_URL || origin).replace(/\/+$/, "");
  const title = env.SITE_TITLE || "姜一一的播客";
  const description = env.SITE_DESCRIPTION || "把 134688.xyz 的新文章，自动变成可收听的播客。";
  const updatedAt = result.results[0]?.updated_at || new Date().toISOString();

  const sized = await Promise.all(
    result.results.map(async (episode) => ({
      episode,
      audioSize: await resolveAudioSize(env, episode),
    })),
  );

  const items = sized
    .map(({ episode, audioSize }) => {
      const audioUrl = `${siteBase}/audio/${encodeURIComponent(episode.slug)}`;
      const episodeUrl = `${siteBase}/episode/${encodeURIComponent(episode.slug)}`;
      const publishedDate = new Date(episode.published_at).toUTCString();
      const itemSummary = episode.summary || `原文朗读：${episode.title}`;
      const durationTag = `\n      <itunes:duration>${formatItunesDuration(
        resolveDurationSeconds(episode, audioSize),
      )}</itunes:duration>`;
      return `
    <item>
      <title>${escapeXml(episode.title)}</title>
      <link>${escapeXml(episodeUrl)}</link>
      <guid isPermaLink="false">${escapeXml(episode.slug)}</guid>
      <pubDate>${publishedDate}</pubDate>
      <description>${cdata(`${itemSummary}\n原文：${episode.source_url}`)}</description>
      <enclosure url="${escapeXml(audioUrl)}" length="${audioSize}" type="audio/mpeg" />${durationTag}
      <itunes:summary>${cdata(itemSummary)}</itunes:summary>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:explicit>false</itunes:explicit>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(siteBase)}</link>
    <description>${escapeXml(description)}</description>
    <language>zh-cn</language>
    <lastBuildDate>${new Date(updatedAt).toUTCString()}</lastBuildDate>
    <image>
      <url>${escapeXml(`${siteBase}/cover.svg`)}</url>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(siteBase)}</link>
    </image>
    <itunes:author>姜一一</itunes:author>
    <itunes:owner><itunes:name>姜一一</itunes:name></itunes:owner>
    <itunes:image href="${escapeXml(`${siteBase}/cover.svg`)}" />
    <itunes:category text="Technology" />
    <itunes:explicit>false</itunes:explicit>
    ${items}
  </channel>
</rss>`;
}
