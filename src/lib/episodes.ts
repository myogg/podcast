import type { CollectionEntry } from "astro:content";

export interface Episode {
  slug: string;
  title: string;
  description: string;
  date: Date;
  image: string;
  audioUrl: string;
  tags: string[];
  body: string;
}

const blogUrl = (import.meta.env.PUBLIC_BLOG_URL || "https://134688.xyz").replace(/\/$/, "");
const audioBase = (import.meta.env.PUBLIC_AUDIO_BASE_URL || "https://tel.xx.kg").replace(/\/$/, "");
const siteUrl = (import.meta.env.PUBLIC_SITE_URL || "https://r.134688.xyz").replace(/\/$/, "");

function absoluteUrl(value: string, fallback: string): string {
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return value;
  return `${blogUrl}/${value.replace(/^\//, "")}`;
}

function firstImage(body: string): string | undefined {
  const match = body.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/);
  return match?.[1];
}

function firstParagraph(body: string): string {
  const plain = body
    .replace(/^---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 150 ? `${plain.slice(0, 150)}…` : plain;
}

export function toEpisode(entry: CollectionEntry<"post">): Episode {
  const { data, body = "" } = entry;
  const description = data.description || firstParagraph(body) || data.title;
  const sourceImage = data.image || firstImage(body);
  const image = sourceImage ? absoluteUrl(sourceImage, `${blogUrl}/favicon.ico`) : `${siteUrl}/jiang-podcast-cover.png`;
  return {
    slug: entry.slug,
    title: data.title,
    description,
    date: new Date(data.date!),
    image,
    audioUrl: `${audioBase}/audio/${entry.slug}.mp3`,
    tags: data.tags || [],
    body,
  };
}

export function sortEpisodes(entries: CollectionEntry<"post">[]): Episode[] {
  return entries
    .filter((entry) => !entry.data.draft)
    .map(toEpisode)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function headAudio(url: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!response.ok) return null;
    const value = response.headers.get("content-length");
    const size = value ? Number.parseInt(value, 10) : Number.NaN;
    if (!Number.isFinite(size) || size <= 0) return null;
    return { size, contentType: response.headers.get("content-type") || "audio/mpeg" };
  } catch (error) {
    console.warn(`[podcast] HEAD failed for ${url}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export interface PublishableEpisode {
  episode: Episode;
  audio: { size: number; contentType: string };
}

let publishableEpisodesPromise: Promise<PublishableEpisode[]> | undefined;

/**
 * Return only episodes whose public R2 audio URL responds with a real,
 * positive Content-Length. Cache this promise during the static build so the
 * home page, archive pages and RSS feed share one availability check.
 */
export function episodesWithAudio(episodes: Episode[]): Promise<PublishableEpisode[]> {
  if (!publishableEpisodesPromise) {
    publishableEpisodesPromise = (async () => {
      const checked = await Promise.all(
        episodes.map(async (episode) => ({ episode, audio: await headAudio(episode.audioUrl) })),
      );
      return checked.filter(
        (item): item is PublishableEpisode => item.audio !== null,
      );
    })();
  }
  return publishableEpisodesPromise;
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

export function formatBytes(size?: number): string {
  if (!size) return "音频大小待同步";
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
