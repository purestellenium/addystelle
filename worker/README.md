# AITA ticker — Reddit proxy Worker

The in-game ticker shows top posts from r/AmItheAsshole. The game (a static site)
can't fetch them straight from Reddit for two reasons:

1. **CORS** — Reddit sends no `Access-Control-Allow-Origin` header, so a browser
   `fetch()` is not allowed to read the response.
2. **Blocking** — Reddit 403/429s browser-like User-Agents and the JSON API.

This tiny **Cloudflare Worker** fixes both. It runs server-side, fetches Reddit's
public **RSS feed** (which _is_ served to a plain, non-browser User-Agent — no API
app, OAuth, or secret required), parses the titles, and returns
`{ "titles": [...] }` with permissive CORS. The game fetches from the Worker.

You deploy this once. It's free (Cloudflare's free tier covers it easily) and,
after setup, refreshes on its own.

---

## What you need

- **Node.js + npm** — you already have these (the game uses them).
- **A Cloudflare account** — free. Sign up at <https://dash.cloudflare.com/sign-up>
  if you don't have one. No credit card needed for the free Workers tier.

---

## Step 1 — Set your User-Agent

Open `worker/reddit-aita.js` and edit the `USER_AGENT` line near the top. Put in
your own Reddit username:

```js
const USER_AGENT = "addystelle-aita-ticker/1.0 (by /u/your_actual_username)";
```

Reddit rate-limits generic/blank User-Agents harder, and a unique, identifying
one is what they ask for. Any string works, but include a username.

---

## Step 2 — Install Wrangler

Wrangler is Cloudflare's command-line tool for Workers. Install it globally:

```sh
npm install -g wrangler
```

Verify it installed:

```sh
wrangler --version
```

(If `npm install -g` gives a permissions error, either use a Node version manager
like `nvm`, or run the commands below with `npx wrangler ...` instead of
`wrangler ...` — `npx` downloads it on the fly.)

---

## Step 3 — Log in to Cloudflare

```sh
wrangler login
```

This opens your browser and asks you to authorize Wrangler for your Cloudflare
account. Click **Allow**, then return to the terminal — it should say you're
logged in.

---

## Step 4 — Deploy the Worker

From **inside the `worker/` folder** (important — that's where `wrangler.toml`
lives):

```sh
cd worker
wrangler deploy
```

- On your **first ever** deploy, Cloudflare may ask you to register a free
  `*.workers.dev` subdomain (e.g. `yourname.workers.dev`). Pick one — it's a
  one-time thing.
- When it finishes, Wrangler prints the deployed URL, something like:

  ```
  https://addystelle-aita.yourname.workers.dev
  ```

  **Copy that URL** — you need it in Step 6.

---

## Step 5 — Test the Worker

Paste your Worker URL into a browser, or curl it:

```sh
curl https://addystelle-aita.yourname.workers.dev
```

You should get JSON back:

```json
{"titles":["AITA for ...","AITAH for ...", ...]}
```

- If you see a list of titles → it works. Continue.
- If you see `{"titles":[],"error":"feed 403"}` (or `429`) → Reddit is blocking
  Cloudflare's IP for that request. This is uncommon for the RSS feed, but if it
  happens, see **Troubleshooting** below.

---

## Step 6 — Point the game at the Worker

Open `src/main.js` and find this line (near the AITA ticker section at the
bottom):

```js
const AITA_ENDPOINT = "https://REPLACE-WITH-YOUR-WORKER.workers.dev";
```

Replace it with your actual Worker URL from Step 4:

```js
const AITA_ENDPOINT = "https://addystelle-aita.yourname.workers.dev";
```

Save, then run the game (`npm run dev`). The ticker should now show live AITA
titles instead of the placeholder ones.

That's it — you're done. The Worker keeps running; the game will pull fresh
titles automatically.

---

## Updating the Worker later

If you change `reddit-aita.js` (or want to redeploy for any reason):

```sh
cd worker
wrangler deploy
```

Same URL, new code.

To watch live logs while debugging:

```sh
wrangler tail
```

---

## How it behaves

- **Caching:** responses are edge-cached ~5 minutes (`CACHE_SECONDS` in
  `reddit-aita.js`), so Reddit gets hit at most once per 5 min per Cloudflare
  location — well within any rate limit.
- **Failure is invisible:** if Reddit is unreachable or returns nothing, the
  Worker returns `{ "titles": [] }`, and the game just keeps showing its built-in
  `FALLBACK_TITLES`. The ticker never errors or goes blank.

---

## Troubleshooting

- **`wrangler: command not found`** — the global install didn't land on your
  PATH. Use `npx wrangler <cmd>` instead (e.g. `npx wrangler deploy`).
- **`wrangler deploy` can't find config** — make sure you `cd worker` first;
  `wrangler.toml` must be in the current directory.
- **Worker returns `{"titles":[],"error":"feed 403"}` or `429`** — Reddit is
  throttling/blocking that Cloudflare edge. Try again in a minute (429 is
  temporary). If it's a persistent 403, Reddit is blocking Cloudflare IPs for
  you; the reliable fallback is a **build-time bake** — a local script that
  fetches the same RSS on your own machine and bundles the titles into the game
  as JSON (no runtime server, still works on Itch.io, refreshes when you
  rebuild). Ask and I'll wire it up.
- **Game still shows placeholders** — double-check `AITA_ENDPOINT` in
  `src/main.js` exactly matches the URL from `wrangler deploy` (no trailing
  slash needed), and that curling the URL returns real titles.
