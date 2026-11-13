import { extractPostSlug, fetchArticleContent } from "./article";
import { fetchSourceItems } from "./source-feed";
import { characterLimit, measureMp3DurationSeconds, synthesizeArticle } from "./tts";
import type { EpisodeRow, Env, SourceItem } from "./types";

const MAX_FEED_ITEMS = 400;
const MAX_ATTEMPTS = 5;
const CRON_LEASE_MS = 20 * 60 * 1000;
const MIN_ARTICLE_CHARACTERS = 100;
// 快速回填模式：相邻两集之间留 2 秒，避免连续请求 TTS 被限流。
const EPISODE_DELAY_MS = 2_000;
const URL_PATTERNS = [
  /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"'`，。！？；：、（）【】《》「」『』\u3400-\u9fff\u3000-\u303f\uff00-\uffef]+/giu,
  /(?<![@a-z0-9_-])\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|cn|net|org|edu|gov|mil|int|io|ai|app|dev|xyz|uk|us|ca|au|jp|de|fr|info|biz|me|tv|tech|site|online|store|cloud|blog|co)(?::\d{1,5})?(?:[/?#][^\s<>"'`，。！？；：、（）【】《》「」『』\u3400-\u9fff\u3000-\u303f\uff00-\uffef]+)?/giu,
];

function removeUrlsForSpeech(text: string): string {
  let result = text;
  for (const pattern of URL_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const trailing = match.match(/[.,!?;:，。！？；：、)）\]}】》」』]+$/u)?.[0] || "";
      return ` ${trailing}`;
    });
  }
  return result
    .replace(/[\t \u00a0]{2,}/g, " ")
    .replace(/[\t \u00a0]+([，。！？；：、])/g, "$1")
    .trim();
}

async function collectAudioBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new Error("TTS returned an empty audio file");
  }

  const audio = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio;
}

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
  const backfillCount = integerSetting(env.INITIAL_BACKFILL_COUNT, 0, 0, 400);
  const now = new Date().toISOString();
  let inserted = 0;

  for (const [index, item] of items.slice(0, MAX_FEED_ITEMS).entries()) {
    const status = index < backfillCount ? "pending" : "baseline";
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO episodes
        (slug, title, source_url, published_at, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(item.slug, item.title, item.link, item.publishedAt, item.description, status, now, now)
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
        (slug, title, source_url, published_at, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
      .bind(item.slug, item.title, item.link, item.publishedAt, item.description, now, now)
      .run();
    inserted += result.meta.changes || 0;
  }
  return inserted;
}

// 快速回填模式：首次 bootstrap 会把超过 INITIAL_BACKFILL_COUNT 的历史文章登记为
// baseline 且永不处理；把 INITIAL_BACKFILL_COUNT 调大后，需要把这些「从未尝试过」
// 的文章重新排入队列。只挑 attempts=0 且无音频的行：短文被判 baseline 时 attempts
// 已 +1，不会被误捞；published / failed / processing 也不满足条件。幂等，可每轮运行。
async function requeueDeferredBaseline(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE episodes
        SET status = 'pending', last_error = NULL, updated_at = ?
      WHERE status = 'baseline'
        AND attempts = 0
        AND audio_key IS NULL`,
  )
    .bind(new Date().toISOString())
    .run();
  return result.meta.changes || 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

// 0004 老数据迁移：老行的 slug 是 hash(URL)。把旧 ID 原样存到 legacy_slug，
// slug 换成 /post/<slug> 里的 post.slug。用 JS 解析，百分号编码的中文 slug 也能处理。
// 幂等：只处理 legacy_slug IS NULL 的行；迁移后旧的 /audio/<hash> 由 legacy_slug 兜底。
async function migrateLegacySlugs(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT slug, source_url FROM episodes WHERE legacy_slug IS NULL LIMIT 500",
  ).all<{ slug: string; source_url: string }>();
  const now = new Date().toISOString();

  for (const row of rows.results) {
    const newSlug = extractPostSlug(row.source_url);
    // 已经是新 ID，或链接无法解析：标记已处理，避免每轮重复扫描。
    if (!newSlug || newSlug === row.slug) {
      await env.DB.prepare(
        "UPDATE episodes SET legacy_slug = '' WHERE slug = ? AND legacy_slug IS NULL",
      )
        .bind(row.slug)
        .run();
      continue;
    }

    const result = await env.DB.prepare(
      `UPDATE episodes
          SET legacy_slug = ?, slug = ?, updated_at = ?
        WHERE slug = ? AND legacy_slug IS NULL
          AND NOT EXISTS (SELECT 1 FROM episodes WHERE slug = ?)`,
    )
      .bind(row.slug, newSlug, now, row.slug, newSlug)
      .run();

    if (result.meta.changes !== 1) {
      // 新 ID 的行已存在：老行只保留别名，供 /audio/<旧hash> 继续访问。
      await env.DB.prepare(
        `UPDATE episodes SET legacy_slug = ?, updated_at = ?
          WHERE slug = ? AND legacy_slug IS NULL`,
      )
        .bind(row.slug, now, row.slug)
        .run();
    }
  }
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
    const article = await fetchArticleContent(episode.source_url, env);
    const body = article.text;
    const bodyCharacters = Array.from(body.replace(/\s/g, "")).length;
    if (bodyCharacters < MIN_ARTICLE_CHARACTERS) {
      await env.AUDIO_BUCKET.delete(audioKey);
      await env.DB.prepare(
        `UPDATE episodes
            SET status = 'baseline', last_error = NULL, updated_at = ?
          WHERE slug = ? AND status = 'processing'`,
      )
        .bind(new Date().toISOString(), episode.slug)
        .run();
      console.info("episode skipped: article body is shorter than minimum", episode.slug, bodyCharacters);
      return;
    }

    // Recover an R2 success if a prior run died before updating D1.
    const existingObject = await env.AUDIO_BUCKET.head(audioKey);
    if (existingObject && existingObject.size > 0) {
      await env.DB.prepare(
        `UPDATE episodes
            SET status = 'published', audio_key = ?, audio_bytes = ?, audio_size = ?,
                last_error = NULL, updated_at = ?
          WHERE slug = ? AND status = 'processing'`,
      )
        .bind(audioKey, existingObject.size, existingObject.size, new Date().toISOString(), episode.slug)
        .run();
      return;
    }

    const spokenText = removeUrlsForSpeech(`${episode.title}。${body}`);
    if (spokenText.length > characterLimit(env)) {
      throw new Error(`Article is ${spokenText.length} characters; limit is ${characterLimit(env)}`);
    }

    const synthesized = await synthesizeArticle(spokenText, env);
    const audio = await collectAudioBytes(synthesized.audio);
    // 拼接后的 MP3 头部只描述第一段的时长，这里按帧重算真实总时长。
    const durationSeconds = measureMp3DurationSeconds(audio) || null;
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
          SET status = 'published', audio_key = ?, audio_bytes = ?, audio_size = ?,
              tts_provider = ?, duration_seconds = ?, last_error = NULL, updated_at = ?
        WHERE slug = ? AND status = 'processing'`,
    )
      .bind(
        audioKey,
        storedObject.size,
        storedObject.size,
        synthesized.provider,
        durationSeconds,
        new Date().toISOString(),
        episode.slug,
      )
      .run();

    console.info("episode published", episode.slug, {
      size: storedObject.size,
      durationSeconds,
      provider: synthesized.provider,
    });
  } catch (error) {
    // 快速回填模式：单篇合成失败立即记为 failed 并继续下一篇，不重试、不卡住整轮。
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      `UPDATE episodes
          SET status = 'failed', last_error = ?, updated_at = ?
        WHERE slug = ? AND status = 'processing'`,
    )
      .bind(message.slice(0, 1_000), new Date().toISOString(), episode.slug)
      .run();
    console.error("episode generation failed; marked as failed and continuing", episode.slug, `attempt ${attempt}`, message);
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

    // 先迁移老 ID，再登记新文章，避免 source_url 的 UNIQUE 约束挡住新 slug。
    try {
      await migrateLegacySlugs(env);
    } catch (error) {
      console.error("legacy slug migration failed", error);
    }

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

    // 快速回填：把首次 bootstrap 时因超出旧 INITIAL_BACKFILL_COUNT 而搁置的
    // baseline 历史文章补进队列（幂等），确保本轮就能开始处理它们。
    const requeued = await requeueDeferredBaseline(env);
    if (requeued > 0) console.info("deferred baseline episodes requeued", requeued);

    const maxEpisodes = integerSetting(env.MAX_EPISODES_PER_RUN, 1, 1, 10);
    const pending = await env.DB.prepare(
      `SELECT slug, title, source_url, published_at, description, legacy_slug,
              status, audio_key, audio_bytes, attempts, last_error, created_at, updated_at
         FROM episodes
        WHERE status = 'pending' AND attempts < ?
        ORDER BY published_at ASC
        LIMIT ?`,
    )
      .bind(MAX_ATTEMPTS, maxEpisodes)
      .all<EpisodeRow>();

    for (let index = 0; index < pending.results.length; index++) {
      const episode = pending.results[index];
      try {
        await processEpisode(env, episode);
      } catch (error) {
        // 双保险：单篇若连状态回写都失败，也不让它中断整轮。
        console.error("unexpected error while processing episode; continuing", episode.slug, error);
        try {
          await env.DB.prepare(
            `UPDATE episodes
                SET status = 'failed', last_error = ?, updated_at = ?
              WHERE slug = ? AND status = 'processing'`,
          )
            .bind(String(error).slice(0, 1_000), new Date().toISOString(), episode.slug)
            .run();
        } catch (markError) {
          console.error("could not mark episode as failed", episode.slug, markError);
        }
      }
      // 相邻两集之间留 2 秒，避免连续请求 TTS 被限流；最后一篇之后无需等待。
      if (index < pending.results.length - 1) {
        await delay(EPISODE_DELAY_MS);
      }
    }
  } finally {
    await releaseCronLease(env, leaseUntil);
  }
}
