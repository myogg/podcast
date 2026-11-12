const list = document.querySelector("#episode-list");
const empty = document.querySelector("#empty-state");
const error = document.querySelector("#error-state");
const count = document.querySelector("#episode-count");
const main = document.querySelector("main");
const fallbackCover = "/cover.svg";
const detailNotice = "完整文章请到博客阅读，播客这里只显示摘要。";

document.addEventListener("play", (event) => {
  const activePlayer = event.target;
  if (!(activePlayer instanceof HTMLAudioElement)) return;
  document.querySelectorAll("audio").forEach((player) => {
    if (player !== activePlayer) player.pause();
  });
}, true);

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "发布日期未知" : dateFormatter.format(date);
}

function createEpisode(episode, index) {
  const card = element("article", "episode-card");
  card.style.animationDelay = `${Math.min(index * 45, 360)}ms`;

  const number = element("div", "episode-number", String(index + 1).padStart(2, "0"));
  const content = element("div", "episode-main");
  const date = element("p", "episode-date", formatDate(episode.publishedAt));
  const title = element("h3", "episode-title");
  const titleLink = element("a", "", episode.title);
  titleLink.href = `/episode/${encodeURIComponent(episode.slug)}`;
  title.append(titleLink);
  const summary = element("p", "episode-summary", episode.description || episode.title);
  const player = document.createElement("audio");
  player.className = "episode-player";
  player.controls = true;
  player.preload = "none";
  player.src = episode.audioUrl;
  player.setAttribute("aria-label", `播放：${episode.title}`);
  content.append(date, title, summary, player);

  const actions = element("div", "episode-actions");
  const details = element("a", "", "节目详情 →");
  details.href = `/episode/${encodeURIComponent(episode.slug)}`;
  const source = element("a", "", "阅读原文 ↗");
  source.href = episode.sourceUrl;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  const download = element("a", "", "下载 MP3 ↓");
  download.href = episode.audioUrl;
  download.download = `${episode.slug}.mp3`;
  actions.append(details, source, download);

  card.append(number, content, actions);
  return card;
}

async function loadEpisodes() {
  try {
    const response = await fetch("/api/episodes", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Episode API returned ${response.status}`);
    const payload = await response.json();
    const episodes = Array.isArray(payload.episodes) ? payload.episodes : [];

    list.replaceChildren();
    count.textContent = String(episodes.length).padStart(2, "0");
    error.hidden = true;
    empty.hidden = episodes.length > 0;
    if (!episodes.length) return;

    const fragment = document.createDocumentFragment();
    episodes.forEach((episode, index) => fragment.append(createEpisode(episode, index)));
    list.append(fragment);
  } catch (cause) {
    console.error("Could not load podcast episodes", cause);
    list.replaceChildren();
    count.textContent = "—";
    empty.hidden = true;
    error.hidden = false;
  }
}

function renderDetailError(message) {
  main.replaceChildren();
  const section = element("section", "detail-error");
  const back = element("a", "detail-back", "← 返回节目列表");
  back.href = "/";
  const title = element("h1", "", "暂时无法打开这篇节目");
  const text = element("p", "", message);
  section.append(back, title, text);
  main.append(section);
}

// 详情页只显示 D1 里的摘要与音频，不加载文章全文，也不请求博客文章页。
async function loadEpisodeDetail(slug) {
  main.replaceChildren(element("p", "detail-loading", "正在打开节目…"));
  try {
    const response = await fetch(`/api/episodes/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "这集节目不存在或暂不可用。");

    const episode = payload.episode;
    if (!episode) throw new Error("节目信息暂时无法读取，请稍后再试。");
    const description = episode.description || episode.title;

    document.title = `${episode.title}｜姜一一的播客`;
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) metaDescription.content = description;

    const page = element("div", "detail-page");
    const topbar = element("div", "detail-topbar");
    const back = element("a", "detail-back", "← 返回节目列表");
    back.href = "/";
    const label = element("span", "detail-kicker", "EPISODE · AUDIO");
    topbar.append(back, label);

    const header = element("section", "detail-header");
    const coverShell = element("div", "detail-cover-shell");
    const cover = document.createElement("img");
    cover.className = "detail-cover";
    cover.src = fallbackCover;
    cover.alt = "博客播客默认封面";
    cover.loading = "eager";
    cover.decoding = "async";
    coverShell.append(cover);

    const heading = element("div", "detail-heading");
    heading.append(
      element("p", "detail-date", formatDate(episode.publishedAt)),
      element("h1", "detail-title", episode.title),
      element("p", "detail-summary", description),
      element("p", "detail-note", episode.notice || detailNotice),
    );
    const audio = document.createElement("audio");
    audio.className = "detail-player";
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = episode.audioUrl;
    audio.setAttribute("aria-label", `播放：${episode.title}`);
    audio.addEventListener("play", () => coverShell.classList.add("is-playing"));
    audio.addEventListener("pause", () => coverShell.classList.remove("is-playing"));
    audio.addEventListener("ended", () => coverShell.classList.remove("is-playing"));
    heading.append(audio);
    header.append(coverShell, heading);

    const source = element("a", "detail-source", "在博客阅读原文 ↗");
    source.href = episode.sourceUrl;
    source.target = "_blank";
    source.rel = "noopener noreferrer";

    page.append(topbar, header, source);
    main.replaceChildren(page);
  } catch (cause) {
    console.error("Could not load episode detail", cause);
    renderDetailError(cause instanceof Error ? cause.message : "请稍后再试。");
  }
}

const detailMatch = location.pathname.match(/^\/episode\/([^/]+)\/?$/);
if (detailMatch) {
  let slug = detailMatch[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // 保留原始路径段，交由 API 返回 404。
  }
  loadEpisodeDetail(slug);
} else if (list && empty && error && count) {
  loadEpisodes();
}
