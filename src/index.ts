import { buildPodcastFeed } from "./podcast-feed";
import { pollAndProcess } from "./podcast";
import type { EpisodeRow, Env } from "./types";

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
  summary: string;
  sourceUrl: string;
  audioUrl: string;
}>> {
  const result = await env.DB.prepare(
    `SELECT slug, title, source_url, published_at, summary
       FROM episodes
      WHERE status = 'published'
      ORDER BY published_at DESC
      LIMIT 100`,
  ).all<Pick<EpisodeRow, "slug" | "title" | "source_url" | "published_at" | "summary">>();

  return result.results.map((episode) => ({
    slug: episode.slug,
    title: episode.title,
    publishedAt: episode.published_at,
    summary: episode.summary,
    sourceUrl: episode.source_url,
    audioUrl: `/audio/${encodeURIComponent(episode.slug)}`,
  }));
}

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

  const episode = await env.DB.prepare(
    "SELECT audio_key FROM episodes WHERE slug = ? AND status = 'published'",
  )
    .bind(decodedSlug)
    .first<{ audio_key: string | null }>();
  if (!episode?.audio_key) return new Response("Not found", { status: 404 });

  const object = await env.AUDIO_BUCKET.get(episode.audio_key, {
    range: request.headers,
  });
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", "audio/mpeg");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", object.httpEtag);

  let status = 200;
  if (object.range) {
    const range = object.range;
    const offset = "suffix" in range
      ? Math.max(0, object.size - range.suffix)
      : range.offset ?? 0;
    const length = "suffix" in range
      ? Math.min(range.suffix, object.size)
      : range.length ?? object.size - offset;
    const end = offset + length - 1;
    headers.set("Content-Range", `bytes ${offset}-${end}/${object.size}`);
    headers.set("Content-Length", String(length));
    status = 206;
  } else {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    status,
    headers,
  });
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
<button id="submit" type="submit">立即处理最多 5 篇</button>
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
        maxEpisodesPerRun: Number(env.MAX_EPISODES_PER_RUN) || 5,
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
