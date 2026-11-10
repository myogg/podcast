const list = document.querySelector("#episode-list");
const empty = document.querySelector("#empty-state");
const error = document.querySelector("#error-state");
const count = document.querySelector("#episode-count");
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
  const main = element("div", "episode-main");
  const date = element("p", "episode-date", formatDate(episode.publishedAt));
  const title = element("h3", "episode-title", episode.title);
  const summary = element("p", "episode-summary", episode.summary || "文章原文朗读");
  const player = document.createElement("audio");
  player.className = "episode-player";
  player.controls = true;
  player.preload = "none";
  player.src = episode.audioUrl;
  player.setAttribute("aria-label", `播放：${episode.title}`);

  main.append(date, title, summary, player);

  const actions = element("div", "episode-actions");
  const source = element("a", "", "阅读原文 ↗");
  source.href = episode.sourceUrl;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  const download = element("a", "", "下载 MP3 ↓");
  download.href = episode.audioUrl;
  download.download = `${episode.slug}.mp3`;
  actions.append(source, download);

  card.append(number, main, actions);
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

loadEpisodes();
