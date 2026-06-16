# DEPLOY — Vercel + Farcaster/Base mini app

These steps mix automated work (Claude Code) and manual steps (you, with a wallet/phone). Claude Code
should do everything it can, then hand you the signing steps.

> ⚠️ Spec currency: the Base App moved to a "standard web app + Base.dev metadata" model in early
> 2026 and de-emphasized the Farcaster manifest for the Base App specifically. The Farcaster app
> still uses the manifest + embed meta tag. Re-check `SPEC-NOTES.md` (Task 0) before following any
> step that mentions exact fields.

## 1. Push to GitHub
- `git init`, commit the repo, create a GitHub repo, push.

## 2. Provision Upstash Redis (for the leaderboard)
- Create a free Upstash Redis database (or add the Upstash integration from the Vercel marketplace,
  which auto-injects the env vars).
- Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## 3. Import to Vercel
- vercel.com → Add New → Project → import the GitHub repo.
- Framework preset: "Other" (static) unless you scaffolded Next.js.
- Add the two Upstash env vars under Project → Settings → Environment Variables.
- Deploy. You'll get `https://<project>.vercel.app`. (A custom domain is optional but nicer for a
  mini app; the manifest must match whatever final domain you use.)

## 4. Confirm the manifest is reachable
- Open `https://<your-domain>/.well-known/farcaster.json` — it must return valid JSON, not a 404.

## 5. Sign the manifest (account association) — MANUAL, needs your wallet
This proves you own the domain and unlocks notifications/rewards.
- Go to the **Base Build Account Association tool** (Base.dev / Base Build) — or the Farcaster
  Manifest tool as a fallback.
- Paste your deployed domain, click Verify/Submit, and **sign with your Farcaster custody wallet**
  (recovery phrase is in the Farcaster app under Settings → Advanced).
- It outputs `accountAssociation` = `{ header, payload, signature }`.
- Paste those three values into `public/.well-known/farcaster.json`, commit, and **redeploy**.

## 6. Register on Base.dev — MANUAL
- Create a project at https://www.base.dev.
- Fill metadata: name (Hoppy Toads), icon, tagline, description, screenshots, category (Games),
  primary URL (your Vercel domain), and your **builder code**.
- (Base App handles install automatically; no `addMiniApp` SDK call needed.)

## 7. Preview & test in-feed
- Farcaster preview tool: https://farcaster.xyz/~/developers/mini-apps/preview — paste your URL,
  confirm the embed, splash, and launch button all render (everything "green").
- Cast the URL from a test account to see the embed render live. Note: embeds are cached when first
  scraped, so if you change the hero image later, the old cast keeps the old image.

## 8. Image cache headers
- Ensure `hero.png` / `splash.png` and the manifest are served with a non-zero `max-age` (the
  `vercel.json` from Task 1 handles this). Without it, feeds may show a gray image and you rack up
  bandwidth.

## Rollback / gotchas
- Manifest changes only take effect after a redeploy AND a fresh repost.
- The domain in the manifest, the signed association, and the deployed URL must all match. If you
  later add a custom domain, re-sign the association for that domain.
- The leaderboard needs the Upstash env vars in the Vercel project, not just locally. A common
  failure is "works in `vercel dev`, empty board in prod" → env vars missing in Vercel.
