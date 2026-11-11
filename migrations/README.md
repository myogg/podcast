数据库结构由按序号排列的 SQL 文件维护：

- `0001_init.sql`：播客单集、处理状态和项目元数据。
- `0002_cron_lock.sql`：Cron 单任务租约，避免重叠调度重复合成。
- `0003_episode_meta.sql`：单集音频元信息 `tts_provider`、`audio_size`、`duration_seconds`，供 `/feed.xml` 的 enclosure length 与 `itunes:duration` 使用。

升级已有数据库时务必先应用迁移；`0003` 未执行前，`/feed.xml` 的查询会因缺少新列而报错。

首次部署或本地开发时运行：

```bash
npx wrangler d1 migrations apply blogcast-db --local
npx wrangler d1 migrations apply blogcast-db --remote
```

Wrangler 会按顺序只应用尚未执行的迁移。