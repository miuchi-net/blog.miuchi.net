import { mkdir, writeFile } from "node:fs/promises";

const FEEDS = [
  {
    id: "fuku-day",
    title: "fuku.day/blog",
    url: "https://fuku.day/blog/rss.xml",
  },
  {
    id: "momee-mt",
    title: "blog.momee.mt",
    url: "https://blog.momee.mt/rss.xml",
  },
  {
    id: "abap34",
    title: "abap34's blog",
    url: "https://www.abap34.com/rss.xml",
  },
];

const DEFAULT_TIMEOUT_MS = 15_000;
const OUTPUT_PATH = new URL("../src/data/posts.json", import.meta.url);

async function main() {
  const feedResults = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        return await fetchFeed(feed);
      } catch (error) {
        console.warn(`Failed to fetch ${feed.url}: ${error.message}`);
        return {
          ...feed,
          fetchedAt: new Date().toISOString(),
          items: [],
          error: error.message,
        };
      }
    }),
  );

  const posts = feedResults
    .flatMap((feed) => feed.items)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  if (posts.length === 0) {
    throw new Error("No posts were fetched from any RSS source.");
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sources: feedResults.map(({ id, title, url, fetchedAt, error, items }) => ({
      id,
      title,
      url,
      fetchedAt,
      error,
      count: items.length,
    })),
    posts,
  };

  await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Wrote ${posts.length} posts to ${OUTPUT_PATH.pathname}`);
}

async function fetchFeed(feed) {
  const xml = await fetchText(feed.url);
  const channelTitle = textFromHtml(getTag(xml, "title")) || feed.title;
  const channelLink = textFromHtml(getTag(xml, "link")) || new URL(feed.url).origin;
  const itemBlocks = matchBlocks(xml, "item");

  const items = await Promise.all(
    itemBlocks.map(async (itemXml) => {
      const link = absolutize(
        textFromHtml(getTag(itemXml, "link")) ||
          textFromHtml(getTag(itemXml, "guid")),
        channelLink,
      );
      const rawDescription =
        getTag(itemXml, "description") ||
        getTag(itemXml, "summary") ||
        getTag(itemXml, "content:encoded");
      const rawContent = getTag(itemXml, "content:encoded") || rawDescription;
      const inlineThumbnail = extractInlineThumbnail(itemXml, rawDescription, rawContent, link);
      const thumbnail = inlineThumbnail || (link ? await fetchOpenGraphImage(link) : "");

      return {
        id: stableId(feed.id, link || getTag(itemXml, "guid") || getTag(itemXml, "title")),
        sourceId: feed.id,
        sourceTitle: channelTitle,
        sourceUrl: channelLink,
        feedUrl: feed.url,
        title: textFromHtml(getTag(itemXml, "title")) || "Untitled",
        link,
        description: truncate(textFromHtml(rawDescription), 180),
        publishedAt: normalizeDate(getTag(itemXml, "pubDate") || getTag(itemXml, "updated")),
        thumbnail,
      };
    }),
  );

  return {
    ...feed,
    title: channelTitle,
    url: feed.url,
    fetchedAt: new Date().toISOString(),
    items,
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "blog.miuchi.net portal generator",
      accept: "application/rss+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5",
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return await response.text();
}

async function fetchOpenGraphImage(url) {
  try {
    const html = await fetchText(url);
    const match =
      html.match(/<meta\s+[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i) ||
      html.match(/<meta\s+[^>]*content=["'][^"']+["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i);
    const content = match?.[0]?.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    return content ? absolutize(decodeEntities(content), url) : "";
  } catch (error) {
    console.warn(`Failed to fetch OGP image for ${url}: ${error.message}`);
    return "";
  }
}

function matchBlocks(xml, tagName) {
  return [...xml.matchAll(new RegExp(`<${escapeRegExp(tagName)}\\b[\\s\\S]*?<\\/${escapeRegExp(tagName)}>`, "gi"))].map(
    ([block]) => block,
  );
}

function getTag(xml, tagName) {
  if (!xml) {
    return "";
  }

  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`, "i");
  return stripCdata(xml.match(pattern)?.[1] || "");
}

function getAttributeFromTag(xml, tagName, attributeName, requiredTypePrefix = "") {
  const tags = [...xml.matchAll(new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>`, "gi"))].map(([tag]) => tag);

  for (const tag of tags) {
    const type = tag.match(/\btype=["']([^"']+)["']/i)?.[1] || "";
    if (requiredTypePrefix && !type.toLowerCase().startsWith(requiredTypePrefix)) {
      continue;
    }

    const value = tag.match(new RegExp(`\\b${escapeRegExp(attributeName)}=["']([^"']+)["']`, "i"))?.[1];
    if (value) {
      return decodeEntities(value);
    }
  }

  return "";
}

function extractInlineThumbnail(itemXml, rawDescription, rawContent, baseUrl) {
  const direct =
    getAttributeFromTag(itemXml, "media:thumbnail", "url") ||
    getAttributeFromTag(itemXml, "media:content", "url", "image/") ||
    getAttributeFromTag(itemXml, "enclosure", "url", "image/");
  if (direct) {
    return absolutize(direct, baseUrl);
  }

  const html = `${rawDescription || ""}\n${rawContent || ""}`;
  const image = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i)?.[1];
  return image ? absolutize(decodeEntities(image), baseUrl) : "";
}

function textFromHtml(value) {
  return decodeEntities(stripTags(value || "")).replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function stripCdata(value) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
      if (code.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }
      return named[code.toLowerCase()] || entity;
    })
    .trim();
}

function truncate(value, length) {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length - 1).trim()}…`;
}

function normalizeDate(value) {
  const date = new Date(textFromHtml(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function absolutize(value, baseUrl) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function stableId(sourceId, value) {
  const input = `${sourceId}:${value}`;
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  return `${sourceId}-${hash.toString(36)}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

await main();
