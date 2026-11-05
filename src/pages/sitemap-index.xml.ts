import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { sortEpisodes } from "../lib/episodes";

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.toString().replace(/\/$/, "") || "https://podcast-3a5.pages.dev";
  const episodes = sortEpisodes(await getCollection("post"));
  const urls = [`${origin}/`, `${origin}/podcast.xml`, ...episodes.map((episode) => `${origin}/podcast/${episode.slug}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
