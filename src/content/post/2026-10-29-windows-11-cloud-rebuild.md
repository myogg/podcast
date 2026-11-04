---
title: "Windows 11 新增云端重建恢复功能，无需 U 盘"
date: "2026-10-29 22:57"
description: "Windows 11 推出 Cloud Rebuild 云端重建：电脑无法启动也能直接重装系统，镜像和驱动都从 Windows Update 拉取，不再需要 U 盘。"
tags: ["Windows", "技术"]
---

微软随 Windows 11 可选更新 KB5127936 推出了一个新的恢复功能：**Cloud Rebuild（云端重建）**。

过去电脑系统挂了要重装，大多得先做一个启动 U 盘，还要自己找镜像。现在不需要了：Cloud Rebuild 直接从 Windows Update 下载系统镜像和设备驱动，即使电脑已经无法启动，也能在恢复环境里完成重装。

![Windows 11 恢复环境中的 Cloud Rebuild](/images/2026/10/2026-10-29-win11-cloud-rebuild.webp)

几个要点：

- **无需 U 盘和自定义镜像**：系统镜像和驱动都从 Windows Update 在线获取
- **使用条件**：需要联网，并接通电源
- **注意**：重装会清空文件，动手前记得先备份
- **企业管理**：IT 管理员可以通过 Recovery CSP 远程发起重装

功能正在分批推送，想更快拿到的话，可以在 Windows Update 设置里打开「尽快获取最新更新」。

参考：[Windows Central 报道](https://www.windowscentral.com/microsoft/windows-11/windows-11s-new-cloud-rebuild-can-resurrect-pcs-that-wont-boot)
