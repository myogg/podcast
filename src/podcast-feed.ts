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

export async function buildPodcastFeed(
  env: Env,
  origin: string,
): Promise<string> {
  const result = await env.DB.prepare(
    `SELECT slug, title, source_url, published_at, summary, status, audio_key,
            audio_bytes, attempts, last_error, created_at, updated_at
       FROM episodes
      WHERE status = 'published'
      ORDER BY published_at DESC
      LIMIT 100`,
  ).all<EpisodeRow>();

  const siteBase = (env.PUBLIC_BASE_URL || origin).replace(/\/+$/, "");
  const title = env.SITE_TITLE || "姜一一的博客播客";
  const description = env.SITE_DESCRIPTION || "把 134688.xyz 的新文章，自动变成可收听的播客。";
  const updatedAt = result.results[0]?.updated_at || new Date().toISOString();

  const items = result.results
    .map((episode) => {
      const audioUrl = `${siteBase}/audio/${encodeURIComponent(episode.slug)}`;
      const publishedDate = new Date(episode.published_at).toUTCString();
      const itemSummary = episode.summary || `原文朗读：${episode.title}`;
      return `
    <item>
      <title>${escapeXml(episode.title)}</title>
      <link>${escapeXml(episode.source_url)}</link>
      <guid isPermaLink="false">${escapeXml(episode.slug)}</guid>
      <pubDate>${publishedDate}</pubDate>
      <description>${cdata(itemSummary)}</description>
      <enclosure url="${escapeXml(audioUrl)}" length="${episode.audio_bytes || 0}" type="audio/mpeg" />
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
