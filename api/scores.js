// Hoppy Toads — global leaderboard backend (Vercel serverless function).
//
// GET  /api/scores?mode=all|daily   -> { mode, rows: [{name, score}], stale? }  top 20 desc
// POST /api/scores  { name, score, mode, identity? } -> { ok, rank? }
//
// Storage: Upstash Redis sorted sets, one member per player-name (best score kept via GT).
//   lb:all                          (all-time board, never expires)
//   lb:daily:<UTC-YYYY-MM-DD>       (per-UTC-day board, expires ~36h after last write)
//
// The game degrades gracefully: if these routes fail or the env vars are missing, the client
// catches the error and the board just shows "couldn't load leaderboard" — gameplay is unaffected.

import { Redis } from '@upstash/redis';

const MAX_NAME = 14;
const MAX_SCORE = 100000;
const TOP_N = 20;
const DAILY_TTL = 36 * 60 * 60; // seconds
const RATE_LIMIT = 30; // writes per IP per window
const RATE_WINDOW = 60; // seconds

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // not configured -> caller responds 503, client degrades
  redis = new Redis({ url, token });
  return redis;
}

function utcDayKey() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}

function normMode(m) {
  return m === 'daily' ? 'daily' : 'all';
}

function boardKey(mode) {
  return mode === 'daily' ? 'lb:daily:' + utcDayKey() : 'lb:all';
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
      const mode = normMode(req.query?.mode || (req.url.includes('mode=daily') ? 'daily' : 'all'));
      const key = boardKey(mode);
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

      if (!name) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'invalid name' }));
      }
      if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'invalid score' }));
      }

      const key = boardKey(mode);
      // GT keeps only the player's best; one member per name -> best-per-name board.
      await db.zadd(key, { gt: true }, { score, member: name });
      if (mode === 'daily') await db.expire(key, DAILY_TTL);

      // Optional: store identity seam for a future wallet-based board (does not affect ranking).
      if (body.identity) {
        await db.hset('id:' + key, { [name]: String(body.identity).slice(0, 64) });
        if (mode === 'daily') await db.expire('id:' + key, DAILY_TTL);
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
