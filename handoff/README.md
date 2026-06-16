# Hoppy Toads — Handoff Bundle

Hand this whole folder to Claude Code. Start by opening **CLAUDE.md**.

## Files
- `CLAUDE.md` — project context, current state, the critical leaderboard issue, repo layout, and
  definition of done. **Read first.**
- `TASKS.md` — ordered build steps (0→5), each with a paste-ready prompt and an acceptance check.
- `DEPLOY.md` — Vercel + Farcaster/Base mini-app deploy & registration checklist (incl. the manual
  wallet-signing steps).
- `game/index.html` — the complete, working game source (move this to `public/index.html`).

## TL;DR of the work
1. Verify the current mini-app spec from live docs (it changed in early 2026).
2. Wrap the single HTML file in a Vercel static-site repo.
3. Add the `fc:miniapp` meta tag + `/.well-known/farcaster.json` manifest.
4. **Replace the leaderboard backend** — it currently uses `window.storage`, which only works inside
   Claude.ai and will NOT persist on Vercel. Move it to serverless `/api/scores` + Upstash Redis.
   Keep `profile` in `localStorage`.
5. Deploy, sign the manifest with your wallet, register on Base.dev, preview, ship.

## Note
The game is fully playable offline with zero dependencies. Only the global leaderboard needs a
backend, and it must degrade gracefully (game never breaks if the API is down).
