import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const origin = site?.toString().replace(/\/$/, "") || "https://r.134688.xyz";
  return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap-index.xml\n`, { headers: { "Content-Type": "text/plain" } });
};
