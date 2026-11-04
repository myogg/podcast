---
title: "Cloudflare 联手 OpenAI 推出 Agent Cloud：企业级 AI 智能体来了"
date: 2026-04-13 08:00
description: "Cloudflare 宣布在其 Agent Cloud 平台中接入 OpenAI 的前沿模型，包括 GPT-5.4 和 Codex，数百万企业客户可直接在边缘网络部署 AI 智能体。"
tags: ["AI", "OpenAI"]
---

Key Takeaways: 

- Millions of enterprises can now access OpenAI frontier models directly within Cloudflare Agent Cloud.

- With OpenAI, enterprises using Cloudflare’s Agent Cloud can deploy agents powered by models like GPT‑5.4 to perform real work. 

- Enterprises can now deploy agents built on Codex harness to Cloudflare. 

Cloudflare 和 OpenAI 刚放了个联合大招。

今天他们正式宣布：**OpenAI 的前沿模型直接接入 Cloudflare Agent Cloud**。说白了，就是企业现在可以在 Cloudflare 的全球边缘网络上，一键部署由 GPT-5.4 或 Codex 驱动的 AI 智能体——**自动处理客户响应、系统更新、报告生成**，而且跑在 Cloudflare 的低延迟网络上。

你可能会说：“啊？那跟自己调 OpenAI API 写 Agent 有什么区别？”

区别可太大了。

以前你想在企业里落地一个 AI 智能体，比如“自动回复客户邮件 + 查内部知识库 + 生成工单”，你得自己搭服务器、管并发、搞安全策略、处理延迟……折腾下来，光基础设施就够一个团队忙几个月。

现在呢？Cloudflare 把这些都包了。Agent Cloud 基于 **Workers AI** 运行，智能体直接部署在 Cloudflare 的边缘网络上——全球 300 多个数据中心，离你的用户近得离谱。而且自带**沙箱安全环境**，代码执行不怕乱搞。

更关键的是：Codex harness 已经在 **Cloudflare Sandboxes** 里正式上线了。也就是说，你可以用 Codex 写代码、跑任务，全部在一个安全隔离的虚拟环境里执行。近期还会接入 Workers AI，打通全链路。

另外有个数字挺吓人：OpenAI 的 API 现在每分钟处理 **超过 150 亿个 Token**。沃尔玛、摩根士丹利、埃森哲等超过 100 万家企业已经在用。这次跟 Cloudflare 合作，等于给这些企业加了一层“边缘加速 + 安全隔离”。

当然，刚出来肯定有门槛。目前 Agent Cloud 对企业客户开放，具体定价还没公布。个人开发者可能得再等等。

还有他们画了个饼：未来边缘网络上的 AI 智能体可以**互相协作**——一个处理客户请求，一个查数据库，一个生成回复，全部自动协调。想想还挺带感的。

一句话总结：如果你还在纠结怎么把 AI 智能体安全、低延迟地部署到生产环境，Cloudflare + OpenAI 这套组合拳值得盯着。**边缘网络 + 前沿模型 + 安全沙箱**，三件事放一起，目前市面上确实没有第二家。

想玩的直接去 Cloudflare 官网看 Agent Cloud 的文档。我已经准备试试了，看看它到底能帮企业省多少运维时间。

> **Key Takeaways**：
> - 数百万企业可直接在 Cloudflare Agent Cloud 中使用 GPT-5.4 和 Codex
> - Codex harness 已在 Cloudflare Sandboxes 上线，即将接入 Workers AI
> - 沃尔玛、摩根士丹利、埃森哲等 100 万+ 企业已在用 OpenAI 服务
