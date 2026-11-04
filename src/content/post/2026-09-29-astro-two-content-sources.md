---
title: "让 Astro 同时拥有两个发文源"
date: 2026-09-29 08:00
description: "自己写 Markdown 和 GitHub Issues 两套发文系统各自独立，最后汇合到同一个仓库。真正麻烦的不是 Astro，而是 Git。"
tags: ["Astro", "GitHub", "Cloudflare", "博客"]
---

最近又折腾了一下我的 Astro 博客。

这次折腾的事情其实很简单：我想让博客同时拥有两个发文来源。

一个是我自己写 Markdown。

另一个是 GitHub Issues。

这两个系统各自独立，各写各的文章，最后都进入 Astro 的 src/content/post。

一开始我觉得这应该没什么问题。

后来才发现，真正麻烦的地方不是 Astro，而是 Git。

## 两个发文系统

现在我的文章来源是这样的。

一条是自己写 Markdown，然后进入 src/content/post，再提交到 GitHub main，最后由 Astro 构建。

另一条是 GitHub Issues，经过 GitHub Actions，运行 sync-issues.mjs，生成 Markdown，进入 src/content/post，再提交到 GitHub main，最后由 Astro 构建。

看起来两套系统互不影响。

实际上它们最后都要做同一件事情：把修改推到同一个 GitHub 仓库的 main 分支。

## 第一次遇到的问题

之前我已经用 GitHub Issues 成功发布过一篇文章。

后来我又自己写了一篇 Markdown。

结果 GitHub Actions 在同步 Issues 的时候报错，提示 main 分支被拒绝，failed to push some refs。

刚开始看到这个错误，我还以为是不是两个文章源发生了什么冲突。

后来才发现，并不是。

两篇文章根本不是同一个文件，也不存在内容覆盖。

真正的问题是 Git 的提交历史。

比如远程 GitHub 上已经是 A 到 B，而 GitHub Actions 手里的代码还停在 A，它自己又生成了一篇 Issue 文章，于是变成 A 到 C。

虽然 B 和 C 是完全不同的文章，但是 Git 还是会说，远程已经有新的提交了，你不能直接把自己的版本推上去。

所以这次推送被拒绝了。

## 原来是 Git，不是文章

这件事情让我理解了一个之前没有特别注意的问题。

Git 关心的是提交历史，而不是两个人改的是不是同一个文件。

也就是说，两篇完全不同的文章完全可以互不冲突。

但是如果远程已经多了一个提交，而你的本地版本没有包含这个提交，那么直接推送仍然可能被拒绝。

这和文章有没有同名，没有直接关系。

## 最后的解决办法

我的 GitHub Actions 原来只做了两件事：先提交，再推送。

后来在中间增加了一步，就是先把远程最新的 main 拉下来，做一次 rebase，然后再推送。

意思就是，先把远程最新的 main 拉下来，然后把 GitHub Issues 这次生成的提交重新放到最新版本之后，最后再推送。

于是原来分叉的 A 到 B 和 A 到 C，就会变成一条线：A 到 B 再到 C。

这样两边的文章都保留下来。

## 现在两个发文源就可以各管各的

现在我的理解已经比较清楚了。

自己写的 Markdown，就发自己的。

GitHub Issues，就发 Issues 的。

两边并不需要合并成一个发文系统。

它们只是在最后汇合到 GitHub main。

而那次 rebase，负责把两个不同时间产生的提交重新整理到一起。

所以以后不管是谁先发，是自己写 Markdown 先推送，还是 Issue 经过 Actions 先推送，都可以正常工作。

## 后来又遇到了 Cloudflare

GitHub 的问题解决以后，我又发现一个新的问题。

GitHub 明明已经有新的文章了，但是 Cloudflare 上的网站没有更新。

后来才发现，问题甚至还不是 Astro。

而是 Cloudflare 看不到这个 GitHub 仓库。

GitHub 仓库本身完全正常，GitHub Actions 也能正常运行。

只是 Cloudflare 和 GitHub 之间的授权没有包含这个仓库。

最后在 GitHub 用户设置里的 GitHub Apps 中，把 Cloudflare 的仓库访问权限补上。

重新连接以后，Cloudflare 就能够看到我的仓库了。

网站也恢复了自动部署。

## 这次真正学到的东西

这次折腾让我第一次比较完整地看清楚了一个博客从发文到上线的过程。

文章来源，可能是 Markdown，也可能是 GitHub Issues。

然后经过 Git，进入 GitHub，再经过 GitHub Actions，再到 Cloudflare，最后经过 Astro 构建，变成网站。

以前看到网站没有更新，可能只会想着，是不是 Astro 哪里坏了。

现在就可以一层一层去看。

文章有没有生成，看 GitHub Actions。

有没有成功提交到 GitHub，看 Git。

GitHub 有没有最新文件，直接看仓库。

Cloudflare 有没有收到新的提交，看 Deployments。

Cloudflare 能不能访问这个仓库，检查 GitHub App 的权限。

这样问题就不会全部混在一起。

## 最后

其实这次没有写什么复杂的代码。

只是增加了一步 rebase，然后修复了一次 Cloudflare 的 GitHub 仓库访问权限。

但我觉得这种折腾还是挺有意思的。

因为很多时候，真正学到的东西并不是某一行代码，而是慢慢知道，一个东西为什么会坏，以及应该从哪一层开始找问题。

现在我的 Astro 有两个完全独立的文章源。

自己写 Markdown，加上 GitHub Issues。

它们各自发自己的文章，互不干扰，最后汇合。

这套东西现在算是跑通了。
