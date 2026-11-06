import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { episodesWithAudio, sortEpisodes } from "../lib/episodes";

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.toString().replace(/\/$/, "") || "https://r.134688.xyz";
  const episodes = sortEpisodes(await getCollection("post"));
  const publishable = await episodesWithAudio(episodes);
  const pageSize = 40;
  const totalPages = Math.ceil(publishable.length / pageSize);
  const archivePages = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => `${origin}/episodes/page/${index + 2}`);
  const urls = [
    `${origin}/`,
    `${origin}/podcast.xml`,
    ...archivePages,
    ...episodes.map((episode) => `${origin}/podcast/${episode.slug}`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
