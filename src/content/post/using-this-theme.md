---
title: Using This Theme
date: 2020-02-15 08:00
description: How the Hexo theme maps onto this Astro project, and where to customise things.
tags:
  - docs
---

This project is an Astro port of the `t9t-blog-hexo` Hexo theme. The original
EJS partials map onto Astro components:

| Hexo | Astro |
| --- | --- |
| `layout/layout.ejs` + `_partial/head.ejs` + `_partial/footer.ejs` | `src/layouts/BaseLayout.astro` |
| `_partial/header.ejs` | `src/components/Header.astro` |
| `_partial/header-post.ejs` | `src/components/PostHeader.astro` |
| `_partial/menu.ejs` | `src/components/Menu.astro` |
| `_partial/article-excerpt.ejs` | `src/components/PostCard.astro` |
| `layout/index.ejs` | `src/pages/index.astro` |
| `layout/post.ejs` | `src/pages/[...slug].astro` |

## Configuration

Site-wide options live in `src/config.ts`: title, subtitle, description,
author, menu, and the giscus / Google Analytics settings (empty by default, so
both integrations are **off** until you fill them in).

## Content

Posts are markdown files in `src/content/blog/`. Frontmatter is validated in
`src/content.config.ts`, so a missing `title` or `date` fails the build with a
clear error.

## Styling

The three original stylesheets are reused verbatim and imported by
`BaseLayout.astro`:

- `src/styles/bulma.css` — layout framework
- `src/styles/blog.css` — GitHub markdown styles
- `src/styles/index.css` — theme tweaks
