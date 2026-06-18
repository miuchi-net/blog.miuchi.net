import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const sourceDir = new URL("../src/", import.meta.url);
const distDir = new URL("../dist/", import.meta.url);
const data = JSON.parse(await readFile(new URL("data/posts.json", sourceDir), "utf8"));

await mkdir(distDir, { recursive: true });
await cp(new URL("styles.css", sourceDir), new URL("styles.css", distDir));
await writeFile(new URL(".nojekyll", distDir), "");
await writeFile(new URL("index.html", distDir), renderPage(data));

console.log(`Built ${data.posts.length} posts into ${distDir.pathname}`);

function renderPage({ posts }) {
  const sortedPosts = [...posts].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>blog.miuchi.net</title>
    <meta name="description" content="fuku.day/blog、blog.momee.mt、abap34's blog の最新記事をまとめたブログポータル">
    <link rel="stylesheet" href="./styles.css">
  </head>
  <body>
    <header class="site-header">
      <h1>blog.miuchi.net</h1>
    </header>
    <main>
      <div class="post-grid">
        ${sortedPosts.map(renderPostCard).join("")}
      </div>
    </main>
  </body>
</html>
`;
}

function renderPostCard(post) {
  const dateLabel = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(post.publishedAt));
  const image = post.thumbnail
    ? `<img src="${escapeAttribute(post.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="thumbnail-fallback" aria-hidden="true">${escapeHtml(initials(post.sourceTitle))}</div>`;

  return `
    <article class="post-card">
      <a class="thumbnail-link" href="${escapeAttribute(post.link)}">
        ${image}
      </a>
      <div class="post-body">
        <div class="post-meta">
          <span>${escapeHtml(post.sourceTitle)}</span>
          <time datetime="${escapeAttribute(post.publishedAt)}">${escapeHtml(dateLabel)}</time>
        </div>
        <h3><a href="${escapeAttribute(post.link)}">${escapeHtml(post.title)}</a></h3>
        <p>${escapeHtml(post.description)}</p>
      </div>
    </article>
  `;
}

function initials(value) {
  return value
    .split(/[\s./'-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.at(0)?.toUpperCase() || "")
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
