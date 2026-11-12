-- 老的 hash(URL) 节目 ID 迁移到 post.slug 后，把旧 ID 保存在这里，
-- 让 /audio/<旧hash> 与 /api/episodes/<旧hash> 仍能命中原来的单集，不断订阅。
-- 数据回填由 Worker 在首次 Cron / 手动触发时幂等完成（src/podcast.ts 的
-- migrateLegacySlugs）：它能正确处理百分号编码的中文 slug，SQLite 做不到。
ALTER TABLE episodes ADD COLUMN legacy_slug TEXT;
