# 姜小小的播客

这是独立部署的中文播客站，复用 `myogg/astro` 的文章内容、文章图片、简介和 Cloudflare R2 TTS 音频。

## 路由

- `/`：最新单集列表与正在播放入口
- `/podcast/[slug]`：单集详情页
- `/podcast.xml`：Podcast RSS

## 自动同步与部署

`.github/workflows/deploy-cloudflare.yml` 会每 4 小时从公开的 `myogg/astro` 拉取最新文章，构建播客站并部署到 Cloudflare Pages。博客文章发布后最多等待一个轮询周期；如果 TTS 音频稍后才生成，下一次轮询会再次检查 R2 并把新音频加入 RSS。

在 GitHub Actions Secrets 中配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，Cloudflare Pages 项目名为 `podcast`。详细步骤见 [`docs/cloudflare-deployment.md`](docs/cloudflare-deployment.md)。

## RSS 音频大小

音频地址为 `https://tel.xx.kg/audio/{slug}.mp3`。RSS 构建期间会对每个音频 URL 发起 HTTP `HEAD` 请求，把真实 `Content-Length` 写入 `<enclosure length="...">`。无法确认文件大小的文章不会进入 RSS，不会写入估算值。

没有文章图片的单集会使用站点专属默认封面 `public/jiang-podcast-cover.png`；有文章图片的单集继续使用原图片。

正式站点地址为 `https://r.134688.xyz`。单集播放页使用圆形旋转封面，并提供低音量的原创悠扬背景音乐开关；背景音乐不会替代或修改 R2 中的朗读音频。

## 本地开发

```bash
pnpm install
pnpm dev
```

如需从本地博客仓库刷新文章快照：

```bash
ASTRO_SOURCE_DIR=/home/ubuntu/repos/astro pnpm sync:blog
pnpm build
```
