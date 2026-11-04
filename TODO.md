# 交付待办

## 播客首页

- [x] 提供独立中文播客首页，展示节目封面、节目简介和最新单集列表。
- [x] 最新单集列表展示标题、简介、发布日期、封面和音频入口。

## 单集详情与播放器

- [x] 提供 `/podcast/[slug]` 单集详情页。
- [x] 展示文章标题、简介、图片、正文摘要、原文链接和音频信息。
- [x] 使用原生音频控件支持播放、暂停、进度拖动、当前时间、总时长和倍速。

## 内容复用

- [x] 从现有 Astro 博客文章复用文章内容、简介、图片和日期。
- [x] 从已验证的 R2 公开基址 `https://tel.xx.kg` 映射 `audio/{slug}.mp3`。

## Podcast RSS

- [x] 提供 `/podcast.xml`。
- [x] RSS 包含节目元数据、单集标题、简介、日期、GUID、详情页 URL 和 enclosure。
- [x] 生成 enclosure 前对音频 URL 发起 HTTP HEAD，并将真实 `Content-Length` 写入 `length`。
- [x] 无法确认音频大小的单集不写入 RSS，并在构建日志中说明原因。

## 可发现性与交付

- [x] 提供站点级 canonical、Open Graph、Podcast RSS alternate、sitemap/robots 兼容元信息。
- [x] 提供 `/manus-routes.json`。
- [x] 完成依赖安装、类型检查和生产构建。
