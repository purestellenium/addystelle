// Fetches r/AmItheAsshole top titles from Reddit's public RSS feed and writes
// them to src/aita-titles.json, which the game bundles at build time.
//
// Run from a residential IP (your own machine): `npm run titles`. Reddit blocks
// cloud/datacenter IPs, so this can't run on a hosted CI/proxy — but your laptop
// is fine. Re-run it whenever you want to refresh the titles, then rebuild.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FEED_URL =
  "https://www.reddit.com/r/AmItheAsshole/top.rss?t=day&limit=25";
const USER_AGENT = "addystelle-aita-ticker/1.0 (by /u/krystai11)";
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "aita-titles.json",
);

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractText(entry) {
  const m = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/);
  if (!m) return "";
  // Content is double-escaped: unescape once to get HTML, isolate the post body
  // (between Reddit's SC_OFF/SC_ON markers), strip tags, then unescape again.
  const html = decodeEntities(m[1]);
  const body = html.match(/<!-- SC_OFF -->([\s\S]*?)<!-- SC_ON -->/);
  const inner = (body ? body[1] : "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(inner)
    .replace(/​/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePosts(xml) {
  return xml
    .split("<entry>")
    .slice(1)
    .map((entry) => {
      const t = entry.match(/<title>([\s\S]*?)<\/title>/);
      if (!t) return null;
      return { title: decodeEntities(t[1].trim()), text: extractText(entry) };
    })
    .filter((p) => p && p.title);
}

const res = await fetch(FEED_URL, { headers: { "User-Agent": USER_AGENT } });
if (!res.ok) {
  console.error(
    `Reddit returned ${res.status}. Titles NOT updated (kept the existing file).`,
  );
  process.exit(1);
}
const posts = parsePosts(await res.text());
if (posts.length === 0) {
  console.error("No posts parsed. Titles NOT updated.");
  process.exit(1);
}
writeFileSync(OUT, JSON.stringify(posts, null, 2) + "\n");
console.log(`Wrote ${posts.length} posts to src/aita-titles.json`);
