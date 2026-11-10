# 第三方参考说明

本项目的 Worker 原生 Edge TTS 握手实现参考了公开协议细节，并对照了 [`yy4382/read-aloud`](https://github.com/yy4382/read-aloud) 的 `urlHeader.ts`、`secMsGec.ts`、`synthesis.ts` 与 Cloudflare WebSocket 适配代码。检查时该仓库最新提交为 `d7cdb78`（2026-10-14）；其 `package.json` 声明许可证为 ISC，仓库未附独立 LICENSE 文件。

本项目没有把 `read-aloud` 当作外部服务调用，也没有添加它作为 npm 依赖；TTS 请求由本项目 Worker 自己直接发往微软 Read Aloud WebSocket 端点。`src/tts.ts` 中的 v2 握手/令牌代码是基于该项目公开实现的改写，并按其 ISC 声明保留以下通知：

```text
ISC License

Copyright (c) 2024-2026 yy4382/read-aloud contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

微软 Read Aloud 接口属于非官方服务端点；客户端实现许可证不等于微软服务的使用授权或可用性保证。请自行确认服务条款及适用范围。