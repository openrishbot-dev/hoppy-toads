# Hoppy Toads — Claude Code Handoff

This is the working context file for Claude Code. Read this first, then see `TASKS.md` for the
ordered build steps and `DEPLOY.md` for the hosting/mini-app checklist.

## What this project is

**Hoppy Toads** is a Flappy Bird–style arcade game themed around **Tobyworld on Base**. It is a
single self-contained HTML5 canvas game (no build step, no framework, no dependencies). The goal of
this handoff is to:

1. Turn the single HTML file into a **Vercel-deployable static site**.
2. Make it a **Farcaster Mini App** and a **Base App** ("Base mini app") — these two specs have
   converged onto "standard web app + wallet + metadata."
3. Replace the **leaderboard backend**, which currently relies on an API that only exists inside the
   Claude artifact runtime and will NOT work once hosted.

## Current state of the game (already built)

The game file (`game/index.html`) is complete and playable. Features already implemented:

- Toby character (chunky blue toad matching the official art), Base-blue pillars, parallax pond bg.
- Tap / click / spacebar to hop. Synthesized audio (no asset files): "ribbit" on hop, "croak" on
  death, pickup chimes, win fanfare.
- Three Tobyworld relic power-ups:
  - **$TABOSHI** (green hex leaf) → yield multiplier, x2 score for ~7s.
  - **$PATIENCE** (red triangle) → bankable shield, stacks up to 3, absorbs one pillar hit each.
    Deliberately scarce (~10% of relic spawns).
  - **Sato** (blue swirl) → bursts collectible gold flakes (+2 each).
- Combo system (chain relics within a window for bonus points).
- Difficulty ramp (speed up + gap tighten as score climbs).
- Achievements (8 badges), daily challenge mode (seeded course, press D), daily streak with free
  starting shields (3+ days = 1 shield, 7+ = 2, 14+ = 3).
- Game-over card with name entry, Share button (Web Share API + clipboard fallback), and a
  leaderboard view.
- Base watermark bottom-right.

## ⚠️ Critical issue to fix: the leaderboard

The leaderboard currently calls `window.storage.get/set/list(...)`. **That API only exists inside
the Claude.ai artifact sandbox.** On Vercel it will be `undefined`. The calls are wrapped in
try/catch, so the game won't crash — but scores will silently never persist.

**The fix** (see `TASKS.md` task 3): replace `window.storage` with real serverless API routes backed
by a small KV store (Upstash Redis is the standard cheap choice on Vercel). Keep the exact same UX:
top-20 global board, best-score-per-name, plus a daily board.

## Tech decisions / constraints

- **Keep it static-first.** The game itself must stay a plain HTML/canvas file that runs with zero
  network. Only the leaderboard talks to the backend, and it must degrade gracefully (game fully
  playable offline; board just shows "couldn't load" if the API is down).
- **No wallet/onchain logic is required** for the game to function. Hoppy Toads has no smart
  contracts. This is what makes the Base/Farcaster migration easy — per Base docs, an app with no
  Farcaster SDK "is already a standard web app."
- **Framework:** the simplest correct path is a static site + Vercel serverless functions in
  `/api`. Do NOT scaffold a heavy Next.js app unless the leaderboard or future wallet features make
  it worth it. If you do choose Next.js (App Router), keep the game as a static asset and put score
  routes under `app/api/`.
- **Identity:** for v1, player identity = the typed toad name (already built). A later enhancement
  can use the Farcaster/Base wallet address as identity — leave a clean seam for that, don't build
  it yet.

## Repo layout to produce

```
hoppy-toads/
├── public/
│   ├── index.html                 # the game (moved from game/index.html)
│   ├── icon.png                   # 1024x1024 app icon (placeholder ok)
│   ├── splash.png                 # splash/launch image
│   ├── hero.png                   # 1200x630 feed/embed image
│   └── .well-known/
│       └── farcaster.json         # mini app manifest (see DEPLOY.md)
├── api/
│   └── scores.js                  # GET top scores, POST new score (Upstash Redis)
├── vercel.json                    # static + headers config
├── package.json
├── .env.example                   # UPSTASH_REDIS_REST_URL / _TOKEN
└── README.md
```

## Definition of done

- [ ] `npm run dev` (or `vercel dev`) serves the game locally and the leaderboard reads/writes Redis.
- [ ] Deployed to Vercel at a stable URL.
- [ ] `https://<domain>/.well-known/farcaster.json` returns valid JSON with a signed
      `accountAssociation`.
- [ ] `fc:miniapp` meta tag present in `index.html` `<head>`; previews green in the Farcaster
      preview tool.
- [ ] Registered on Base.dev with metadata (name, icon, tagline, description, screenshots, category,
      primary URL, builder code).
- [ ] Leaderboard persists across sessions and devices; game still fully playable if the API is down.

## Source of truth for the spec

These changed recently — verify against live docs before relying on memory:
- Base mini apps / manifest + migration: https://docs.base.org/mini-apps
- Base.dev (app registration): https://www.base.dev
- Farcaster mini apps (manifest, embeds, sharing): https://miniapps.farcaster.xyz/docs
- Farcaster preview tool: https://farcaster.xyz/~/developers/mini-apps/preview
- Vercel + Upstash Redis: https://vercel.com/docs and https://upstash.com/docs/redis
