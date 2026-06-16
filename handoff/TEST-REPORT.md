# TEST-REPORT — Hoppy Toads (Task 4)

Date: 2026-06-16. Environment: headless container (no browser, no live Upstash). The checks below
are what's verifiable without a GUI/credentials; the remaining items need a human with a browser and
an Upstash database and are listed under "Manual / pending".

## Automated checks — all passing ✓

### Static / packaging
- `node --check api/scores.js` → syntax OK.
- `public/.well-known/farcaster.json` parses as valid JSON; top-level keys `accountAssociation`,
  `miniapp`; `miniapp.name = "Hoppy Toads"`, `primaryCategory = "games"`.
- `fc:miniapp` meta tag present and its JSON parses; `action.type = "launch_miniapp"`.
- `fc:frame` fallback present; `action.type = "launch_frame"`.
- No `window.storage` references remain in `public/index.html` (all migrated).
- Placeholder art generated at correct sizes, color type 2 (no alpha):
  `icon.png` 1024×1024, `splash.png` 1024×1024, `hero.png` 1200×630.
- `npm run set-domain -- https://hoppy-toads.vercel.app` rewrites all 12 `APP_URL` origins
  (8 in index.html, 4 in farcaster.json) → 0 left.

### Static server
- `scripts/static-server.mjs` serves `/` (200), `/.well-known/farcaster.json` (200), `/hero.png`
  (200); served HTML contains the `fc:miniapp` tag.

### Leaderboard backend (api/scores.js) — 12/12 against an in-memory Redis mock
- Empty board GET → 200, `rows: []`.
- POST valid score → `{ ok, rank }`.
- Sorted descending; top score first.
- **Best-per-name**: re-submitting a lower score keeps the previous best (GT semantics).
- Validation: empty name → 400; score > 100000 → 400; negative → 400; non-integer → 400.
- Name sanitization to `[a-z0-9]` on write (`"Daily!!"` → `daily`).
- **Daily vs all-time boards are separate** — a daily-mode score does NOT appear on the all-time
  board. (This caught a real bug: POST originally read `mode` from the query string instead of the
  JSON body, so daily scores were written to `lb:all`. Fixed — POST now reads `mode` from the body.)
- Unsupported method (PUT) → 405.
- Rate limit: > 30 writes/min from one IP → 429.

## Manual / pending (need a browser + live Upstash)

These are from TASKS.md Task 4 and require a GUI and real credentials, so they're left for the
human deploy pass (DEPLOY.md):

- [ ] Hop / death sounds, all three relics + effects, combo bonus, shield stacking to 3.
- [ ] Daily mode (press `D`) produces a repeatable seeded course.
- [ ] Streak free-shields at run start.
- [ ] Share button (Web Share API + clipboard fallback).
- [ ] Live leaderboard GET/POST against a real Upstash database; persistence across a hard refresh
      and a second browser/device.
- [ ] Graceful degradation in production with env vars missing (board shows "couldn't load",
      game still plays) — code path verified by review; the client wraps fetch in try/catch and
      `fetchLeaderboard` returns `null` → renders "couldn't load leaderboard".

## Notes / known limitations
- Scores are client-submitted with no server-side game validation → inherently spoofable. Mitigated
  by rate-limit + sanity caps; documented in README. Anti-cheat is out of scope for v1.
- `502/503` when Upstash env vars are unset is intentional and the client degrades gracefully.
