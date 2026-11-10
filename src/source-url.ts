import type { Env } from "./types";

const DEFAULT_SOURCE_HOSTS = ["134688.xyz", "www.134688.xyz"];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

export function allowedSourceHosts(env: Env): Set<string> {
  const configured = env.ALLOWED_SOURCE_HOSTS
    ?.split(",")
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  return new Set(configured?.length ? configured : DEFAULT_SOURCE_HOSTS);
}

export function validateSourceUrl(input: string, env: Env): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Source URL is invalid");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    !allowedSourceHosts(env).has(hostname) ||
    Boolean(url.username || url.password) ||
    Boolean(url.port && url.port !== "443")
  ) {
    throw new Error(`Source URL is not allowed: ${url.origin}`);
  }
  return url.toString();
}

export async function fetchSourceResponse(
  input: string,
  env: Env,
  init: RequestInit = {},
): Promise<Response> {
  let currentUrl = validateSourceUrl(input, env);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error(`Source returned redirect ${response.status} without Location`);
    if (redirects === MAX_REDIRECTS) throw new Error("Source exceeded the redirect limit");

    currentUrl = validateSourceUrl(new URL(location, currentUrl).toString(), env);
  }

  throw new Error("Source redirect processing failed");
}
