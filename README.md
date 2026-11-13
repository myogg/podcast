# 姜一一的播客

一个独立的 Cloudflare Worker 项目：每小时检查 `https://134688.xyz/rss.xml`。发现新文章后抓取文章页正文，过滤网址后使用语音合成逐段朗读，合成 MP3 保存到 R2，并在网站与 `/feed.xml` 中发布新的一集。网站包含节目列表和 `/episode/{slug}` 详情页；详情页只显示 RSS 摘要，不展示文章全文；同一时间只播放一集，不使用 AI 改写文章。

## 组成

- **Cloudflare Worker**：提供播客网站、JSON API、RSS feed、音频读取路由和定时任务。
- **R2**：私有保存最终 MP3。项目不开放 R2 的匿名写入，也不需要把 R2 Access Key 放进代码。
- **D1**：保存文章去重、生成状态、重试次数、音频元信息和 Cron 租约。
- **Cron Trigger**：当前为**快速回填模式**，`0 * * * *`，每小时整点检查一次（Cloudflare Cron 按 UTC 运行，即北京时间每小时整点）。首次运行会把 RSS 中最多 400 篇文章全部登记并排入历史回填队列；对已经 bootstrap 过的旧库，每轮会把此前因超出配额而搁置的 `baseline` 历史文章自动补进队列。每轮顺序处理 10 集，相邻两集之间间隔 2 秒以避免 TTS 限流，单集失败即记为 `failed` 并继续下一篇。回填完成后应把 Cron 改回 `0 */4 * * *`（每 4 小时一次）。
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

## 文章读取方式与节目 ID

Worker 从 Astro RSS 读取标题、链接、发布时间和摘要。RSS 只输出摘要，因此**语音合成**仍会访问文章页正文，并按 `#article-content` → `article` → `main` 的顺序回退提取；这一步只服务于 TTS，正文不写入 D1，也不用于网站展示。容器顺序在 `src/article.ts` 的 `CONTENT_SELECTORS` 中调整。

默认只允许 `134688.xyz` 与 `www.134688.xyz` 的 HTTPS URL。RSS 中的文章链接和每一跳重定向都会重新校验；RSS 文件限制为 1.5 MB，文章 HTML 限制为 5 MB。若更换文章源域名，必须同时更新 `SOURCE_RSS_URL` 和 `ALLOWED_SOURCE_HOSTS`。

节目 ID 直接取博客文章 URL 的 `/post/<slug>`（`src/article.ts` 的 `extractPostSlug`）：支持末尾斜杠与百分号编码的中文 slug，只允许字母、数字、中文、`-`、`_`；解析失败的文章整篇跳过，不再用 hash(URL) 兜底。老库的 hash ID 由 `migrations/0004_legacy_slug.sql` 加 `legacy_slug` 列保存，Worker 在首次 Cron / 手动触发时幂等迁移；`/audio/{slug}` 与详情接口先按 `slug` 查、查不到再按 `legacy_slug` 查，旧订阅链接不会失效。

网站展示只用 RSS 摘要：登记时把 RSS 的 `description` 写入 D1 的 `description`（`migrations/0005_episode_description.sql`），RSS 没给摘要时用标题兜底。列表页 `/api/episodes`、`/feed.xml` 和 `/episode/{slug}` 详情页都只读这一列；详情页只显示标题、发布时间、摘要、音频播放器、原文链接与提示文案，不会请求博客文章页，也不解析正文容器。feed 的 `<description>` 会做 HTML 转义。

网站列表页分页展示：`GET /api/episodes?page=N&limit=M`，默认每页 12 集、`limit` 上限 100，非法参数回退默认值，越界 `page` 收敛到最后一页。响应体除 `episodes` 外还带 `pagination`（`page` / `pageSize` / `total` / `totalPages` / `hasPrev` / `hasNext`）；前端用 `?page=N` 同步网址、支持浏览器前进后退，节目序号按全站连续编号。`published_at` 相同时以 `slug` 作次级排序键，保证翻页不重复、不漏集。`/feed.xml` **不分页**：播客客户端需一次拿到完整目录，因此只设一个很大的上限（`FEED_MAX_ITEMS`）防止异常数据，不再按 100 集截断，历史集不会从订阅里消失。

语音合成时会从标题和正文中移除带 `http://`、`https://`、`ftp://`、`www.` 的网址，以及常见域名后缀的网址；此过滤只作用于播报输入。网站列表页或详情页任一播放器开始播放时，其他节目播放器会自动暂停。

Worker 在确认实际文章正文后执行 100 字过滤：去掉空白后不足 100 个 Unicode 字符的文章会标记为内部 `baseline` 状态，不生成 TTS 音频、不出现在节目列表或播客 RSS 中，也不会在下一轮重复尝试。RSS 的 `description` 是摘要而非全文，因此过滤基于文章正文，不基于摘要；判断前需要读取一次文章页面。

达到正文长度门槛的文章生成一集。正文前会朗读文章标题；正文不会经过 AI 改写。播客 RSS 单集的 `<guid>` 与 `<link>` 都用新 slug 指向本站详情页，详情页提供原文链接。

## 首次启动行为

首次运行会将当前 RSS 中最多 400 篇文章登记到 D1。`INITIAL_BACKFILL_COUNT` 指定其中排入回填队列的文章数；当前配置为 `400`，因此所有登记的历史文章都会进入队列。对已经 bootstrap 过的旧库（早先 `INITIAL_BACKFILL_COUNT` 较小），每轮 `pollAndProcess` 会调用 `requeueDeferredBaseline`，把 `status='baseline'` 且从未尝试合成（`attempts=0`、无音频）的文章幂等地补进队列；正文不足 100 字被判 `baseline` 的短文不会被误捞。实际正文少于 100 字的文章会跳过。注意 RSS 源和 Worker 都最多处理 400 条，且 RSS 响应大小仍限制为 1.5 MB；应在首次 Cron 日志中确认实际登记数量。

每次 Cron 最多顺序合成 `MAX_EPISODES_PER_RUN` 篇（当前为 `10`）。快速回填模式下 Cron 每小时一次，约 375 篇待回填文章按每轮 10 集计算约需 38 小时；相邻两集之间固定间隔 2 秒，降低 TTS 被限流的概率。实际时间会受 TTS 响应、Cloudflare 执行限制和单篇失败影响；单篇合成失败会立即记为 `failed` 并继续下一篇，不重试、不阻塞整轮。若 Worker 日志出现超时或 TTS 限流，可把该值调低。单轮 10 集会明显增加 Scheduled Worker 的运行时长与出站请求数，需留意账户计划的 CPU / 时长 / subrequest 限额。

D1 `cron_lock` 租约防止手动触发和 Cron 重叠时重复合成；过期的 `processing` 任务会在下一轮恢复。快速回填模式下，单集**一旦合成失败就立即记为 `failed`**，跳过继续下一篇，不再自动重试，避免失败文章卡住整轮。排查后可在 D1 Console 或 Wrangler 执行以下 SQL 手动重置：

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

   Wrangler 会按序应用 `0001_init.sql` ~ `0005_episode_description.sql`，并配置每小时一次的 Cron Trigger（快速回填模式，回填完成后可改回每 4 小时一次）。已有数据库请先确认 `0004`、`0005` 的列已存在，再部署新代码。首次上线后，到 **Workers & Pages → 134688-blog-podcast → Settings → Triggers → Cron Triggers** 确认触发器已同步。

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

首次运行会按“首次启动行为”建立基线；本地 `wrangler.jsonc` 当前也会登记最多 400 篇、全部排队（400），并按每轮设置处理最多 10 集，篇间间隔 2 秒。短文会在正文检查后跳过。本地 Worker 需要能够访问博客，以及 MiMo 或微软 Edge TTS 服务。

## 常见排查

- **没有新 episode**：检查 `https://134688.xyz/rss.xml` 是否可访问、Cloudflare Cron 是否已同步，以及正文容器是否仍能命中（`#article-content` / `article` / `main`）。实际正文不足 100 字的文章会有意跳过；RSS 摘要长度不用于判断。
- **文章 URL 被拒绝**：检查 RSS 链接是否是 HTTPS、域名是否列在 `ALLOWED_SOURCE_HOSTS` 中，并确认重定向没有跳到其他域名。
- **TTS 返回错误/403**：检查 Cloudflare Worker 日志、`EDGE_CHROMIUM_VERSION` 与匹配的 User-Agent 主版本、服务器时间及微软服务是否临时限流或更改协议。
- **失败文章不再自动重试**：快速回填模式下单集失败即 `failed`，不重试。检查 `last_error` 后，按上面的 SQL 将该 episode 重置为 `pending`。
- **RSS 音频无法播放**：确保访问的是 Worker 的 `/feed.xml`，并检查 `/audio/{slug}` 返回 MP3。R2 桶不需要公开。
- **详情页摘要为空**：`description` 为空时自动用标题兜底；详情页不再读取博客文章页，博客暂时不可访问也不影响已发布节目。
- **Cron 运行资源不足**：Scheduled Worker 的 CPU 与运行限额受 Cloudflare 账户计划影响。快速回填模式当前每轮最多处理 10 集、每小时一次，并插入 2 秒篇间间隔；若日志报 CPU/time limit 或 subrequest 超限，可把 `MAX_EPISODES_PER_RUN` 或 Cron 频率调低。

## 参考

- 源文章 RSS：[134688.xyz/rss.xml](https://134688.xyz/rss.xml)
- Astro RSS 生成代码：[myogg/astro/src/pages/rss.xml.ts](https://github.com/myogg/astro/blob/main/src/pages/rss.xml.ts)
- 参考音频保存流程：[hacker-podcast/workflow/audio.ts](https://github.com/miantiao-me/hacker-podcast/blob/main/workflow/audio.ts)
- 当前 Edge TTS 握手参考：[yy4382/read-aloud](https://github.com/yy4382/read-aloud)
- Cloudflare Cron Triggers：[官方文档](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- Cloudflare R2 Worker binding：[官方文档](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
- Cloudflare 本地 Scheduled 测试：[官方文档](https://developers.cloudflare.com/workers/testing/miniflare/core/scheduled/)
