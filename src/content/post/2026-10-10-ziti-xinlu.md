---
title: "字体的心路历程"
date: 2026-10-10
description: "拆解博客现用的字体加载方案：preconnect、link stylesheet、font-display: swap、unicode-range 子集。方式已近乎教科书，真正贵的是字体文件本身太大。"
tags: ["Astro", "性能优化", "字体"]
---

先说实话，现在这套加载方式已经挺快了，真正卡的不是加载姿势，是字体文件本身太大。我把现状拆开讲讲，哪些值得动、哪些其实不用动。

都在 `BaseLayout.astro` 第 38 到 68 行附近。现在在做的几件事大概是这样：

- preconnect 预热 3 个源 —— 对的，少握手少 TLS
- 外部字体用 link stylesheet —— 比 @import 早发现，也比以前塞在 CSS 里的 @font-face 好
- font-display: swap —— 先用备用字体顶着，真字体来了再换，不白屏
- 本地 Inter 做 preload —— 英文正文优先，还不用等 CDN
- Noto / OPPO 用 unicode-range 子集 —— 中文只下用到的字，这是省流量的关键

在 Astro 静态站里，这套已经是教科书级别了，加载方式上基本没啥浪费。真正贵的地方有两处。

一是两个外部样式表会挡渲染。Noto 和 OPPO 的 CSS 分别在 fonts.loli.net 和 cdn.jsdelivr.net。preconnect 已经让它们并行建连，这点没问题。但样式表排在 preload 前面，渲染得先等 CSS 下来。好在有 display:swap，文字能先出来，不会白屏。

二是字体文件本身太大，尤其是 Noto。实际下来的是 Noto Sans SC 的子集分片，中文标题一页可能拉几十个小片，总共几百 KB 很常见。预加载帮不上忙，因为你根本没法提前知道这篇文章会用到哪些字，浏览器只能按需现拉。这是中文网页字体的固有成本，几乎无解。

还值得动的地方其实不多。preconnect 现在已经在样式表前面了，基本不用改。font-display: swap 也开着，不用动。

真正可以想想的是 OPPO 要不要留。它走 jsdelivr 的 oppo-sans.css。如果你正文其实更常看系统的 PingFang 或微软雅黑，OPPO 就只是锦上添花。可以试着去掉，看中文正文能不能接受系统字体——能接受的话，少一个 CDN，也少下一套字体。不过你把 OPPO 排在系统字体前面，可能是故意想要它的效果，这个看你自己。

加载方式已经合理且偏优了。想再快一点，方向不是改加载姿势，而是少加载字体——要么删掉你觉得不必要的（比如 OPPO），要么就接受中文标题那套 Noto 子集本来就是全网常态。没有银弹。
