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

async function listEpisodes(env: Env): Promise<EpisodeRow[]> {
  const result = await env.DB.prepare(
    `SELECT slug, title, source_url, published_at, summary, status, audio_key,
            audio_bytes, attempts, last_error, created_at, updated_at
       FROM episodes
      WHERE status = 'published'
      ORDER BY published_at DESC
      LIMIT 100`,
  ).all<EpisodeRow>();
  return result.results;
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

  if (url.pathname === "/api/health") {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: true, source: env.SOURCE_RSS_URL || "https://134688.xyz/rss.xml" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message }, 503);
    }
  }

  if (url.pathname === "/api/test/generate-one" && request.method === "POST") {
    const expectedToken = env.PODCAST_TEST_TOKEN?.trim();
    if (!expectedToken || expectedToken.length < 24) {
      return json({ ok: false, error: "Manual test endpoint is not configured" }, 503);
    }

    const authorization = request.headers.get("Authorization") || "";
    const suppliedToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    let tokenMatches = suppliedToken.length === expectedToken.length;
    if (tokenMatches) {
      let difference = 0;
      for (let index = 0; index < expectedToken.length; index += 1) {
        difference |= expectedToken.charCodeAt(index) ^ suppliedToken.charCodeAt(index);
      }
      tokenMatches = difference === 0;
    }
    if (!tokenMatches) return json({ ok: false, error: "Unauthorized" }, 401);

    const startedAt = new Date().toISOString();
    await pollAndProcess(env, 1);
    const result = await env.DB.prepare(
      `SELECT slug, title, status, audio_bytes, last_error, updated_at
         FROM episodes
        WHERE attempts > 0 AND updated_at >= ?
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
      .bind(startedAt)
      .first<{
        slug: string;
        title: string;
        status: string;
        audio_bytes: number | null;
        last_error: string | null;
        updated_at: string;
      }>();

    return json({
      ok: true,
      result: result || null,
      message: result
        ? "One episode was processed; inspect status and Worker logs for the TTS provider."
        : "No episode was processed. The RSS may be empty, there may be no pending item, or another Cron invocation may hold the lease.",
    });
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
