#!/usr/bin/env node
// Rewrite the literal token `https://APP_URL` to your real deployed origin across the manifest
// and the embed meta tags. The game itself never needs this (it runs fully offline); only the
// Farcaster/Base embed + manifest require absolute URLs.
//
//   npm run set-domain -- https://hoppy-toads.vercel.app
//
// Re-run with a new domain any time (it replaces whatever origin is currently set, not just the
// placeholder), so switching to a custom domain later is one command.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2];

if (!arg || !/^https?:\/\//.test(arg)) {
  console.error('Usage: npm run set-domain -- https://your-domain.example');
  process.exit(1);
}
const origin = arg.replace(/\/+$/, ''); // strip trailing slash

// Matches https://APP_URL or any previously-set https?://host (no path), so re-runs work.
const ORIGIN_RE = /https?:\/\/(?:APP_URL|[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?)/gi;

const targets = ['public/index.html', 'public/.well-known/farcaster.json'];
for (const rel of targets) {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = before.replace(ORIGIN_RE, origin);
  writeFileSync(p, after);
  const n = (before.match(ORIGIN_RE) || []).length;
  console.log(`${rel}: rewrote ${n} URL origin(s) -> ${origin}`);
}
console.log('Done. Commit and redeploy for the manifest/embed changes to take effect.');
