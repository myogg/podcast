数据库结构由按序号排列的 SQL 文件维护：

- `0001_init.sql`：播客单集、处理状态和项目元数据。
- `0002_cron_lock.sql`：Cron 单任务租约，避免重叠调度重复合成。
- `0003_episode_meta.sql`：单集音频元信息 `tts_provider`、`audio_size`、`duration_seconds`，供 `/feed.xml` 的 enclosure length 与 `itunes:duration` 使用。
- `0004_legacy_slug.sql`：新增 `legacy_slug`，保存老的 hash ID，让旧 `/audio/<hash>` 与详情链接继续可用。
- `0005_episode_description.sql`：新增 `description`，只存 RSS 摘要，供列表页、详情页和 `/feed.xml` 使用。

升级已有数据库时务必先应用迁移；`0003` ~ `0005` 未执行前，`/feed.xml` 与 `/api/episodes` 的查询会因缺少新列而报错。老数据的 ID 回填由 Worker 在首次 Cron / 手动触发时幂等完成（`src/podcast.ts` 的 `migrateLegacySlugs`），不需要手写 `UPDATE`。

首次部署或本地开发时运行：

```bash
npx wrangler d1 migrations apply blogcast-db --local
npx wrangler d1 migrations apply blogcast-db --remote
```

Wrangler 会按顺序只应用尚未执行的迁移。