import type { Env } from "./types";

// The protocol details and v2 token format were studied from yy4382/read-aloud;
// this is a standalone Worker-native client, not a call to that project's API.
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const DEFAULT_EDGE_VERSION = "143.0.3650.75";
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_CHUNK_LENGTH = 300;
const MIMO_ENDPOINT = "https://api.xiaomimimo.com/v1/chat/completions";
const MIMO_MODEL = "mimo-v2.5-tts";
const DEFAULT_MIMO_VOICE = "白桦";
const MIMO_CHUNK_LENGTH = 800;
const MIMO_RESPONSE_TIMEOUT_MS = 90_000;
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const TTS_RESPONSE_TIMEOUT_MS = 45_000;
const AUDIO_SEPARATOR = new TextEncoder().encode("Path:audio\r\n");
const WINDOWS_EPOCH_SECONDS = 11_644_473_600;
const TOKEN_WINDOW_SECONDS = 300;
const FILETIME_TICKS_PER_SECOND = 10_000_000n;

const SWAP_X_FACTORS = [0xef0569fb, 0x76f50f34, 0xc3efea97] as const;
const SWAP_Y_FACTORS = [0xc31713db, 0x1881ce3c, 0x35bd1ec9] as const;
const STATE_X_FACTORS = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83] as const;
const STATE_Y_FACTORS = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69] as const;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function rotate16(value: number): number {
  return (value << 16) | (value >>> 16);
}

function swapMix(word: number, key: number, factors: readonly number[]): number {
  const [pre, mid, post] = factors;
  const t = rotate16((Math.imul(rotate16(word), pre) + Math.imul(word, key)) | 0);
  const q = Math.imul(t, mid);
  return (Math.imul(rotate16(q), post) + q) | 0;
}

function stateMix(value: number, key: number, factors: readonly number[]): number {
  let state = Math.imul(value, key);
  for (const factor of factors) state = Math.imul(rotate16(state), factor);
  return state;
}

function cs64Digest(data: Uint8Array, digest: Uint8Array): Uint8Array {
  const digestView = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const keyA = digestView.getUint32(0, true) | 1;
  const keyB = digestView.getUint32(4, true) | 1;
  const padded = new Uint8Array(Math.ceil(data.length / 8) * 8);
  padded.set(data);
  const words = new DataView(padded.buffer);
  let swapSum = 0;
  let swapLast = 0;
  let state = 0;
  let sum = 0;

  for (let offset = 0; offset < padded.length; offset += 8) {
    const x = words.getUint32(offset, true);
    const y = words.getUint32(offset + 4, true);
    const swapX = swapMix(x, keyA, SWAP_X_FACTORS);
    swapLast = swapMix(y, keyB, SWAP_Y_FACTORS);
    swapSum = (swapSum + swapX + swapLast) | 0;
    state = stateMix((state + x) | 0, keyA, STATE_X_FACTORS);
    sum = (sum + state) | 0;
    state = stateMix((state + y) | 0, keyB, STATE_Y_FACTORS);
    sum = (sum + state) | 0;
  }

  const result = new Uint8Array(8);
  const view = new DataView(result.buffer);
  view.setUint32(0, swapLast ^ state, true);
  view.setUint32(4, swapSum ^ sum, true);
  return result;
}

async function generateSecMsGec(now = Date.now(), trustedToken = TRUSTED_CLIENT_TOKEN): Promise<string> {
  const seconds = Math.floor(now / 1000) + WINDOWS_EPOCH_SECONDS;
  const ticks = BigInt(seconds - (seconds % TOKEN_WINDOW_SECONDS)) * FILETIME_TICKS_PER_SECOND;
  const data = new TextEncoder().encode(
    `Copyright (C) Microsoft Corporation. All rights reserved.${ticks}${trustedToken}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return `${hex(cs64Digest(data, digest))}-${hex(digest)}`;
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

function edgeVersion(env: Env): string {
  const version = (env.EDGE_CHROMIUM_VERSION || DEFAULT_EDGE_VERSION).trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("EDGE_CHROMIUM_VERSION must be a four-part Chromium version");
  }
  return version;
}

async function connectEdgeTts(env: Env): Promise<WebSocket> {
  const version = edgeVersion(env);
  const major = version.split(".")[0];
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`;
  const connectionId = crypto.randomUUID().replaceAll("-", "").toLowerCase();
  const url = new URL("wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1");
  url.searchParams.set("TrustedClientToken", TRUSTED_CLIENT_TOKEN);
  url.searchParams.set("Sec-MS-GEC", await generateSecMsGec());
  url.searchParams.set("Sec-MS-GEC-Version", `2-${version}`);
  url.searchParams.set("ConnectionId", connectionId);

  // Workers open an outbound WebSocket by using fetch() with Upgrade:websocket.
  const response = await fetch(url.toString().replace(/^wss:/, "https:"), {
    headers: {
      Upgrade: "websocket",
      "User-Agent": userAgent,
      "Accept-Language": "en-US,en;q=0.9",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      Cookie: `muid=${randomHex(16)};`,
    },
    signal: AbortSignal.timeout(20_000),
  });

  const socket = response.webSocket;
  if (!socket) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `Microsoft TTS WebSocket upgrade rejected (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  socket.accept();
  return socket;
}

function parseRequestId(header: string): string | null {
  return header.match(/(?:^|\r\n)X-RequestId:([a-f0-9-]+)/i)?.[1]?.toLowerCase() ?? null;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return combined;
}

type ActiveRequest = {
  id: string;
  parts: Uint8Array[];
  timer: ReturnType<typeof setTimeout>;
  resolve: (audio: Uint8Array) => void;
  reject: (error: Error) => void;
};

class EdgeTtsSession {
  private active: ActiveRequest | null = null;

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.onMessage(event.data));
    socket.addEventListener("close", (event) => {
      this.rejectActive(new Error(`Microsoft TTS WebSocket closed (${event.code})`));
    });
    socket.addEventListener("error", () => {
      this.rejectActive(new Error("Microsoft TTS WebSocket connection error"));
    });
  }

  close(): void {
    try {
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close(1000, "episode complete");
      }
    } catch {
      // The socket may already have closed during error handling.
    }
  }

  async synthesize(ssml: string): Promise<Uint8Array> {
    if (this.active) throw new Error("TTS session already has an active request");
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("TTS WebSocket is not open");

    const requestId = crypto.randomUUID().replaceAll("-", "").toLowerCase();
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.active?.id === requestId) {
          this.active = null;
          reject(new Error(`Microsoft TTS response timed out after ${TTS_RESPONSE_TIMEOUT_MS} ms`));
          this.close();
        }
      }, TTS_RESPONSE_TIMEOUT_MS);
      this.active = { id: requestId, parts: [], timer, resolve, reject };

      try {
        const config = {
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: "false",
                  wordBoundaryEnabled: "false",
                },
                outputFormat: OUTPUT_FORMAT,
              },
            },
          },
        };
        this.socket.send(
          `X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}`,
        );
        this.socket.send(
          `X-Timestamp:${new Date().toString()}\r\nX-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`,
        );
      } catch (error) {
        this.rejectActive(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private onMessage(data: string | ArrayBuffer): void {
    const active = this.active;
    if (!active) return;

    if (typeof data === "string") {
      const requestId = parseRequestId(data);
      if (requestId && requestId !== active.id) return;
      if (data.includes("Path:error")) {
        this.rejectActive(new Error(`Microsoft TTS returned an error: ${data.slice(-300)}`));
      } else if (data.includes("Path:turn.end")) {
        const audio = concat(active.parts);
        if (!audio.byteLength) this.rejectActive(new Error("Microsoft TTS returned no audio data"));
        else this.resolveActive(audio);
      }
      return;
    }

    const bytes = new Uint8Array(data);
    const separatorIndex = findBytes(bytes, AUDIO_SEPARATOR);
    if (separatorIndex < 2) return;
    const headerEnd = separatorIndex + AUDIO_SEPARATOR.byteLength;
    const header = new TextDecoder().decode(bytes.subarray(2, headerEnd));
    const requestId = parseRequestId(header);
    if (requestId && requestId !== active.id) return;
    active.parts.push(bytes.subarray(headerEnd));
  }

  private resolveActive(audio: Uint8Array): void {
    const active = this.active;
    if (!active) return;
    clearTimeout(active.timer);
    this.active = null;
    active.resolve(audio);
  }

  private rejectActive(error: Error): void {
    const active = this.active;
    if (!active) return;
    clearTimeout(active.timer);
    this.active = null;
    active.reject(error);
  }
}

function splitText(text: string, maxLength = DEFAULT_CHUNK_LENGTH): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  const separators = ["。", "！", "？", "；", "\n", "，", "、"];

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength);
    let cutAt = -1;
    for (const separator of separators) cutAt = Math.max(cutAt, window.lastIndexOf(separator));
    const cut = cutAt >= Math.floor(maxLength * 0.55) ? cutAt + 1 : maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSsml(text: string, voice: string, rateSetting: string | undefined): string {
  if (!/^[A-Za-z0-9-]+$/.test(voice)) throw new Error("TTS_VOICE contains unsupported characters");
  const locale = voice.match(/^[a-z]{2}-[A-Z]{2}/)?.[0] || "zh-CN";
  const rate = rateSetting && rateSetting !== "default" ? rateSetting : undefined;
  if (rate && !/^[+-]?\d+(?:\.\d+)?%$/.test(rate)) {
    throw new Error("TTS_RATE must be 'default' or a percentage such as '+0%'");
  }
  const safeText = escapeXml(text);
  const content = rate ? `<prosody rate="${rate}">${safeText}</prosody>` : safeText;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${voice}">${content}</voice></speak>`;
}

function stripMp3Tags(bytes: Uint8Array): Uint8Array {
  let start = 0;
  let end = bytes.length;
  if (end > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    start = Math.min(10 + size + ((bytes[5] & 0x10) ? 10 : 0), end);
  }
  if (end - start >= 128 && bytes[end - 128] === 0x54 && bytes[end - 127] === 0x41 && bytes[end - 126] === 0x47) {
    end -= 128;
  }
  return bytes.subarray(start, end);
}

function synthesizeWithEdgeTts(text: string, env: Env): ReadableStream<Uint8Array> {
  const chunks = splitText(text);
  if (!chunks.length) throw new Error("No article text to synthesize");
  const voice = env.TTS_VOICE || DEFAULT_VOICE;
  const rate = env.TTS_RATE || "default";
  let session: EdgeTtsSession | null = null;
  let index = 0;
  let totalBytes = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (index >= chunks.length) {
          session?.close();
          if (!totalBytes) throw new Error("TTS returned an empty audio file");
          controller.close();
          return;
        }
        if (!session) session = new EdgeTtsSession(await connectEdgeTts(env));
        const ssml = buildSsml(chunks[index], voice, rate);
        const audio = stripMp3Tags(await session.synthesize(ssml));
        if (!audio.byteLength) throw new Error(`TTS segment ${index + 1} contained no MP3 data`);
        totalBytes += audio.byteLength;
        index += 1;
        controller.enqueue(audio);
      } catch (error) {
        session?.close();
        controller.error(error);
      }
    },
    cancel() {
      session?.close();
    },
  });
}


type MiMoResponse = {
  choices?: Array<{
    message?: {
      audio?: {
        data?: string;
      };
    };
  }>;
};

function decodeBase64Audio(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

// MPEG Layer III 比特率表（kbps），index 0 与 15 为保留值。
const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
// versionBits: 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
const MPEG_SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

type Mp3Frame = {
  frameLength: number;
  samplesPerFrame: number;
  sampleRate: number;
};

// 解析一个 MPEG Layer III 帧头。Edge TTS 与 MiMo 输出的都是 Layer III，
// 其它 layer / 保留版本返回 null，让扫描器逐字节重新同步。
function readMp3Frame(bytes: Uint8Array, offset: number): Mp3Frame | null {
  if (offset + 4 > bytes.length) return null;
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  if (versionBits === 1 || layerBits !== 1) return null;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

  const sampleRate = MPEG_SAMPLE_RATES[versionBits]?.[sampleRateIndex];
  const bitrateKbps = (versionBits === 3 ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES)[bitrateIndex];
  if (!sampleRate || !bitrateKbps) return null;

  const padding = (b2 >> 1) & 0x01;
  const mpeg1 = versionBits === 3;
  const frameLength =
    Math.floor(((mpeg1 ? 144 : 72) * bitrateKbps * 1000) / sampleRate) + padding;
  if (frameLength < 4) return null;

  return {
    frameLength,
    samplesPerFrame: mpeg1 ? 1152 : 576,
    sampleRate,
  };
}

// 逐帧累加时长，不采信拼接后残留在第一段的 Xing/Info 头。
// 多段 MP3 直接串接时，首个头部里的帧数只覆盖该段，播放器据此显示的总时长
// 会明显偏短；这里按帧头重算真实时长，结果写入 D1 供 <itunes:duration> 使用。
export function measureMp3DurationSeconds(bytes: Uint8Array): number {
  let offset = 0;
  let seconds = 0;
  let frames = 0;

  while (offset + 4 <= bytes.length) {
    const frame = readMp3Frame(bytes, offset);
    if (frame && offset + frame.frameLength <= bytes.length) {
      seconds += frame.samplesPerFrame / frame.sampleRate;
      frames += 1;
      offset += frame.frameLength;
    } else {
      // 段边界、ID3 残留或噪声：逐字节找回下一个帧同步。
      offset += 1;
    }
  }

  return frames > 0 ? Math.max(1, Math.round(seconds)) : 0;
}

async function synthesizeMiMoChunk(
  text: string,
  apiKey: string,
  voice: string,
): Promise<Uint8Array> {
  const response = await fetch(MIMO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      model: MIMO_MODEL,
      messages: [
        {
          role: "user",
          content: "请使用自然、清晰、平稳的中文普通话朗读，语速适中，吐字清楚，适合中文播客旁白。请严格按照原文朗读，不要添加、删减或改写内容。",
        },
        {
          role: "assistant",
          content: text,
        },
      ],
      audio: {
        format: "mp3",
        voice,
      },
      stream: false,
    }),
    signal: AbortSignal.timeout(MIMO_RESPONSE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`MiMo TTS HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const result = (await response.json()) as MiMoResponse;
  const encodedAudio = result.choices?.[0]?.message?.audio?.data;
  if (!encodedAudio) throw new Error("MiMo TTS response did not contain audio data");

  const audio = stripMp3Tags(decodeBase64Audio(encodedAudio));
  if (!audio.byteLength || !looksLikeMp3(audio)) {
    throw new Error("MiMo TTS returned invalid or empty MP3 data");
  }
  return audio;
}

async function synthesizeWithMiMo(text: string, env: Env): Promise<Uint8Array[]> {
  const apiKey = env.MIMO_API_KEY?.trim();
  if (!apiKey) throw new Error("MIMO_API_KEY is not configured");

  const voice = (env.MIMO_TTS_VOICE || DEFAULT_MIMO_VOICE).trim();
  if (!/^[A-Za-z0-9_\u4e00-\u9fff-]+$/.test(voice)) {
    throw new Error("MIMO_TTS_VOICE contains unsupported characters");
  }

  const chunks = splitText(text, MIMO_CHUNK_LENGTH);
  if (!chunks.length) throw new Error("No article text to synthesize with MiMo");

  const audioParts: Uint8Array[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const part = await synthesizeMiMoChunk(chunks[index], apiKey, voice);
    audioParts.push(part);
    console.info("MiMo TTS segment generated", index + 1, "/", chunks.length, part.byteLength);
  }
  return audioParts;
}

function streamAudioParts(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(parts[index]);
      index += 1;
    },
  });
}

export type TtsProvider = "mimo" | "edge";

export interface SynthesizedArticle {
  audio: ReadableStream<Uint8Array>;
  provider: TtsProvider;
}

export async function synthesizeArticle(
  text: string,
  env: Env,
): Promise<SynthesizedArticle> {
  if (env.MIMO_API_KEY?.trim()) {
    try {
      const parts = await synthesizeWithMiMo(text, env);
      const totalBytes = parts.reduce((total, part) => total + part.byteLength, 0);
      if (totalBytes <= 0) throw new Error("MiMo TTS produced an empty article");
      console.info("MiMo TTS article generated", parts.length, "segments", totalBytes, "bytes");
      return { audio: streamAudioParts(parts), provider: "mimo" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("MiMo TTS failed; falling back to Microsoft Edge TTS", message);
    }
  } else {
    console.warn("MIMO_API_KEY is not configured; using Microsoft Edge TTS");
  }

  return { audio: synthesizeWithEdgeTts(text, env), provider: "edge" };
}

export function characterLimit(env: Env): number {
  const configured = Number(env.MAX_ARTICLE_CHARACTERS || 30_000);
  return Number.isFinite(configured) && configured >= 300
    ? Math.min(configured, 100_000)
    : 30_000;
}
