# 🐸 Hoppy Toads — Tobyworld on Base

A Flappy-style arcade game themed around **Tobyworld on Base**, packaged as a
**Farcaster / Base Mini App**. The game is a single self-contained HTML5 canvas file with no build
step and **zero dependencies** — it runs fully offline. Only the global leaderboard talks to a
backend, and it degrades gracefully (if the API is down the game still plays; the board just shows
"couldn't load").

## Gameplay

- Tap / click / spacebar to **hop**. Synthesized audio — no asset files.
- Three Tobyworld relic power-ups:
  - **$TABOSHI** (green leaf) → **+1x score yield for ~7s, and it stacks** — grab another leaf
    before the first expires to compound the multiplier (x2 → x3 → x4 …). Each leaf keeps its own
    timer, so the multiplier steps back down one notch as each one runs out.
  - **$PATIENCE** (red triangle) → bankable shield, stacks to 3, absorbs one pillar hit each. Scarce.
  - **Sato** (blue swirl) → bursts collectible gold flakes (+2 each).
- Combo chains, difficulty ramp, 8 achievements, **daily challenge** (press `D` on the start
  screen — seeded, repeatable course), daily streak rewards (free starting shields), and a global
  leaderboard (all-time + daily).
- **Juice:** screen shake, relic-pickup sparkles, hop squash-and-stretch, and a milestone
  celebration every 25 points.
- **Background music** streamed from the [toadvault.xyz](https://toadvault.xyz) Tobyworld catalog
  (🔊 toggle, top-left). The game fetches the live catalog (`/data/music.json`, CORS-enabled) and
  falls back to the bundled [`public/music.json`](public/music.json); tracks shuffle and loop. Music
  starts on the first hop (autoplay policy) and the on/off choice is remembered. SFX stay audible.

## Farcaster / Base identity

When launched inside a Farcaster or Base mini-app host, the game dynamically imports the mini-app
SDK (`@farcaster/miniapp-sdk`, from a CDN — still no build step), calls `sdk.actions.ready()` to
dismiss the host splash, and uses the **verified account** as the leaderboard identity: the username
prefills and locks the name field (a ✓ badge appears top-right) and the connected wallet address (or
the `fid` fallback) is sent as the `identity` field. Outside a host it all no-ops and the classic
typed-name flow is used. The core canvas game still runs offline — only music, the SDK, and the
leaderboard touch the network, and each degrades gracefully.

## Project layout

```
hoppy-toads/
├── public/
│   ├── index.html               # the game (static, runs offline)
│   ├── icon.png / splash.png / hero.png   # placeholder art (replace with real art)
│   └── .well-known/farcaster.json         # mini-app manifest
├── api/
│   └── scores.js                # Vercel serverless leaderboard (Upstash Redis)
├── scripts/
│   ├── gen-placeholder-art.mjs  # regenerate placeholder PNGs
│   ├── set-domain.mjs           # rewrite https://APP_URL -> your real domain
│   └── static-server.mjs        # offline playtest server (no leaderboard)
├── vercel.json                  # static + cache headers
├── package.json
└── .env.example                 # Upstash credentials
```

## Run locally

**Offline (game only, no leaderboard):**

```bash
npm run serve          # http://localhost:3000  — board shows "couldn't load" (expected)
```

**Full stack (with leaderboard):**

```bash
npm install
cp .env.example .env             # fill in your Upstash REST URL + token
npm run dev                      # vercel dev → http://localhost:3000
```

You'll need a free [Upstash Redis](https://upstash.com) database. Put `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` in `.env` for local dev, and add the same two vars in the Vercel project
settings for production.

## Leaderboard API

`api/scores.js` (Vercel serverless function, Upstash Redis sorted sets):

- `GET /api/scores?mode=all|daily` → `{ mode, rows: [{name, score}] }`, top 20 desc.
- `GET /api/scores?start=1` → `{ token }` — a signed, single-use **anti-cheat run token** the client
  requests when a run begins (`token: null` if no secret is configured).
- `POST /api/scores` `{ name, score, mode, identity?, token? }` → stores best-per-name. Validates name
  (1–14 chars, `[a-z0-9]`), score (non-negative integer ≤ 100000), and rate-limits writes per IP
  (30/min).
- Boards: `lb:all` (all-time) and `lb:daily:<UTC-date>` (expires ~36h). The `identity` field
  (wallet address / Farcaster fid) is stored alongside the board for a future wallet-native board.

**Anti-cheat (signed run tokens).** When a secret is available — `HOPPY_SECRET`, or the Upstash REST
token reused automatically — the server issues an HMAC-signed token at run start and, on submit,
verifies the signature, enforces single use (nonce in Redis), and rejects scores that arrived
implausibly fast (`< 80 ms/point`). This blocks `curl`-forged and replayed scores. It stays
graceful: if the token fetch fails the player just sees "couldn't save score — retry," and gameplay
is never blocked.

> ⚠️ **Security note:** the token raises the bar significantly but is not a full server-authoritative
> anti-cheat (no replay/seed verification of the actual run), so a determined cheater who drives the
> real client could still inflate within the time bound. For a fun board this is the right trade-off.
> Player names are sanitized on both write (server) and render (client HTML-escapes).

## Set the domain after deploy

The manifest and embed meta tags use the literal token `https://APP_URL`. After you have a Vercel
URL, rewrite it everywhere in one command, then commit + redeploy:

```bash
npm run set-domain -- https://hoppy-toads.vercel.app
```

## Deploy + mini-app registration

See [`handoff/DEPLOY.md`](handoff/DEPLOY.md) and [`handoff/SPEC-NOTES.md`](handoff/SPEC-NOTES.md).
Short version:

1. Push to GitHub, import to Vercel (framework preset: **Other**).
2. Add the two Upstash env vars in Vercel.
3. `npm run set-domain -- https://<your-domain>`, commit, redeploy.
4. Confirm `https://<domain>/.well-known/farcaster.json` returns valid JSON.
5. **Sign the manifest** (account association) with your Farcaster custody wallet and paste the
   `header` / `payload` / `signature` into `farcaster.json`; redeploy.
6. Register on [base.dev](https://www.base.dev); preview in the
   [Farcaster preview tool](https://farcaster.xyz/~/developers/mini-apps/preview).

## Art

`hero.png` (1200×800, 3:2) is the custom promo image used for the mini-app preview and the
shared-link embed. `public/icon.png` (1024×1024, no alpha) and `splash.png` (1024×1024) are still
generated placeholders — replace them with real artwork (`node scripts/gen-placeholder-art.mjs`
regenerates the placeholders). Embeds are cached when first scraped, so finalize art before sharing.
