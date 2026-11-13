import { buildPodcastFeed } from "./podcast-feed";
import { pollAndProcess } from "./podcast";
import type { EpisodeRow, Env } from "./types";

// 摘要只取 D1 的 description；老行为空时用标题兜底，绝不抓正文截取。
function resolveDescription(
  episode: Pick<EpisodeRow, "description" | "title">,
): string {
  return episode.description?.trim() || episode.title;
}

// 先按 slug 查，查不到再按 legacy_slug 查（0004 迁移后老 hash 保存在这里）。
async function findPublishedEpisode<T>(
  env: Env,
  slug: string,
  columns: string,
): Promise<T | null> {
  const bySlug = await env.DB.prepare(
    `SELECT ${columns} FROM episodes WHERE slug = ? AND status = 'published'`,
  )
    .bind(slug)
    .first<T>();
  if (bySlug) return bySlug;

  return env.DB.prepare(
    `SELECT ${columns} FROM episodes WHERE legacy_slug = ? AND status = 'published'`,
  )
    .bind(slug)
    .first<T>();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function validBearerToken(request: Request, expected: string): boolean {
  const authorization = request.headers.get("Authorization") || "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;

  const suppliedBytes = new TextEncoder().encode(authorization.slice(prefix.length));
  const expectedBytes = new TextEncoder().encode(expected);
  if (suppliedBytes.length !== expectedBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < suppliedBytes.length; index++) {
    difference |= suppliedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function listEpisodes(env: Env): Promise<Array<{
  slug: string;
  title: string;
  publishedAt: string;
  description: string;
  sourceUrl: string;
  audioUrl: string;
}>> {
  const result = await env.DB.prepare(
    `SELECT slug, title, source_url, published_at, description
       FROM episodes
      WHERE status = 'published'
      ORDER BY published_at DESC
      LIMIT 100`,
  ).all<Pick<EpisodeRow, "slug" | "title" | "source_url" | "published_at" | "description">>();

  return result.results.map((episode) => ({
    slug: episode.slug,
    title: episode.title,
    publishedAt: episode.published_at,
    description: resolveDescription(episode),
    sourceUrl: episode.source_url,
    audioUrl: `/audio/${encodeURIComponent(episode.slug)}`,
  }));
}

// 详情页只读 D1 元数据，不再抓取博客文章页，也不再返回文章全文。
async function loadEpisodeDetail(env: Env, slug: string): Promise<Response> {
  const episode = await findPublishedEpisode<
    Pick<EpisodeRow,
      "slug" | "title" | "description" | "source_url" | "published_at" | "duration_seconds">
  >(env, slug, "slug, title, description, source_url, published_at, duration_seconds");
  if (!episode) return json({ error: "Episode not found" }, 404);

  return json({
    episode: {
      slug: episode.slug,
      title: episode.title,
      publishedAt: episode.published_at,
      description: resolveDescription(episode),
      durationSeconds: episode.duration_seconds,
      sourceUrl: episode.source_url,
      audioUrl: `/audio/${encodeURIComponent(episode.slug)}`,
      notice: "完整文章请到博客阅读，播客这里只显示摘要。",
    },
  });
}

type ByteRange =
  | { offset: number; length?: number }
  | { suffix: number };

// 自己解析 Range 头，不把 request.headers 直接交给 R2 的 range 选项。
// 传 Headers 时 R2 回显的 object.range.offset 会是 NaN，用它拼 Content-Range
// 会得到 "bytes NaN-NaN/<size>"，浏览器 <audio> 直接报 MEDIA_ERR_SRC_NOT_SUPPORTED。
function parseByteRange(value: string | null): ByteRange | "none" | "invalid" {
  if (!value) return "none";
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  // 多段 Range (bytes=0-99,200-299) 或其它语法：忽略，回退完整 200 响应
  if (!match) return "none";
  const [, startText, endText] = match;
  if (!startText && !endText) return "none";

  if (!startText) {
    const suffix = Number(endText);
    return Number.isSafeInteger(suffix) && suffix > 0 ? { suffix } : "invalid";
  }

  const offset = Number(startText);
  if (!Number.isSafeInteger(offset)) return "invalid";
  if (!endText) return { offset };

  const last = Number(endText);
  if (!Number.isSafeInteger(last) || last < offset) return "invalid";
  return { offset, length: last - offset + 1 };
}

// 修改响应头/缓存策略后递增，强制客户端重新校验之前缓存的音频响应。
const AUDIO_RESPONSE_VERSION = "3";

async function serveAudio(request: Request, env: Env, slug: string): Promise<Response> {
  let decodedSlug: string;
  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!decodedSlug || decodedSlug.includes("/") || decodedSlug.includes("\\")) {
    return new Response("Not found", { status: 404 });
  }

  const episode = await findPublishedEpisode<{ audio_key: string | null }>(
    env,
    decodedSlug,
    "audio_key",
  );
  if (!episode?.audio_key) return new Response("Not found", { status: 404 });
  const audioKey = episode.audio_key;

  // 先用 head 拿权威的完整对象大小。ranged get 回显的元数据曾导致
  // "bytes NaN-NaN/<size>" 这类坏 Content-Range，这里不依赖它。
  const head = await env.AUDIO_BUCKET.head(audioKey);
  if (!head) return new Response("Not found", { status: 404 });
  const size = head.size;

  const parsed = parseByteRange(request.headers.get("Range"));
  // 多段 Range 或语法无效时按 RFC 9110 忽略 Range，回退完整 200 响应。
  const range: ByteRange | undefined =
    parsed === "none" || parsed === "invalid" ? undefined : parsed;

  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", "audio/mpeg");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set(
    "ETag",
    `"${head.httpEtag.replace(/^"|"$/g, "")}-v${AUDIO_RESPONSE_VERSION}"`,
  );

  let offset = 0;
  let length = size;
  let status = 200;

  if (range) {
    if ("suffix" in range) {
      length = Math.min(range.suffix, size);
      offset = size - length;
    } else {
      offset = range.offset;
      length = Math.min(range.length ?? size - offset, size - offset);
    }

    if (offset >= size || length <= 0) {
      headers.set("Content-Range", `bytes */${size}`);
      headers.set("Content-Length", "0");
      headers.set("Cache-Control", "no-store");
      return new Response(null, { status: 416, headers });
    }

    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${size}`);
    status = 206;
  }

  headers.set("Content-Length", String(length));

  // HEAD 只需要响应头，不必读取对象体。
  if (request.method === "HEAD") {
    return new Response(null, { status, headers });
  }

  // 用解析后的 R2Range 取字节流，不把 request.headers 直接交给 R2。
  const r2Range = range
    ? ("suffix" in range ? { suffix: range.suffix } : { offset, length })
    : undefined;
  const object = r2Range
    ? await env.AUDIO_BUCKET.get(audioKey, { range: r2Range })
    : await env.AUDIO_BUCKET.get(audioKey);
  if (!object || !("body" in object)) return new Response("Not found", { status: 404 });

  return new Response(object.body, { status, headers });
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/admin/run" && request.method === "GET") {
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>播客手动处理</title>
<style>
body{font:16px system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 18px;color:#222}
input,button{box-sizing:border-box;width:100%;padding:13px;margin:8px 0;border:1px solid #bbb;border-radius:8px;font-size:16px}
button{background:#222;color:#fff;border:0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:12px;border-radius:8px}
small{color:#666}
</style>
</head>
<body>
<h2>播客手动处理</h2>
<p>输入你在 Cloudflare 中设置的 MANUAL_TRIGGER_SECRET。密钥只在本次页面内存中使用，不会写入网址。</p>
<form id="run">
<input id="secret" type="password" autocomplete="off" placeholder="手动触发密钥" required>
<button id="submit" type="submit">立即处理最多 10 篇</button>
</form>
<small>处理期间请不要关闭页面。完成后到 D1 查询 episodes 状态。</small>
<pre id="result">等待操作</pre>
<script>
document.getElementById("run").addEventListener("submit",async(event)=>{
 event.preventDefault();
 const button=document.getElementById("submit");
 const output=document.getElementById("result");
 button.disabled=true;output.textContent="正在处理，请稍候……";
 try{
  const response=await fetch("/api/admin/process",{method:"POST",headers:{Authorization:"Bearer "+document.getElementById("secret").value}});
  const body=await response.text();
  output.textContent="HTTP "+response.status+"\\n"+body;
 }catch(error){output.textContent="请求失败："+String(error);}
 finally{button.disabled=false;}
});
</script>
</body>
</html>`;
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (url.pathname === "/api/admin/process") {
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed; use POST" }, 405);
    }
    if (!env.MANUAL_TRIGGER_SECRET) {
      return json({ ok: false, error: "Manual trigger is not configured" }, 503);
    }
    if (!validBearerToken(request, env.MANUAL_TRIGGER_SECRET)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    try {
      await pollAndProcess(env);
      return json({
        ok: true,
        message: "Processing run finished. Check D1 episodes for results.",
        maxEpisodesPerRun: Number(env.MAX_EPISODES_PER_RUN) || 10,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Manual processing run failed", message);
      return json({ ok: false, error: "Processing run failed", detail: message }, 500);
    }
  }

  if (url.pathname === "/api/health") {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: true, source: env.SOURCE_RSS_URL || "https://134688.xyz/rss.xml" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message }, 503);
    }
  }

  if (url.pathname === "/api/episodes" && request.method === "GET") {
    return json({ episodes: await listEpisodes(env) });
  }

  const detailMatch = url.pathname.match(/^\/api\/episodes\/([^/]+)$/);
  if (detailMatch && request.method === "GET") {
    let slug: string;
    try {
      slug = decodeURIComponent(detailMatch[1]);
    } catch {
      return json({ error: "Episode not found" }, 404);
    }
    if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) return json({ error: "Episode not found" }, 404);
    return loadEpisodeDetail(env, slug);
  }

  if (url.pathname === "/feed.xml" && request.method === "GET") {
    return new Response(await buildPodcastFeed(env, url.origin), {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  if (url.pathname.startsWith("/audio/") && ["GET", "HEAD"].includes(request.method)) {
    const slug = url.pathname.slice("/audio/".length);
    return serveAudio(request, env, slug);
  }

  if (request.method === "GET" && /^\/episode\/[^/]+\/?$/.test(url.pathname)) {
    return env.ASSETS.fetch(new Request(new URL("/", url), request));
  }

  return env.ASSETS.fetch(request);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await pollAndProcess(env);
  },
};
