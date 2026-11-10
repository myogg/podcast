数据库结构由按序号排列的 SQL 文件维护：

- `0001_init.sql`：播客单集、处理状态和项目元数据。
- `0002_cron_lock.sql`：Cron 单任务租约，避免重叠调度重复合成。

首次部署或本地开发时运行：

```bash
npx wrangler d1 migrations apply blogcast-db --local
npx wrangler d1 migrations apply blogcast-db --remote
```

Wrangler 会按顺序只应用尚未执行的迁移。