# 姜小小的播客：主流平台提交指南

正式网站：<https://r.134688.xyz>

RSS Feed：<https://r.134688.xyz/podcast.xml>

这份指南适用于当前的独立 RSS 模式。你的音频继续托管在 R2，网站和 RSS 继续由 Cloudflare Pages 自动更新。提交到平台后，不需要把音频文件重新上传到每个平台；平台会按照 RSS 中的 `enclosure` 地址抓取和播放新单集。

## 提交前先检查

目前正式 RSS 已经可以访问，节目名称是“姜小小的播客”，并且每个已发布单集都有音频 URL、真实文件大小和 `audio/mpeg` 类型。Apple 要求 RSS 是公开可访问的 RSS 2.0 Feed；每期节目需要唯一的 `enclosure`，同时包含 URL、`length` 和 `type`，还需要稳定不变的 GUID。音频服务器还应支持 HTTP HEAD 和 byte-range 请求。[1]

先用 Apple 播客 App 做一次个人预览：在 iPhone 的“播客”App 中打开“资料库”→右上角“编辑”→“通过 URL 关注节目”，输入 RSS 地址。这个操作只用于测试，不会把节目发布到 Apple 目录。[2]

当前 RSS 还有一个提交前需要留意的事项：Feed 中没有公开的 `itunes:email`。Spotify 会把验证码发送到 RSS 里的邮箱地址，YouTube 也要求通过 RSS 邮箱验证码验证所有权。[3] [4] 建议准备一个专门的播客邮箱，例如 `podcast@你的域名`，再把它加入 RSS 的 `itunes:owner` 信息；这个邮箱会随 RSS 公开，不建议直接使用私人邮箱。

## 1. 提交 Apple Podcasts

Apple 的正式入口是 [Apple Podcasts Connect](https://podcastsconnect.apple.com/)。需要使用 Apple Account 登录并加入 Podcasts Connect。Apple 官方支持通过第三方托管的 RSS Feed 提交节目。[5]

操作步骤：

1. 登录 Apple Podcasts Connect。
2. 点击右上角的“+”，选择“New Show”。
3. 选择“Add a show with an RSS feed”。
4. 输入：`https://r.134688.xyz/podcast.xml`。
5. 点击“Add”，等待 Apple 读取节目资料。
6. 检查节目名称、作者、描述、封面、语言和节目分类。
7. 在 Content Rights 中确认你拥有文章、音频、图片和音乐的使用权。
8. 在 Contact Information 中填写可以处理平台问题的联系邮箱。
9. 在 Availability 中选择发布国家或地区、公开分发和发布时间。
10. 通过验证后点击 Publish，等待 Apple 审核。

Apple 会先进行 RSS 技术验证，再进行内容审核。验证通过不等于已经公开上线，仍然需要完成发布和审核。[6]

### Apple 提交时的选择建议

- 节目类型：如果单集可以独立收听，选择 Episodic；不要求按顺序收听时不要选择 Serialized。
- 语言：选择 Chinese / 中文相关选项。
- Explicit：当前节目没有成人或粗俗内容时，保持非显式内容。
- 分类：先使用 Arts，后续可以按实际内容改成 Technology、Society & Culture 或其他更准确分类。
- 可见性：建议选择公开分发，否则第三方播客应用可能无法通过目录 API 发现节目。

如果验证报错，优先检查 RSS URL 是否使用 HTTPS、Feed 是否能在未登录状态打开、音频地址是否支持 HEAD 和 byte-range，以及所有 `enclosure` 是否有正确的 `length` 和 `type`。[1] [6]

## 2. 提交 Spotify

Spotify 的入口是 [Spotify for Creators](https://creators.spotify.com/)。Spotify 官方支持认领已经托管在其他地方的播客。[3]

操作步骤：

1. 登录 Spotify for Creators。没有 Spotify 账号可以免费注册。
2. 选择“Find an existing show”。
3. 选择“Somewhere else”。
4. 输入 RSS：`https://r.134688.xyz/podcast.xml`。
5. Spotify 会把验证码发送到 RSS 中的邮箱地址。
6. 输入收到的 8 位验证码，完成所有权验证。
7. 检查节目封面、标题、简介和单集列表。
8. 完成认领后，在节目后台查看状态和数据。

这里要注意：Spotify 官方说明，认领时验证码会发到 RSS 中的邮箱。[3] 因此在给 Spotify 提交之前，应该先确保 RSS 中有一个你能收信的公开播客邮箱。如果当前 Feed 还没有邮箱，先补充邮箱，再重新部署并提交。

不要在 Spotify 中选择“切换托管”或“Import episodes”来替代认领。当前目标是保留 R2 和 Cloudflare Pages 作为原有托管，只把节目提交或认领到 Spotify。

## 3. 小宇宙

小宇宙的公开网站提供“主播后台”入口，但目前没有像 Apple Podcasts Connect 那样清晰、稳定的公开 RSS 自助提交说明。[7] 实际操作时，建议从小宇宙网页顶部的“主播后台”进入，登录后寻找“创建节目”“导入 RSS”“提交已有节目”或类似选项。

如果后台提供 RSS 导入：

1. 创建或认领节目“姜小小的播客”。
2. 粘贴 `https://r.134688.xyz/podcast.xml`。
3. 检查封面、节目简介和单集列表。
4. 按后台要求完成邮箱或人工审核。
5. 确认新单集是否会按 RSS 自动同步。

如果后台只提供上传音频，而没有 RSS 导入：

- 不要为了上架而把同一批节目手动重复上传，除非你接受小宇宙作为另一套内容管理和发布渠道；
- 先联系小宇宙官方支持，询问“独立 RSS Feed 导入已有节目”的申请入口；
- 询问清楚导入后是否支持自动更新、能否保留原有 GUID、能否修改节目资料，以及以后更换 RSS 地址的流程。

小宇宙用户也可以通过泛用型播客客户端订阅公开 RSS，但“能被客户端订阅”与“节目正式出现在小宇宙目录”是两件不同的事。不要把个人 RSS 订阅入口误认为官方节目上架入口。

## 4. YouTube 和 YouTube Music

如果希望覆盖 YouTube 和 YouTube Music，可以在 [YouTube Studio](https://studio.youtube.com/) 中导入 RSS。YouTube 会根据 RSS 为每期音频制作静态图片视频；当 RSS 中出现新单集时，系统可以自动创建新视频。[4]

操作步骤：

1. 登录 YouTube Studio。
2. 进入“内容”→“播客”。
3. 新建播客，或打开已有播客的详情页。
4. 找到 RSS 设置并关联 RSS Feed。
5. 输入：`https://r.134688.xyz/podcast.xml`。
6. 查看 RSS 中的邮箱并完成验证码验证。
7. 首次导入时，建议先使用“私享”或“不公开列出”测试。
8. 确认封面、标题、音频和单集顺序正确后，再改为公开。

YouTube 官方特别提醒，RSS 导入只会发布到 YouTube 和 YouTube Music，不会自动分发到其他播客平台；它也不会自动同步所有节目详情修改。[4]

## 5. 其他泛用型播客客户端

Pocket Casts、Overcast、Castbox 等应用通常以 RSS 目录或搜索索引为主。提交前先确认 Feed 公开可访问、音频支持断点请求、封面可以被抓取。若平台提供“Submit podcast”“Add podcast”或“Claim show”入口，就提交同一个 RSS 地址；如果没有入口，可以先等待目录自动收录，再通过节目页面申请认领。

不建议为每个平台生成不同 RSS。除非某个平台明确要求独立 Feed，否则所有平台都使用：

```text
https://r.134688.xyz/podcast.xml
```

这样后续文章同步、音频生成、单集 GUID 和节目资料都保持一致。

## 上架后的维护规则

不要删除或改动已经发布单集的 GUID。不要更改历史单集的音频 URL；如果确实需要更换音频地址，应确保旧地址仍然可访问，或使用平台支持的迁移和重定向流程。

新文章发布后，当前 GitHub Actions 会同步博客内容并部署播客站，定时任务每 4 小时再次检查新文章和 R2 音频。平台会按照 RSS 的更新时间抓取新单集，但不同平台的抓取延迟不同，通常不需要手动重新提交节目。

发布前，确认文章图片、TTS 音频和背景音乐都拥有相应使用权。当前 RSS 的 `enclosure` 是 R2 公开音频地址；网页播放页的背景音乐不会混入 RSS 中的朗读文件。

## 推荐提交顺序

建议按这个顺序操作：

1. 先确认 `https://r.134688.xyz/podcast.xml` 可以在浏览器直接打开。
2. 补充一个可收验证码的播客邮箱到 RSS。
3. 用 Apple 播客 App 通过 URL 预览。
4. 提交 Apple Podcasts，完成验证和审核。
5. 提交 Spotify for Creators，完成邮箱验证码认领。
6. 从小宇宙主播后台申请 RSS 导入或节目上架。
7. 最后接入 YouTube RSS 导入，并先以私享方式检查首批视频。

## 参考资料

[1]: https://podcasters.apple.com/support/823-podcast-requirements "Apple Podcasts RSS feed requirements"
[2]: https://podcasters.apple.com/zh-cn/support/828-test-your-podcast "测试播客 RSS Feed"
[3]: https://support.spotify.com/us/creators/article/claiming-your-podcast-on-spotify-for-creators/ "Claiming your podcast on Spotify for Creators"
[4]: https://support.google.com/youtube/answer/13525207?hl=zh-Hans "通过 RSS Feed 将播客上传到 YouTube"
[5]: https://podcasters.apple.com/support/897-submit-a-show "Submit a new show"
[6]: https://podcasters.apple.com/zh-cn/support/829-validate-your-podcast "验证播客 RSS Feed"
[7]: https://www.xiaoyuzhoufm.com/ "小宇宙"
