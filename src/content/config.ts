import { defineCollection, z } from "astro:content";

const post = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    image: z.string().optional(),
    date: z.coerce.date().optional(),
    pubDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    issue: z.number().optional(),
  }).refine((data) => data.date || data.pubDate, {
    message: "文章必须有 date 或 pubDate",
  }).transform((data) => ({ ...data, date: data.date ?? data.pubDate })),
});

export const collections = { post };
