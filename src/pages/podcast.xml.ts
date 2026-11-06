import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { episodesWithAudio, sortEpisodes } from "../lib/episodes";

export const GET: APIRoute = async (context) => {
  const episodes = sortEpisodes(await getCollection("post"));
  const publishable = await episodesWithAudio(episodes);

  const publishableSlugs = new Set(publishable.map(({ episode }) => episode.slug));
  for (const episode of episodes) {
    if (!publishableSlugs.has(episode.slug)) {
      console.warn(`[podcast] skip ${episode.slug}: Content-Length unavailable for ${episode.audioUrl}`);
    }
  }

  const response = await rss({
    title: "姜小小的播客",
    description: "姜小小的播客，记录值得反复聆听的中文声音。",
    site: context.site || import.meta.env.PUBLIC_SITE_URL || "https://r.134688.xyz",
    customData: "<language>zh-CN</language><image><url>https://r.134688.xyz/jiang-podcast-cover.png</url><title>姜小小的播客</title><link>https://r.134688.xyz/</link></image><itunes:image href=\"https://r.134688.xyz/jiang-podcast-cover.png\"/><itunes:author>姜小小</itunes:author><itunes:owner><itunes:name>姜小小</itunes:name><itunes:email>xxjss@163.com</itunes:email></itunes:owner><itunes:type>episodic</itunes:type><itunes:category text=\"Arts\"/><itunes:explicit>false</itunes:explicit>",
    items: publishable.map(({ episode, audio }) => ({
      title: episode.title,
      description: episode.description,
      link: `/podcast/${episode.slug}`,
      pubDate: episode.date,
      guid: `podcast-${episode.slug}`,
      enclosure: {
        url: episode.audioUrl,
        length: audio.size,
        type: audio.contentType || "audio/mpeg",
      },
      customData: `<itunes:duration></itunes:duration><itunes:image href="${episode.image}"/>`,
    })),
  });
  const xml = await response.text();
  const validXml = xml.replace(
    '<rss version="2.0">',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">',
  );
  return new Response(validXml, { headers: response.headers });
};
