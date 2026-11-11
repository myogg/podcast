import { fetchSourceResponse, validateSourceUrl } from "./source-url";
import type { Env } from "./types";

// 正文容器按优先级回退：主题改版后即使 #article-content 消失，
// 仍能从语义标签 article / main 取到正文。
const CONTENT_SELECTORS = ["#article-content", "article", "main"] as const;
const BLOCK_TAGS = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre",
];
const OG_IMAGE_SELECTOR = 'meta[property="og:image"]';
const MAX_ARTICLE_HTML_BYTES = 5_000_000;
// 清理项与容器无关，避免回退到 article / main 时把脚本和导航混进正文。
const STRIP_SELECTOR = "script, style, svg, .not-prose, #waline, nav";

// 三个候选容器的块级标签合并成一个选择器：单个 handler 只注册一次 onEndTag，
// 避免嵌套容器对同一元素重复挂载结束标签回调。
const BLOCK_SELECTOR = CONTENT_SELECTORS.flatMap((container) =>
  BLOCK_TAGS.map((tag) => `${container} ${tag}`),
).join(", ");

export interface ArticleContent {
  text: string;
  imageUrl: string | null;
}

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

function resolveImageUrl(value: string | null, baseUrl: string): string | null {
  const candidate = value?.trim().split(",")[0]?.trim().split(/\s+/)[0];
  if (!candidate) return null;
  try {
    const url = new URL(candidate, baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function firstImageCandidate(element: Element): string | null {
  return (
    element.getAttribute("data-src") ||
    element.getAttribute("data-original") ||
    element.getAttribute("data-lazy-src") ||
    element.getAttribute("src") ||
    element.getAttribute("srcset")
  );
}

interface ArticleBucket {
  textParts: string[];
  image: string | null;
}

function normalizeText(parts: string[]): string {
  return parts
    .join("")
    .replace(/\r/g, "\n")
    .replace(/[\u00a0\u200b\ufeff]/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

export async function fetchArticleContent(articleUrl: string, env: Env): Promise<ArticleContent> {
  const safeUrl = validateSourceUrl(articleUrl, env);
  const response = await fetchSourceResponse(safeUrl, env, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "User-Agent": "134688-Blogcast/1.0 (+https://134688.xyz)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Article request failed with HTTP ${response.status}`);

  let openGraphImage: string | null = null;
  // 一次流式解析同时收集三个候选容器，最后按优先级取第一个非空结果；
  // HTMLRewriter 无法回退重读响应体，所以必须并行收集而非逐个尝试。
  const buckets: ArticleBucket[] = CONTENT_SELECTORS.map(() => ({
    textParts: [],
    image: null,
  }));

  const boundedResponse = limitResponseBody(response, MAX_ARTICLE_HTML_BYTES);
  let rewriter = new HTMLRewriter()
    .on(STRIP_SELECTOR, {
      element(element) {
        element.remove();
      },
    })
    .on(OG_IMAGE_SELECTOR, {
      element(element) {
        openGraphImage ||= resolveImageUrl(element.getAttribute("content"), safeUrl);
      },
    })
    .on(BLOCK_SELECTOR, {
      element(element) {
        // 所有候选容器共用同一批分段点；normalizeText 会合并多余空行，
        // 因此给未命中的桶多塞换行没有副作用。
        element.onEndTag(() => {
          for (const bucket of buckets) bucket.textParts.push("\n\n");
        });
      },
    });

  CONTENT_SELECTORS.forEach((selector, index) => {
    const bucket = buckets[index];
    rewriter = rewriter
      .on(`${selector} img`, {
        element(element) {
          bucket.image ||= resolveImageUrl(firstImageCandidate(element), safeUrl);
        },
      })
      .on(selector, {
        text(text) {
          if (text.text) bucket.textParts.push(text.text);
        },
      });
  });

  const transformed = rewriter.transform(boundedResponse);

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

  const normalized = buckets.map((bucket) => normalizeText(bucket.textParts));
  const chosen = normalized.findIndex((text) => text.length > 0);
  if (chosen === -1) {
    throw new Error(`Could not extract article text from ${CONTENT_SELECTORS.join(", ")}`);
  }
  return {
    text: normalized[chosen],
    imageUrl: buckets[chosen].image || openGraphImage,
  };
}

export async function fetchArticleText(articleUrl: string, env: Env): Promise<string> {
  return (await fetchArticleContent(articleUrl, env)).text;
}
