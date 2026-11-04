import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve("src/content/post");
const source = process.env.ASTRO_SOURCE_DIR
  ? resolve(process.env.ASTRO_SOURCE_DIR, "src/content/post")
  : null;

if (!source || !existsSync(source)) {
  console.log("[podcast-sync] ASTRO_SOURCE_DIR not set or unavailable; keeping committed content snapshot.");
  process.exit(0);
}

await rm(target, { recursive: true, force: true });
await mkdir(resolve("src/content"), { recursive: true });
await cp(source, target, { recursive: true });
console.log(`[podcast-sync] copied blog posts from ${source}`);
