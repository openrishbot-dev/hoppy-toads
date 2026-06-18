// Hoppy Toads — global leaderboard backend (Vercel serverless function).
//
// GET  /api/scores?mode=all|daily   -> { mode, rows: [{name, score}] }  top 20 desc
// GET  /api/scores?start=1           -> { token } anti-cheat run token (token:null if no secret)
// POST /api/scores  { name, score, mode, identity?, token? } -> { ok, rank? }
//
// Storage: Upstash Redis sorted sets, one member per player-name (best score kept via GT).
//   lb:all                          (all-time board, never expires)
//   lb:daily:<UTC-YYYY-MM-DD>       (per-UTC-day board, expires ~36h after last write)
//
// The game degrades gracefully: if these routes fail or the env vars are missing, the client
// catches the error and the board just shows "couldn't load leaderboard" — gameplay is unaffected.

import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const MAX_NAME = 14;
const MAX_SCORE = 100000;
const TOP_N = 20;
const DAILY_TTL = 36 * 60 * 60; // seconds
const RATE_LIMIT = 30; // writes per IP per window
const RATE_WINDOW = 60; // seconds

// ---- Anti-cheat (signed run tokens) ----
// On run start the client GETs /api/scores?start=1 and receives a short-lived HMAC-signed token.
// On submit it sends the token back; we verify the signature, enforce single-use (nonce stored in
// Redis), and reject scores that arrived implausibly fast for their value. It activates whenever a
// secret is available — we reuse the Upstash REST token as the HMAC key so no extra config is
// needed — and degrades gracefully: if no secret is set, scoring works exactly as before.
const TOKEN_TTL = 2 * 60 * 60;     // seconds a run token / nonce stays valid
// Minimum real time per point. Kept low because score is heavily multiplied (combos,
// Golden Streak 2x, Golden Hour 2x, near-miss bonuses, Relic Rush) — points accrue far
// faster than 1/pipe, so a high per-point floor falsely rejects legit high scores. At 12ms
// a 100k cheat still needs ~20min; real runs never approach this rate.
const MIN_MS_PER_POINT = 12;
function getSecret() {
  return process.env.HOPPY_SECRET || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
}
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function signToken(secret) {
  const nonce = crypto.randomBytes(9).toString('hex');
  const payload = b64url(JSON.stringify({ t: Date.now(), n: nonce }));
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return { token: payload + '.' + sig, nonce };
}
function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expect = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch { return null; }
}

let redis = null;
function getRedis() {
  if (redis) return redis;
  // Accept either the native Upstash names or the KV_* names that Vercel's Upstash
  // marketplace integration injects. Use the read-write token (not the read-only one).
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null; // not configured -> caller responds 503, client degrades
  redis = new Redis({ url, token });
  return redis;
}

function dkOf(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}
function utcDayKey() { return dkOf(Date.now()); }

// The daily board buckets by the player's LOCAL day-key (sent by the client). To prevent
// posting to arbitrary days, only accept a key within ±1 day of the server's UTC date — that
// window covers every real timezone. Anything else falls back to the server's own UTC day.
function resolveDailyKey(day) {
  if (typeof day === 'string' && /^\d{4}-\d{1,2}-\d{1,2}$/.test(day)) {
    const now = Date.now();
    if (day === dkOf(now) || day === dkOf(now - 86400000) || day === dkOf(now + 86400000)) return day;
  }
  return utcDayKey();
}

function normMode(m) {
  return m === 'daily' ? 'daily' : 'all';
}

function boardKey(mode, day) {
  return mode === 'daily' ? 'lb:daily:' + resolveDailyKey(day) : 'lb:all';
}

// Match the client's sanitization: lowercase, strip to [a-z0-9], 1..14 chars.
function cleanName(raw) {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, MAX_NAME);
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const db = getRedis();
  if (!db) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ ok: false, error: 'leaderboard not configured' }));
  }

  try {
    if (req.method === 'GET') {
      // Run-start: issue an anti-cheat token (no-op token if no secret is configured).
      if (req.query?.start || req.url.includes('start=1')) {
        const secret = getSecret();
        if (!secret) { res.statusCode = 200; return res.end(JSON.stringify({ token: null })); }
        const { token, nonce } = signToken(secret);
        await db.set('nc:' + nonce, 1, { ex: TOKEN_TTL });
        res.statusCode = 200;
        return res.end(JSON.stringify({ token }));
      }
      // whoami: look up the username a given wallet/fid identity has claimed (null if none).
      if (req.query?.whoami || req.url.includes('whoami=')) {
        let id = req.query?.whoami;
        if (!id) { try { id = new URL(req.url, 'http://x').searchParams.get('whoami'); } catch { id = ''; } }
        id = String(id || '').toLowerCase().slice(0, 64);
        let nm = null;
        if (id) { try { nm = await db.hget('names', id); } catch {} }
        res.statusCode = 200;
        return res.end(JSON.stringify({ name: nm ? String(nm) : null }));
      }
      const mode = normMode(req.query?.mode || (req.url.includes('mode=daily') ? 'daily' : 'all'));
      let qDay = req.query?.day;
      if (!qDay && req.url.includes('day=')) { try { qDay = new URL(req.url, 'http://x').searchParams.get('day'); } catch { qDay = undefined; } }
      const key = boardKey(mode, qDay);
      // Highest scores first, with scores. Upstash returns [member, score, member, score, ...].
      const flat = await db.zrange(key, 0, TOP_N - 1, { rev: true, withScores: true });
      const rows = [];
      for (let i = 0; i < flat.length; i += 2) {
        rows.push({ name: String(flat[i]), score: Number(flat[i + 1]) });
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ mode, rows }));
    }

    if (req.method === 'POST') {
      // Rate limit by IP (sliding-ish fixed window).
      const ip = clientIp(req);
      const rlKey = 'rl:' + ip;
      const hits = await db.incr(rlKey);
      if (hits === 1) await db.expire(rlKey, RATE_WINDOW);
      if (hits > RATE_LIMIT) {
        res.statusCode = 429;
        return res.end(JSON.stringify({ ok: false, error: 'rate limited' }));
      }

      const body = await readBody(req);
      const mode = normMode(body.mode);
      const name = cleanName(body.name);
      const score = Number(body.score);
      const identity = body.identity ? String(body.identity).toLowerCase().slice(0, 64) : '';

      // Claim: bind a username to a wallet/fid identity (persists across devices).
      // Enforces uniqueness so two identities can't own the same name.
      if (body.claim) {
        const want = cleanName(body.name);
        if (!want || !identity) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: 'invalid claim' }));
        }
        const owner = await db.hget('nameowner', want);
        if (owner && String(owner) !== identity) {
          res.statusCode = 409;
          return res.end(JSON.stringify({ ok: false, error: 'name taken' }));
        }
        const prev = await db.hget('names', identity);
        if (prev && String(prev) !== want) { try { await db.hdel('nameowner', String(prev)); } catch {} }
        await db.hset('names', { [identity]: want });
        await db.hset('nameowner', { [want]: identity });
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, name: want }));
      }

      if (!name) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'invalid name' }));
      }
      if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'invalid score' }));
      }

      // Anti-cheat: when a secret is configured, require a valid, single-use, time-plausible token.
      const secret = getSecret();
      if (secret) {
        const claims = verifyToken(body.token, secret);
        if (!claims || !claims.n || !Number.isFinite(claims.t)) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ ok: false, error: 'bad token' }));
        }
        // single-use: DEL returns 1 only the first time this nonce is redeemed
        const fresh = await db.del('nc:' + claims.n);
        if (!fresh) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ ok: false, error: 'token reused or expired' }));
        }
        const elapsed = Date.now() - claims.t;
        if (elapsed < score * MIN_MS_PER_POINT) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ ok: false, error: 'implausible run' }));
        }
      }

      const key = boardKey(mode, body.day);
      // GT keeps only the player's best; one member per name -> best-per-name board.
      await db.zadd(key, { gt: true }, { score, member: name });
      if (mode === 'daily') await db.expire(key, DAILY_TTL);

      // Optional: store identity seam for a future wallet-based board (does not affect ranking).
      if (identity) {
        await db.hset('id:' + key, { [name]: identity });
        if (mode === 'daily') await db.expire('id:' + key, DAILY_TTL);
        // Soft-bind name<->identity so host handles persist too — never overwrites an existing claim.
        try {
          const set = await db.hsetnx('nameowner', name, identity);
          const owner = set ? identity : await db.hget('nameowner', name);
          if (String(owner) === identity) await db.hset('names', { [identity]: name });
        } catch {}
      }

      const rank = await db.zrevrank(key, name);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, rank: rank == null ? null : rank + 1 }));
    }

    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    return res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
  } catch (err) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: 'server error' }));
  }
}
