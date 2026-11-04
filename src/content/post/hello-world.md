---
title: Hello World
date: 2020-01-01 08:00
description: A first sample post that shows off the theme's markdown styling.
tags:
  - demo
---

> This is a sample post. Replace it with your own content.

Welcome to your new Astro blog. This post exists to demonstrate the markdown
styling that ships with the theme (port of the GitHub-flavored `blog.css`).

## Headings

The theme styles `h1` through `h6`, blockquotes, tables, lists, inline code and
code blocks.

## Tables

| Column | Meaning | Value |
| --- | --- | --- |
| `title` | Post title | string |
| `date` | Publish date | date |
| `tags` | Optional tags | string[] |

## Code

```js
const greeting = 'hello world';
console.log(greeting);
```

## Lists

1. Write markdown files under `src/content/blog/`.
2. Add frontmatter (`title`, `date`, optional `description`, `tags`).
3. Run `npm run dev`.

- The file name becomes the URL slug.
- Drafts (`draft: true`) are hidden from the build.

Enjoy!
