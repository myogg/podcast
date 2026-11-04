---
title: "APKPure 平台 Telegram 官方版遭植入间谍后门"
date: 2026-05-25 08:00
description: "APKPure 分发的 Telegram 12.6.5 被篡改打包，植入窃密框架，可窃取聊天记录、相册、定位等隐私数据并外传。"
tags: ["安全", "隐私"]
---

APKPure 上的 Telegram 官方版被植入间谍后门

从 APKPure 下载的 Telegram 12.6.5 被重新签名打包，注入了名为 DataCollector 的间谍框架（classes3.dex，3000+行代码）。

后门可窃取：全部聊天记录（含历史消息）、通讯录、手机相册、文档文件、GPS 定位、SIM 卡信息。数据经 AES-GCM 加密后上传至 C2 服务器 38.190.225.166。
