# Cloudflare 自动部署

这个仓库通过 `.github/workflows/deploy-cloudflare.yml` 自动部署到 Cloudflare Pages。

## 一次性准备

1. 在 Cloudflare Pages 创建项目，项目名设为 `134688-podcast`。可以先不连接 Git，后续由 Wrangler 上传。
2. 在 GitHub 仓库 `myogg/134688-podcast` 的 **Settings → Secrets and variables → Actions** 中增加：
   - `CLOUDFLARE_API_TOKEN`：只授予该账号 Cloudflare Pages 编辑权限的 API Token。
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。
3. 把 `134688-podcast.pages.dev` 绑定到需要的自定义域名，例如 `podcast.134688.xyz`。

## 自动行为

工作流在以下情况执行：

- 播客仓库 `main` 有提交时立即执行；
- 每 4 小时定时执行一次，拉取 `myogg/astro` 的最新文章，同时检查 R2 中是否已经生成对应 MP3；
- 手动点击 GitHub Actions 的 **Run workflow** 时执行。

每次执行都会从公开的 `myogg/astro` 拉取最新 `src/content/post`，再构建独立播客站。RSS 生成时对 `https://tel.xx.kg/audio/{slug}.mp3` 发起 `HEAD`，只有能取得真实 `Content-Length` 的音频才会写入 `/podcast.xml`。因此博客文章和 TTS 音频不必同时完成：音频稍后生成后，下一次定时任务会自动把它加入 RSS。

## 费用提示

GitHub Actions 的免费额度取决于 GitHub 账户和仓库类型；Cloudflare Pages 静态资源通常可在免费计划内运行。R2 音频继续使用现有 `tel.xx.kg`，费用按 Cloudflare R2 账户实际用量计算。
