import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { headAudio, sortEpisodes } from "../lib/episodes";

export const GET: APIRoute = async (context) => {
  const episodes = sortEpisodes(await getCollection("post"));
  const checked = await Promise.all(episodes.map(async (episode) => ({ episode, audio: await headAudio(episode.audioUrl) })));
  const publishable = checked.filter((item): item is { episode: (typeof checked)[number]["episode"]; audio: NonNullable<(typeof checked)[number]["audio"]> } => item.audio !== null);

  for (const { episode, audio } of checked) {
    if (!audio) console.warn(`[podcast] skip ${episode.slug}: Content-Length unavailable for ${episode.audioUrl}`);
  }

  const response = await rss({
    title: "134688 播客",
    description: "把值得读的文章，变成适合慢慢听的中文声音档案。",
    site: context.site || import.meta.env.PUBLIC_SITE_URL || "https://podcast.134688.xyz",
    customData: "<language>zh-CN</language><itunes:author>134688</itunes:author><itunes:category text=\"Arts\"/><itunes:explicit>no</itunes:explicit>",
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
