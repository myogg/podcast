# 姜一一的播客

一个独立的 Cloudflare Worker 项目：每 4 小时检查 `https://134688.xyz/rss.xml`。发现新文章后抓取文章页正文，使用 Edge TTS 逐段朗读原文，合成 MP3 保存到 R2，并在网站与 `/feed.xml` 中发布新的一集。整个流程不调用 AI，也不改写文章。

## 组成

- **Cloudflare Worker**：提供播客网站、JSON API、RSS feed、音频读取路由和定时任务。
- **R2**：私有保存最终 MP3。项目不开放 R2 的匿名写入，也不需要把 R2 Access Key 放进代码。
- **D1**：保存文章去重、生成状态、重试次数和 Cron 租约。
- **Cron Trigger**：`0 */4 * * *`，每 4 小时检查一次。Cloudflare Cron 按 UTC 运行；换算成北京时间是每天 08:00、12:00、16:00、20:00、次日 00:00 和 04:00。首次运行会把 RSS 中最多 400 篇文章排入历史回填队列；默认每轮顺序处理 5 集，后续队列留给下一轮 Cron。
- **TTS**：在 Worker 内直接实现 Edge TTS WebSocket 客户端，默认普通话女声 `zh-CN-XiaoxiaoNeural`。不调用 AI，也不依赖旧版 `@echristian/edge-tts` npm 包或其他转发服务。

R2 桶默认保持私有。网站通过 Worker 的 `/audio/{slug}` 路由读取音频；没有任何公开上传接口。RSS item 的音频 enclosure 使用播客网站自身的 URL。

## Edge TTS 握手与维护

握手流程参考 [`yy4382/read-aloud`](https://github.com/yy4382/read-aloud)（该仓库 `package.json` 声明 ISC；项目内没有调用它的代理 API，也没有依赖其 npm 包）：

1. Worker 生成带五分钟时间窗的 `Sec-MS-GEC` v2 token（SHA-256 + CS64 摘要），并在 URL 中同时传 `TrustedClientToken`、`Sec-MS-GEC-Version=2-<Chromium版本>` 和随机 `ConnectionId`。
2. 同一请求携带与版本主号匹配的 Edge User-Agent，以及随机 `muid` Cookie。
3. Cloudflare Worker 用 `fetch(https://...)` 配合 `Upgrade: websocket` 建立出站 WebSocket。
4. 连接上先发 `speech.config`，再发带 `X-RequestId` 的 SSML；收到 MP3 音频帧并以 `turn.end` 作为该段结束标志。

默认 `EDGE_CHROMIUM_VERSION` 是 `143.0.3650.75`，与参考仓库 2026-10-14 的代码一致。微软端可能升级校验要求；如果 TTS 日志出现 403/握手失败，需要检查并同步更新此版本（请求里的版本和 User-Agent 主版本必须匹配），然后重新部署。Cloudflare 服务器时间必须准确，令牌按 5 分钟时间窗生成。

该 Read Aloud 接口是非官方在线服务，没有可用性或限流 SLA；客户端/仓库的开源许可证不代表微软对服务使用的授权。参见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

每个约 300 字文本片段会单独合成，再将 MP3 音频帧串接成一集；通常可连续播放，但个别播放器可能显示不准确的总时长或拖动位置。当前构建已通过类型检查、Worker 打包与本地站点/Cron 基线测试；受当前环境的出站 WebSocket 限制，尚未从这里完成微软端实时合成验证。首次部署后应先用一篇短文章实测播放与进度条。

## 文章读取方式

Worker 从 Astro RSS 读取标题、链接、发布时间和摘要。当前 RSS 不包含文章全文，因此项目再访问文章页正文，并提取页面的 `#article-content` 正文。若 Astro 主题将来更改这个元素 ID，需要同步调整 `src/article.ts`。

默认只允许 `134688.xyz` 与 `www.134688.xyz` 的 HTTPS URL。RSS 中的文章链接和每一跳重定向都会重新校验；RSS 文件限制为 1.5 MB，文章 HTML 限制为 5 MB。若更换文章源域名，必须同时更新 `SOURCE_RSS_URL` 和 `ALLOWED_SOURCE_HOSTS`。

每篇文章生成一集。正文前会朗读文章标题；正文不会经过 AI 改写。文章链接会被校验并哈希成固定、路由安全的节目 ID，用作稳定去重标识。

## 首次启动行为

首次运行会将当前 RSS 中最多 400 篇文章登记到 D1。`INITIAL_BACKFILL_COUNT` 指定其中排入回填队列的文章数；当前配置为 `400`，因此符合条件的历史文章会开始生成。注意 RSS 源和 Worker 都最多处理 400 条，且 RSS 响应大小仍限制为 1.5 MB；应在首次 Cron 日志中确认实际登记数量。

每次 Cron 最多顺序合成 `MAX_EPISODES_PER_RUN` 篇（当前为 `5`）。约 300 篇按每轮 5 集、每天 6 轮计算，理想情况下约需 10 天；实际时间会受 TTS 响应、Cloudflare 执行限制和失败重试影响。若 Microsoft TTS 开始限流或 Worker 日志出现超时，应把该值调低。

D1 `cron_lock` 租约防止手动触发和 Cron 重叠时重复合成；过期的 `processing` 任务会在下一轮恢复。单集最多尝试 5 次；第五次失败后状态变为 `failed`，不再自动重试。排查后可在 D1 Console 或 Wrangler 执行以下 SQL 手动重置：

```sql
UPDATE episodes
SET status = 'pending', attempts = 0, last_error = NULL, updated_at = datetime('now')
WHERE slug = '<episode-slug>' AND status = 'failed';
```

## 部署到 Cloudflare

本项目假设 Worker 与目标 R2 桶在同一个 Cloudflare 账号。不会替你创建账号、资源或执行部署。部署前准备 Node.js 20+、npm 和 Cloudflare 账号。

1. 克隆仓库并安装依赖：

   ```bash
   git clone <你的 GitHub 仓库地址>
   cd <仓库目录>
   npm install
   npx wrangler login
   ```

2. 在目标 Cloudflare 账号创建 R2 桶。可以使用 Dashboard，也可以运行：

   ```bash
   npx wrangler r2 bucket create 134688-podcast-audio
   ```

   把 `wrangler.jsonc` 里 `r2_buckets[0].bucket_name` 改为实际桶名。

3. 创建 D1 数据库：

   ```bash
   npx wrangler d1 create blogcast-db
   ```

   把命令输出的 `database_id` 填到 `wrangler.jsonc` 的 `d1_databases[0].database_id`。

4. 应用数据库迁移并部署：

   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```

   Wrangler 会按序应用 `0001_init.sql` 和 `0002_cron_lock.sql`，并配置每 4 小时一次的 Cron Trigger。首次上线后，到 **Workers & Pages → 134688-blog-podcast → Settings → Triggers → Cron Triggers** 确认触发器已同步。

5. 打开部署输出的 `workers.dev` 地址，查看播客网站。JSON 接口为 `/api/episodes`，播客订阅地址为 `/feed.xml`。可用 `https://<worker-domain>/api/health` 检查服务。

6. 如要绑定自定义域名，在 Worker 的 **Settings → Domains & Routes** 添加域名，例如 `podcast.134688.xyz`。之后用这个 HTTPS 地址订阅 `/feed.xml`。更改 `SITE_TITLE`、`SITE_DESCRIPTION`、声线或 Chromium 版本后重新部署即可。

## 本地调试

```bash
npm run db:migrate:local
npm run dev
```

如需在本地测试 Cron，运行 `npm run cron:local` 后，在另一个终端触发：

```bash
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
```

首次运行会按“首次启动行为”建立基线；默认不会合成历史文章。后续本地 Cron 会尝试生成待处理新文章，并需要本地 Worker 环境可以访问微软 TTS WebSocket。

## 常见排查

- **没有新 episode**：检查 `https://134688.xyz/rss.xml` 是否可访问、Cloudflare Cron 是否已同步，以及 `#article-content` 是否仍存在。
- **文章 URL 被拒绝**：检查 RSS 链接是否是 HTTPS、域名是否列在 `ALLOWED_SOURCE_HOSTS` 中，并确认重定向没有跳到其他域名。
- **TTS 返回错误/403**：检查 Cloudflare Worker 日志、`EDGE_CHROMIUM_VERSION` 与匹配的 User-Agent 主版本、服务器时间及微软服务是否临时限流或更改协议。
- **失败文章不再自动重试**：代码最多尝试 5 次。检查 `last_error` 后，按上面的 SQL 将该 episode 重置为 `pending`。
- **RSS 音频无法播放**：确保访问的是 Worker 的 `/feed.xml`，并检查 `/audio/{slug}` 返回 MP3。R2 桶不需要公开。
- **Cron 运行资源不足**：Scheduled Worker 的 CPU 与运行限额受 Cloudflare 账户计划影响。默认每轮只处理 1 集；若日志报 CPU/time limit，可进一步检查 Worker 当前计划和文章长度。

## 参考

- 源文章 RSS：[134688.xyz/rss.xml](https://134688.xyz/rss.xml)
- Astro RSS 生成代码：[myogg/astro/src/pages/rss.xml.ts](https://github.com/myogg/astro/blob/main/src/pages/rss.xml.ts)
- 参考音频保存流程：[hacker-podcast/workflow/audio.ts](https://github.com/miantiao-me/hacker-podcast/blob/main/workflow/audio.ts)
- 当前 Edge TTS 握手参考：[yy4382/read-aloud](https://github.com/yy4382/read-aloud)
- Cloudflare Cron Triggers：[官方文档](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- Cloudflare R2 Worker binding：[官方文档](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
- Cloudflare 本地 Scheduled 测试：[官方文档](https://developers.cloudflare.com/workers/testing/miniflare/core/scheduled/)
