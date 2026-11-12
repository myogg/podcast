import { XMLParser } from "fast-xml-parser";
import { extractPostSlug } from "./article";
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
      // 节目 ID 就是博客的 post.slug。解析不出来就整篇跳过，
      // 绝不退回 hash(URL)，避免库里混进两种 ID。
      const slug = extractPostSlug(link);
      if (!slug) {
        console.warn("Skipping RSS item without a valid /post/ slug", link);
        continue;
      }
      const publishedDate = new Date(asText(item.pubDate));
      const publishedAt = Number.isNaN(publishedDate.getTime())
        ? new Date().toISOString()
        : publishedDate.toISOString();

      // description 只取 RSS 里的值；RSS 没给摘要时用标题兜底，不去文章页截取。
      const rssDescription = stripMarkup(asText(item.description)).slice(0, 2_000);
      result.push({
        slug,
        title,
        link,
        publishedAt,
        description: rssDescription || title,
      });
    } catch (error) {
      console.warn("Skipping invalid RSS item", error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}
