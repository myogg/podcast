import { fetchSourceResponse, validateSourceUrl } from "./source-url";
import type { Env } from "./types";

const ARTICLE_SELECTOR = "#article-content";
const MAX_ARTICLE_HTML_BYTES = 5_000_000;
const STRIP_SELECTOR = [
  "#article-content script",
  "#article-content style",
  "#article-content svg",
  "#article-content .not-prose",
  "#article-content #waline",
  "#article-content nav",
].join(", ");

function limitResponseBody(response: Response, maxBytes: number): Response {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    void response.body?.cancel();
    throw new Error(`Article HTML exceeds ${maxBytes} bytes`);
  }

  const reader = response.body?.getReader();
  if (!reader) return response;
  let total = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          controller.error(new Error(`Article HTML exceeds ${maxBytes} bytes`));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export async function fetchArticleText(articleUrl: string, env: Env): Promise<string> {
  const safeUrl = validateSourceUrl(articleUrl, env);
  const response = await fetchSourceResponse(safeUrl, env, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "User-Agent": "134688-Blogcast/1.0 (+https://134688.xyz)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Article request failed with HTTP ${response.status}`);

  const textParts: string[] = [];
  const boundedResponse = limitResponseBody(response, MAX_ARTICLE_HTML_BYTES);
  const transformed = new HTMLRewriter()
    .on(STRIP_SELECTOR, {
      element(element) {
        element.remove();
      },
    })
    .on(ARTICLE_SELECTOR, {
      text(text) {
        if (text.text) textParts.push(text.text);
      },
    })
    .transform(boundedResponse);

  const reader = transformed.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }

  const text = textParts
    .join(" ")
    .replace(/[\u00a0\u200b\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 20) {
    throw new Error(`Could not extract article text from ${ARTICLE_SELECTOR}`);
  }
  return text;
}
