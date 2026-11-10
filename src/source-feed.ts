import { XMLParser } from "fast-xml-parser";
import { fetchSourceResponse, validateSourceUrl } from "./source-url";
import type { Env, SourceItem } from "./types";

const MAX_FEED_BYTES = 1_500_000;
const MAX_FEED_ITEMS = 400;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
});

function asText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return asText(record["#text"] ?? record["#cdata"] ?? "");
  }
  return "";
}

function stripMarkup(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`RSS response exceeds ${maxBytes} bytes`);
  }

  const reader = response.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`RSS response exceeds ${maxBytes} bytes`);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function slugFromLink(url: URL): Promise<string> {
  const lastPart = url.pathname.split("/").filter(Boolean).at(-1) || "episode";
  const readable = decodeURIComponent(lastPart)
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.toString())),
  );
  return `${readable || "episode"}-${hex(digest.slice(0, 8))}`;
}

export async function fetchSourceItems(env: Env, feedUrl: string): Promise<SourceItem[]> {
  const safeFeedUrl = validateSourceUrl(feedUrl, env);
  const response = await fetchSourceResponse(safeFeedUrl, env, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      "User-Agent": "134688-Blogcast/1.0 (+https://134688.xyz)",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RSS request failed with HTTP ${response.status}`);

  const xml = await readLimitedText(response, MAX_FEED_BYTES);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("RSS with DOCTYPE or ENTITY declarations is not accepted");
  }

  const document = parser.parse(xml) as {
    rss?: { channel?: { item?: unknown | unknown[] } };
  };
  const rawItems = document.rss?.channel?.item;
  const items = rawItems == null ? [] : Array.isArray(rawItems) ? rawItems : [rawItems];
  const result: SourceItem[] = [];

  for (const raw of items.slice(0, MAX_FEED_ITEMS)) {
    try {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const rawLink = asText(item.link).trim();
      const title = stripMarkup(asText(item.title)).slice(0, 400);
      if (!rawLink || !title) continue;

      const link = validateSourceUrl(new URL(rawLink, safeFeedUrl).toString(), env);
      const publishedDate = new Date(asText(item.pubDate));
      const publishedAt = Number.isNaN(publishedDate.getTime())
        ? new Date().toISOString()
        : publishedDate.toISOString();

      result.push({
        slug: await slugFromLink(new URL(link)),
        title,
        link,
        publishedAt,
        summary: stripMarkup(asText(item.description)).slice(0, 2_000),
      });
    } catch (error) {
      console.warn("Skipping invalid RSS item", error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}
