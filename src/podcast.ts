import { fetchArticleText } from "./article";
import { fetchSourceItems } from "./source-feed";
import { characterLimit, synthesizeArticle } from "./tts";
import type { EpisodeRow, Env, SourceItem } from "./types";

const MAX_FEED_ITEMS = 100;
const MAX_ATTEMPTS = 5;
const CRON_LEASE_MS = 20 * 60 * 1000;

function integerSetting(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

async function acquireCronLease(env: Env): Promise<number | null> {
  const now = Date.now();
  const leaseUntil = now + CRON_LEASE_MS;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO cron_lock (id, lease_until) VALUES (1, 0)",
  ).run();
  const result = await env.DB.prepare(
    "UPDATE cron_lock SET lease_until = ? WHERE id = 1 AND lease_until < ?",
  )
    .bind(leaseUntil, now)
    .run();
  return result.meta.changes === 1 ? leaseUntil : null;
}

async function releaseCronLease(env: Env, leaseUntil: number): Promise<void> {
  try {
    await env.DB.prepare(
      "UPDATE cron_lock SET lease_until = 0 WHERE id = 1 AND lease_until = ?",
    )
      .bind(leaseUntil)
      .run();
  } catch (error) {
    console.error("Could not release cron lease", error);
  }
}

async function insertBaseline(
  env: Env,
  items: SourceItem[],
): Promise<{ backfillCount: number; inserted: number }> {
  const backfillCount = integerSetting(env.INITIAL_BACKFILL_COUNT, 0, 0, 20);
  const now = new Date().toISOString();
  let inserted = 0;

  for (const [index, item] of items.slice(0, MAX_FEED_ITEMS).entries()) {
    const status = index < backfillCount ? "pending" : "baseline";
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO episodes
        (slug, title, source_url, published_at, summary, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(item.slug, item.title, item.link, item.publishedAt, item.summary, status, now, now)
      .run();
    inserted += result.meta.changes || 0;
  }

  await env.DB.prepare(
    "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('bootstrapped_at', ?)",
  )
    .bind(now)
    .run();

  return { backfillCount, inserted };
}

async function queueNewItems(env: Env, items: SourceItem[]): Promise<number> {
  const now = new Date().toISOString();
  let inserted = 0;
  for (const item of items.slice(0, MAX_FEED_ITEMS)) {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO episodes
        (slug, title, source_url, published_at, summary, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
      .bind(item.slug, item.title, item.link, item.publishedAt, item.summary, now, now)
      .run();
    inserted += result.meta.changes || 0;
  }
  return inserted;
}

async function processEpisode(env: Env, episode: EpisodeRow): Promise<void> {
  const now = new Date().toISOString();
  const claim = await env.DB.prepare(
    `UPDATE episodes
        SET status = 'processing', attempts = attempts + 1, updated_at = ?
      WHERE slug = ? AND status = 'pending' AND attempts < ?`,
  )
    .bind(now, episode.slug, MAX_ATTEMPTS)
    .run();
  if (claim.meta.changes !== 1) return;

  const attempt = episode.attempts + 1;
  const audioKey = `episodes/${episode.slug}.mp3`;

  try {
    // Recover an R2 success if a prior run died before updating D1.
    const existingObject = await env.AUDIO_BUCKET.head(audioKey);
    if (existingObject && existingObject.size > 0) {
      await env.DB.prepare(
        `UPDATE episodes
            SET status = 'published', audio_key = ?, audio_bytes = ?, last_error = NULL, updated_at = ?
          WHERE slug = ? AND status = 'processing'`,
      )
        .bind(audioKey, existingObject.size, new Date().toISOString(), episode.slug)
        .run();
      return;
    }

    const body = await fetchArticleText(episode.source_url, env);
    const spokenText = `${episode.title}。${body}`;
    if (spokenText.length > characterLimit(env)) {
      throw new Error(`Article is ${spokenText.length} characters; limit is ${characterLimit(env)}`);
    }

    const audio = synthesizeArticle(spokenText, env);
    const storedObject = await env.AUDIO_BUCKET.put(audioKey, audio, {
      httpMetadata: {
        contentType: "audio/mpeg",
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        sourceUrl: episode.source_url,
        title: episode.title.slice(0, 512),
      },
    });
    if (!storedObject || storedObject.size <= 0) throw new Error("R2 upload produced an empty object");

    await env.DB.prepare(
      `UPDATE episodes
          SET status = 'published', audio_key = ?, audio_bytes = ?, last_error = NULL, updated_at = ?
        WHERE slug = ? AND status = 'processing'`,
    )
      .bind(audioKey, storedObject.size, new Date().toISOString(), episode.slug)
      .run();

    console.info("episode published", episode.slug, storedObject.size);
  } catch (error) {
    const status = attempt >= MAX_ATTEMPTS ? "failed" : "pending";
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      `UPDATE episodes
          SET status = ?, last_error = ?, updated_at = ?
        WHERE slug = ? AND status = 'processing'`,
    )
      .bind(status, message.slice(0, 1_000), new Date().toISOString(), episode.slug)
      .run();
    console.error("episode generation failed", episode.slug, `attempt ${attempt}/${MAX_ATTEMPTS}`, message);
  }
}

export async function pollAndProcess(env: Env): Promise<void> {
  const leaseUntil = await acquireCronLease(env);
  if (leaseUntil === null) {
    console.info("Skipping RSS poll; another Cron invocation holds the lease");
    return;
  }

  try {
    const now = new Date().toISOString();
    const staleBefore = new Date(Date.now() - CRON_LEASE_MS).toISOString();
    await env.DB.prepare(
      `UPDATE episodes
          SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END,
              last_error = CASE WHEN attempts >= ? THEN COALESCE(last_error, 'Lease expired during final attempt') ELSE last_error END,
              updated_at = ?
        WHERE status = 'processing' AND updated_at < ?`,
    )
      .bind(MAX_ATTEMPTS, MAX_ATTEMPTS, now, staleBefore)
      .run();

    const sourceUrl = env.SOURCE_RSS_URL || "https://134688.xyz/rss.xml";
    const items = await fetchSourceItems(env, sourceUrl);
    if (!items.length) {
      console.info("RSS feed contains no valid items", sourceUrl);
      return;
    }

    const bootstrap = await env.DB.prepare(
      "SELECT value FROM app_meta WHERE key = 'bootstrapped_at'",
    ).first<{ value: string }>();

    if (!bootstrap) {
      const result = await insertBaseline(env, items);
      console.info("RSS baseline created", {
        inserted: result.inserted,
        backfillCount: result.backfillCount,
      });
    } else {
      const inserted = await queueNewItems(env, items);
      console.info("new RSS items queued", inserted);
    }

    const maxEpisodes = integerSetting(env.MAX_EPISODES_PER_RUN, 1, 1, 10);
    const pending = await env.DB.prepare(
      `SELECT slug, title, source_url, published_at, summary, status, audio_key,
              audio_bytes, attempts, last_error, created_at, updated_at
         FROM episodes
        WHERE status = 'pending' AND attempts < ?
        ORDER BY published_at ASC
        LIMIT ?`,
    )
      .bind(MAX_ATTEMPTS, maxEpisodes)
      .all<EpisodeRow>();

    for (const episode of pending.results) await processEpisode(env, episode);
  } finally {
    await releaseCronLease(env, leaseUntil);
  }
}
