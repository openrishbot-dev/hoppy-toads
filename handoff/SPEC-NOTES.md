# SPEC-NOTES — current Farcaster / Base mini-app spec (Task 0)

Verified 2026-06-16. The official doc sites (`docs.base.org`, `miniapps.farcaster.xyz`) block
automated fetches (HTTP 403) from this environment, so the details below were confirmed via web
search against the live docs plus the project's knowledge of the current (early-2026) spec.
**Re-verify against the live preview tool before the final deploy** — see the URLs at the bottom.

## (a) `/.well-known/farcaster.json` manifest

Two top-level objects: `accountAssociation` (signed after deploy) and `miniapp`.

```jsonc
{
  "accountAssociation": {
    "header": "",      // base64url JSON {fid, type:"custody", key:"0x..."}
    "payload": "",     // base64url JSON {domain:"yourdomain.com"}
    "signature": ""    // base64url signature from your Farcaster custody wallet
  },
  "miniapp": {
    "version": "1",                       // REQUIRED — string "1"
    "name": "Hoppy Toads",                // REQUIRED
    "iconUrl": "https://APP_URL/icon.png",        // REQUIRED, 1024x1024 PNG, no alpha
    "homeUrl": "https://APP_URL/",                // REQUIRED, the launch URL
    "imageUrl": "https://APP_URL/hero.png",       // 3:2 embed/og image (1200x630 ok)
    "buttonTitle": "Launch Hoppy Toads",          // <= ~32 chars
    "splashImageUrl": "https://APP_URL/splash.png",
    "splashBackgroundColor": "#001a4d",
    "subtitle": "Hop through Tobyworld on Base",
    "description": "...",                          // REQUIRED for discovery
    "primaryCategory": "games",                    // games | social | finance | utility | ...
    "tags": ["base", "farcaster", "game", "tobyworld"]
  }
}
```

Notes:
- The object key is `miniapp` (the older `frame` key is deprecated but still read by some clients).
- `accountAssociation` is left empty here and filled in after deploy by signing the deployed domain
  (see DEPLOY.md step 5). Domain in `payload` must exactly match the deployed origin.
- Icon must be 1024x1024 PNG with **no alpha channel**.

## (b) `fc:miniapp` embed meta tag

Goes in `<head>` of any shareable page (here, `index.html`). Content is a JSON string:

```html
<meta name="fc:miniapp" content='{
  "version": "1",
  "imageUrl": "https://APP_URL/hero.png",
  "button": {
    "title": "Launch Hoppy Toads",
    "action": {
      "type": "launch_miniapp",
      "name": "Hoppy Toads",
      "url": "https://APP_URL/",
      "splashImageUrl": "https://APP_URL/splash.png",
      "splashBackgroundColor": "#001a4d"
    }
  }
}'>
```

Notes:
- Use `fc:miniapp` for new apps. Keep a duplicate `fc:frame` tag (same JSON but
  `action.type: "launch_frame"`) for backward-compat with older clients.
- The action type changed: it's `launch_miniapp` now (older 2025 tutorials used `launch_frame`).
- All URLs must be absolute. We use the literal token `https://APP_URL` everywhere and rewrite it
  to the real domain in one shot with `npm run set-domain -- https://your-domain` (see README).

## Base App specifics (early 2026)

- Base App converged on "standard web app + wallet + Base.dev metadata." An app with no Farcaster
  SDK calls is already a valid web app; no `addMiniApp` call required.
- Registration/metadata happens at https://www.base.dev (name, icon, tagline, description,
  screenshots, category, primary URL, builder code).
- Account-association signing can be done via the Base Build account-association tool or the
  Farcaster manifest tool.

## Source-of-truth URLs (re-check before final deploy)
- Farcaster manifest vs embed: https://miniapps.farcaster.xyz/docs/guides/manifest-vs-embed
- Farcaster specification: https://miniapps.farcaster.xyz/docs/specification
- Farcaster publishing: https://miniapps.farcaster.xyz/docs/guides/publishing
- Base manifest: https://docs.base.org/mini-apps/core-concepts/manifest
- Preview tool: https://farcaster.xyz/~/developers/mini-apps/preview
