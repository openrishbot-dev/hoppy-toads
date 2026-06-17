// Hoppy Toads — lightweight, privacy-friendly analytics (Vercel serverless function).
//
// POST /api/stats  { ev:'open'|'start'|'end', cid?, score? }   -> { ok:true }  (fire-and-forget)
// GET  /api/stats?days=7                                        -> { days:[ {day, opens, dau, runs, ends, avgScore, completion, buckets} ] }
//
// No PII: `cid` is a random per-device id (localStorage) used ONLY for a daily unique count via a
// Redis HyperLogLog (PFADD/PFCOUNT) — it is never stored as a raw value or linked to scores.
// All keys are UTC-day scoped and auto-expire. Degrades silently if Redis isn't configured.

import { Redis } from '@upstash/redis';

const KEY_TTL = 45 * 24 * 60 * 60;   // keep ~45 days of daily stats
const MAX_SCORE = 100000;
const RL_LIMIT = 120;                // events per IP per window (abuse guard)
const RL_WINDOW = 60;

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function utcDayKey(d) {
  d = d || new Date();
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}
function recentDayKeys(n) {
  const out = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) out.push(utcDayKey(new Date(now - i * 86400000)));
  return out;
}
function bucket(s) {
  if (s < 1) return '0';
  if (s < 5) return '1-4';
  if (s < 10) return '5-9';
  if (s < 25) return '10-24';
  if (s < 50) return '25-49';
  if (s < 100) return '50-99';
  return '100+';
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
  if (!db) { res.statusCode = 200; return res.end(JSON.stringify({ ok: false, error: 'stats not configured' })); }

  try {
    if (req.method === 'POST') {
      // light abuse guard (never blocks gameplay — analytics is best-effort)
      const ip = clientIp(req);
      const hits = await db.incr('rls:' + ip);
      if (hits === 1) await db.expire('rls:' + ip, RL_WINDOW);
      if (hits > RL_LIMIT) { res.statusCode = 200; return res.end(JSON.stringify({ ok: true })); }

      const body = await readBody(req).catch(() => ({}));
      const ev = String(body.ev || '');
      const day = utcDayKey();
      const ex = { ex: KEY_TTL };

      if (ev === 'open') {
        await db.incr('opens:' + day); await db.expire('opens:' + day, KEY_TTL);
        const cid = String(body.cid || '').slice(0, 40);
        if (cid) { await db.pfadd('du:' + day, cid); await db.expire('du:' + day, KEY_TTL); }
      } else if (ev === 'start') {
        await db.incr('runs:' + day); await db.expire('runs:' + day, KEY_TTL);
      } else if (ev === 'end') {
        const score = Number(body.score);
        if (Number.isInteger(score) && score >= 0 && score <= MAX_SCORE) {
          await db.incr('ends:' + day); await db.expire('ends:' + day, KEY_TTL);
          await db.incrby('scoresum:' + day, score); await db.expire('scoresum:' + day, KEY_TTL);
          await db.hincrby('bucket:' + day, bucket(score), 1); await db.expire('bucket:' + day, KEY_TTL);
        }
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'GET') {
      let days = parseInt(req.query?.days, 10);
      if (!Number.isFinite(days) || days < 1) days = 7;
      days = Math.min(days, 30);
      const keys = recentDayKeys(days);
      const rows = await Promise.all(keys.map(async (day) => {
        const [opens, dau, runs, ends, sum, buckets] = await Promise.all([
          db.get('opens:' + day), db.pfcount('du:' + day), db.get('runs:' + day),
          db.get('ends:' + day), db.get('scoresum:' + day), db.hgetall('bucket:' + day),
        ]);
        const e = Number(ends) || 0, r = Number(runs) || 0;
        return {
          day,
          opens: Number(opens) || 0,
          dau: Number(dau) || 0,
          runs: r,
          ends: e,
          avgScore: e ? Math.round((Number(sum) || 0) / e) : 0,
          completion: r ? Math.round((e / r) * 100) : 0,   // % of started runs that ended (sanity)
          buckets: buckets || {},
        };
      }));
      res.statusCode = 200;
      return res.end(JSON.stringify({ days: rows }));
    }

    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    return res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
  } catch (err) {
    res.statusCode = 200;   // analytics must never surface errors to the player
    return res.end(JSON.stringify({ ok: false, error: 'stats error' }));
  }
}
