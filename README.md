# 姜一一的播客

一个独立的 Cloudflare Worker 项目：每 4 小时检查 `https://134688.xyz/rss.xml`。发现新文章后抓取文章页正文，过滤网址后使用语音合成逐段朗读，合成 MP3 保存到 R2，并在网站与 `/feed.xml` 中发布新的一集。网站包含节目列表和 `/episode/{slug}` 详情页；同一时间只播放一集，不使用 AI 改写文章。

## 组成

- **Cloudflare Worker**：提供播客网站、JSON API、RSS feed、音频读取路由和定时任务。
- **R2**：私有保存最终 MP3。项目不开放 R2 的匿名写入，也不需要把 R2 Access Key 放进代码。
- **D1**：保存文章去重、生成状态、重试次数、音频元信息和 Cron 租约。
- **Cron Trigger**：`0 */4 * * *`，每 4 小时检查一次。Cloudflare Cron 按 UTC 运行；换算成北京时间是每天 08:00、12:00、16:00、20:00、次日 00:00 和 04:00。首次运行会把 RSS 中最多 400 篇文章登记到 D1，其中最多 20 篇排入历史回填队列；默认每轮顺序处理 2 集，后续队列留给下一轮 Cron。
- **TTS**：配置 `MIMO_API_KEY` 时优先使用 MiMo TTS，默认预置音色为中文男声 `白桦`；未配置或 MiMo 请求失败时回退到 Worker 内直接实现的 Edge TTS WebSocket 客户端，默认普通话女声 `zh-CN-XiaoxiaoNeural`。不依赖旧版 `@echristian/edge-tts` npm 包或其他转发服务。更改默认音色只影响之后新合成的节目，不会自动重做 R2 中已经生成的音频。

R2 桶默认保持私有。网站通过 Worker 的 `/audio/{slug}` 路由读取音频；没有任何公开上传接口。该路由支持 HTTP Range 请求（返回 206 与 Content-Range），播放器可拖动进度条，响应带 `public, max-age=31536000, immutable` 缓存头。RSS item 的音频 enclosure 使用播客网站自身的 URL，length 取 R2 对象的真实字节数，并附带 `itunes:duration`。

## Edge TTS 握手与维护

握手流程参考 [`yy4382/read-aloud`](https://github.com/yy4382/read-aloud)（该仓库 `package.json` 声明 ISC；项目内没有调用它的代理 API，也没有依赖其 npm 包）：

1. Worker 生成带五分钟时间窗的 `Sec-MS-GEC` v2 token（SHA-256 + CS64 摘要），并在 URL 中同时传 `TrustedClientToken`、`Sec-MS-GEC-Version=2-<Chromium版本>` 和随机 `ConnectionId`。
2. 同一请求携带与版本主号匹配的 Edge User-Agent，以及随机 `muid` Cookie。
3. Cloudflare Worker 用 `fetch(https://...)` 配合 `Upgrade: websocket` 建立出站 WebSocket。
4. 连接上先发 `speech.config`，再发带 `X-RequestId` 的 SSML；收到 MP3 音频帧并以 `turn.end` 作为该段结束标志。

默认 `EDGE_CHROMIUM_VERSION` 是 `143.0.3650.75`，与参考仓库 2026-10-14 的代码一致。微软端可能升级校验要求；如果 TTS 日志出现 403/握手失败，需要检查并同步更新此版本（请求里的版本和 User-Agent 主版本必须匹配），然后重新部署。Cloudflare 服务器时间必须准确，令牌按 5 分钟时间窗生成。

该 Read Aloud 接口是非官方在线服务，没有可用性或限流 SLA；客户端/仓库的开源许可证不代表微软对服务使用的授权。参见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

每个约 300 字文本片段会单独合成，再将 MP3 音频帧串接成一集。拼接后的首个 MP3 头部只描述第一段时长，因此 Worker 会逐帧重算真实总时长并写入 D1 的 `duration_seconds`，供 `/feed.xml` 输出 `itunes:duration`；`/audio/{slug}` 的 Range 支持则保证拖动进度条可用。当前构建已通过类型检查、Worker 打包与本地站点/Cron 基线测试；受当前环境的出站 WebSocket 限制，尚未从这里完成微软端实时合成验证。首次部署后应先用一篇短文章实测播放与进度条。

## 文章读取方式

Worker 从 Astro RSS 读取标题、链接、发布时间和摘要。当前 RSS 不包含文章全文，因此项目再访问文章页正文，并按 `#article-content` → `article` → `main` 的顺序回退提取：命中第一个有正文的容器即停止。主题改版后即使该 ID 消失，仍能从语义标签取到内容；容器顺序在 `src/article.ts` 的 `CONTENT_SELECTORS` 中调整。

默认只允许 `134688.xyz` 与 `www.134688.xyz` 的 HTTPS URL。RSS 中的文章链接和每一跳重定向都会重新校验；RSS 文件限制为 1.5 MB，文章 HTML 限制为 5 MB。若更换文章源域名，必须同时更新 `SOURCE_RSS_URL` 和 `ALLOWED_SOURCE_HOSTS`。

节目详情页会重新读取该集对应的文章页面，以显示全文；优先使用命中容器中的第一张图片作为头图，其次使用页面 `og:image`，都没有时回退到项目自带的 `/cover.svg`。头图仅在该集播放时缓慢旋转。文章正文和图片 URL 不会写入 D1；音频元信息列由 `migrations/0003_episode_meta.sql` 维护。若原博客暂时不可访问，详情页会提示稍后重试。

语音合成时会从标题和正文中移除带 `http://`、`https://`、`ftp://`、`www.` 的网址，以及常见域名后缀的网址；此过滤只作用于播报输入，详情页仍显示完整文章原文。网站列表页或详情页任一播放器开始播放时，其他节目播放器会自动暂停。

Worker 在确认实际文章正文后执行 100 字过滤：去掉空白后不足 100 个 Unicode 字符的文章会标记为内部 `baseline` 状态，不生成 TTS 音频、不出现在节目列表或播客 RSS 中，也不会在下一轮重复尝试。RSS 的 `description` 是摘要而非全文，因此过滤基于文章正文，不基于摘要；判断前需要读取一次文章页面。

达到正文长度门槛的文章生成一集。正文前会朗读文章标题；正文不会经过 AI 改写。文章链接会被校验并哈希成固定、路由安全的节目 ID，用作稳定去重标识。播客 RSS 单集链接指向本站详情页，详情页提供原文链接。

## 首次启动行为

首次运行会将当前 RSS 中最多 400 篇文章登记到 D1。`INITIAL_BACKFILL_COUNT` 指定其中排入回填队列的文章数；当前配置为 `20`，因此只有最近 20 篇符合条件的历史文章会开始生成，其余登记为 `baseline`。实际正文少于 100 字的文章会跳过。注意 RSS 源和 Worker 都最多处理 400 条，且 RSS 响应大小仍限制为 1.5 MB；应在首次 Cron 日志中确认实际登记数量。

每次 Cron 最多顺序合成 `MAX_EPISODES_PER_RUN` 篇（当前为 `2`）。20 篇回填队列按每轮 2 集、每天 6 轮计算，理想情况下约需 2 天；实际时间会受 TTS 响应、Cloudflare 执行限制和失败重试影响。若 Microsoft TTS 开始限流或 Worker 日志出现超时，应把该值调低。

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

   Wrangler 会按序应用 `0001_init.sql`、`0002_cron_lock.sql` 和 `0003_episode_meta.sql`，并配置每 4 小时一次的 Cron Trigger。首次上线后，到 **Workers & Pages → 134688-blog-podcast → Settings → Triggers → Cron Triggers** 确认触发器已同步。

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

首次运行会按“首次启动行为”建立基线；本地 `wrangler.jsonc` 当前也会登记最多 400 篇、排队 20 篇，并按每轮设置处理最多 2 集。短文会在正文检查后跳过。本地 Worker 需要能够访问博客，以及 MiMo 或微软 Edge TTS 服务。

## 常见排查

- **没有新 episode**：检查 `https://134688.xyz/rss.xml` 是否可访问、Cloudflare Cron 是否已同步，以及正文容器是否仍能命中（`#article-content` / `article` / `main`）。实际正文不足 100 字的文章会有意跳过；RSS 摘要长度不用于判断。
- **文章 URL 被拒绝**：检查 RSS 链接是否是 HTTPS、域名是否列在 `ALLOWED_SOURCE_HOSTS` 中，并确认重定向没有跳到其他域名。
- **TTS 返回错误/403**：检查 Cloudflare Worker 日志、`EDGE_CHROMIUM_VERSION` 与匹配的 User-Agent 主版本、服务器时间及微软服务是否临时限流或更改协议。
- **失败文章不再自动重试**：代码最多尝试 5 次。检查 `last_error` 后，按上面的 SQL 将该 episode 重置为 `pending`。
- **RSS 音频无法播放**：确保访问的是 Worker 的 `/feed.xml`，并检查 `/audio/{slug}` 返回 MP3。R2 桶不需要公开。
- **详情页图片缺失**：优先取文章正文第一张 HTTPS 图片，其次用页面 `og:image`，最终回退 `/cover.svg`；检查源文章是否有图片和图片 URL 是否可直接访问。
- **Cron 运行资源不足**：Scheduled Worker 的 CPU 与运行限额受 Cloudflare 账户计划影响。当前每轮最多处理 2 集；若日志报 CPU/time limit，可进一步检查 Worker 当前计划和文章长度。

## 参考

- 源文章 RSS：[134688.xyz/rss.xml](https://134688.xyz/rss.xml)
- Astro RSS 生成代码：[myogg/astro/src/pages/rss.xml.ts](https://github.com/myogg/astro/blob/main/src/pages/rss.xml.ts)
- 参考音频保存流程：[hacker-podcast/workflow/audio.ts](https://github.com/miantiao-me/hacker-podcast/blob/main/workflow/audio.ts)
- 当前 Edge TTS 握手参考：[yy4382/read-aloud](https://github.com/yy4382/read-aloud)
- Cloudflare Cron Triggers：[官方文档](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- Cloudflare R2 Worker binding：[官方文档](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
- Cloudflare 本地 Scheduled 测试：[官方文档](https://developers.cloudflare.com/workers/testing/miniflare/core/scheduled/)
