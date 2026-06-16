# TASKS — ordered build steps for Claude Code

Work top to bottom. Each task has a goal, acceptance check, and a paste-ready prompt. Stop and verify
the acceptance check before moving on.

---

## Task 0 — Verify the spec is current (do this first)

The Base/Farcaster mini-app spec shifted in early 2026 (Base App moved to "standard web app + wallet"
and registration on Base.dev). **Before writing manifest/meta code, fetch the live docs** so you
don't hardcode a stale format.

Prompt:
> Fetch https://docs.base.org/mini-apps and https://miniapps.farcaster.xyz/docs/guides/sharing and
> https://docs.base.org/mini-apps/core-concepts/manifest. Summarize the CURRENT required fields for
> (a) the `/.well-known/farcaster.json` manifest and (b) the `fc:miniapp` embed meta tag. Note any
> changes from mid-2025 tutorials. Save the summary to `handoff/SPEC-NOTES.md`.

Acceptance: `SPEC-NOTES.md` exists and lists the exact current manifest keys and meta-tag shape.

---

## Task 1 — Scaffold the deployable repo

Goal: convert the single HTML file into the repo layout in `CLAUDE.md`.

Prompt:
> Create the repo structure from CLAUDE.md. Move the game file to `public/index.html` unchanged.
> Add a `vercel.json` that serves `public/` statically, routes `/api/*` to serverless functions, and
> sets a `Cache-Control: public, immutable, no-transform, max-age=300` header on the hero/splash
> images and on `/.well-known/farcaster.json`. Add a `package.json` with a `dev` script using
> `vercel dev`. Add placeholder `icon.png` (1024x1024), `splash.png`, and `hero.png` (1200x630) —
> generate simple solid Base-blue placeholders with the title text if real art isn't provided.
> Add a `README.md` with local-run and deploy instructions.

Acceptance: `vercel dev` (or a static server) serves the game at `/` and it plays normally.

---

## Task 2 — Add mini-app metadata

Goal: make it render and be saveable in Farcaster feeds and the Base App.

Prompt:
> Using the current field list from SPEC-NOTES.md, add the `fc:miniapp` meta tag to the `<head>` of
> `public/index.html` (and an `fc:frame` fallback if still recommended). Point image/button fields at
> `/hero.png` and a "Launch Hoppy Toads" action that opens `/`. Create
> `public/.well-known/farcaster.json` with the `miniapp` object filled in: name "Hoppy Toads",
> subtitle, description, `iconUrl`, `homeUrl`, `splashImageUrl`, `splashBackgroundColor` "#001a4d",
> tags ["base","farcaster","game","tobyworld"], primaryCategory "games". Leave `accountAssociation`
> empty for now (it gets signed after deploy — see DEPLOY.md). Use a single `APP_URL` constant /
> env var so the domain isn't hardcoded in multiple places.

Acceptance: `/.well-known/farcaster.json` returns valid JSON locally; meta tag present in head.

---

## Task 3 — Replace the leaderboard backend (the important one)

Goal: swap `window.storage` for a real persistent backend so scores survive on Vercel.

Background: the game has these calls (all in the `<script>` near the bottom of index.html):
`window.storage.get('profile')`, `window.storage.set('profile', ...)`, and the leaderboard
functions `fetchLeaderboard(mode)`, `submitToLeaderboard(name, sc, mode)` which use
`window.storage.list(prefix, true)` and `get/set(key, value, true)`.

Keep `profile` (personal best, streak, achievements, name) in `localStorage` — it's per-device and
doesn't need a server. Move ONLY the global leaderboard to the backend.

Prompt:
> Create `api/scores.js` as a Vercel serverless function backed by Upstash Redis
> (`@upstash/redis`). Implement:
> - `GET /api/scores?mode=all|daily` → returns top 20 `{name, score}` sorted desc. Use a Redis
>   sorted set per board: `lb:all` and `lb:daily:<UTC-YYYY-MM-DD>`. Use `ZADD` with the score and
>   keep only the player's best (GT update). Set the daily key to expire after ~36h.
> - `POST /api/scores` body `{name, score, mode}` → validate: name 1–14 chars, strip to
>   `[a-z0-9]`, score is a non-negative integer, reject absurd scores (> 100000) and rate-limit by
>   IP (simple Redis counter, e.g. 30 writes/min). Store best-per-name only.
> Then in `public/index.html`, replace the `window.storage` leaderboard calls with `fetch('/api/scores')`
> GET/POST. Keep the EXACT same UI behavior and the graceful-degradation try/catch (if fetch fails,
> the game still plays and the board shows "couldn't load leaderboard"). Replace the `profile`
> `window.storage` calls with `localStorage`. Add `.env.example` with `UPSTASH_REDIS_REST_URL` and
> `UPSTASH_REDIS_REST_TOKEN`.

Acceptance: with Upstash env vars set, submitting a score writes to Redis and the top-20 GET reflects
it across a hard refresh and a second browser. With the API unreachable, the game is still fully
playable.

Security notes for Claude Code to honor:
- This is a client-submitted score with no server-side game validation, so it is inherently
  spoofable. For v1 that's acceptable for a fun board; add the rate-limit + sanity caps above to
  limit abuse. Document this limitation in the README. Do NOT add anything that blocks gameplay.
- Sanitize `name` on both write and render (the game already HTML-escapes on render — keep that).

---

## Task 4 — Local test pass

Prompt:
> Run the game locally with `vercel dev`. Verify: hop/death sounds, all three relics and their
> effects, combo bonus, shield stacking to 3, daily mode (press D) producing a repeatable course,
> streak shields, Share button copy fallback, and leaderboard GET/POST against Redis. Fix anything
> broken. Produce a short `handoff/TEST-REPORT.md` of what you checked.

Acceptance: TEST-REPORT.md shows all items passing.

---

## Task 5 — Deploy + sign manifest + register

Follow `DEPLOY.md` exactly. This is mostly human-in-the-loop (wallet signing), so Claude Code should
prepare everything and then print the precise manual steps for the user.

Acceptance: live URL works; `farcaster.json` has a signed `accountAssociation`; app registered on
Base.dev; preview tool shows green.

---

## Out of scope for v1 (note for later)

- Wallet-based identity (use Farcaster/Base address instead of typed name). Leave a seam: the
  score submit function should accept an optional `identity` field.
- Onchain rewards / token-gated cosmetics.
- Push notifications (requires Base.dev notifications API + opted-in addresses).
- Server-authoritative anti-cheat (would need replay/seed verification).
