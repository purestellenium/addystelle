// Cloudflare Worker: fetches r/AmItheAsshole's top posts from Reddit's public
// RSS feed (no API app / OAuth / secret needed — Reddit serves the .rss feed to
// a plain, non-browser User-Agent) and returns { titles: [...] } with CORS.
// Response is edge-cached ~5 min.
//
// Put your own Reddit username in USER_AGENT — Reddit rate-limits generic ones
// harder, and browser-like User-Agents get 403/429'd.

const USER_AGENT = "addystelle-aita-ticker/1.0 (by /u/krystai11)";
const FEED_URL =
  "https://www.reddit.com/r/AmItheAsshole/top.rss?t=day&limit=15";
const CACHE_KEY = "https://aita-cache.internal/titles";
const CACHE_SECONDS = 300;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const cache = caches.default;
    const cacheKey = new Request(CACHE_KEY);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    try {
      const res = await fetch(FEED_URL, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) throw new Error(`feed ${res.status}`);
      const xml = await res.text();
      const titles = parseTitles(xml);
      if (titles.length === 0) throw new Error("no titles parsed");

      const response = jsonResponse({ titles }, CACHE_SECONDS);
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      return jsonResponse({ titles: [], error: String(err) }, 0);
    }
  },
};

function parseTitles(xml) {
  return xml
    .split("<entry>")
    .slice(1)
    .map((entry) => {
      const m = entry.match(/<title>([\s\S]*?)<\/title>/);
      return m ? decodeEntities(m[1].trim()) : null;
    })
    .filter(Boolean);
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function jsonResponse(obj, maxAge) {
  return new Response(JSON.stringify(obj), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      ...CORS,
    },
  });
}
