// Tobyworld — shared, privacy-friendly analytics across all sites (Vercel serverless + Upstash).
// One central store; every event is tagged with a `site` so a single dashboard can filter by site.
//
// POST /api/stats  { ev, cid?, score?, site? }        -> { ok:true }   (fire-and-forget beacon)
//   ev: 'open' (traffic/DAU), 'start'/'end' (game funnel), or any custom event name.
//   Cross-origin friendly: beacons are sent as text/plain (no CORS preflight); responses allow *.
// GET  /api/stats?days=7                               -> { sites, days:[ {day, bySite:{...}} ] }
//
// No PII: `cid` is a random per-device id used ONLY for daily-unique counts via a Redis HyperLogLog
// (PFADD/PFCOUNT) — never stored raw or linked to scores. All keys are UTC-day scoped & auto-expire.

import { Redis } from '@upstash/redis';

const KEY_TTL = 45 * 24 * 60 * 60;     // keep ~45 days
const MAX_SCORE = 100000;
const RL_LIMIT = 240, RL_WINDOW = 60;  // per-IP abuse guard
const KNOWN_SITES = ['hoppy', 'toadvault', 'pixelpond'];

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function utcDayKey(d) { d = d || new Date(); return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate(); }
function recentDayKeys(n) { const out = [], now = Date.now(); for (let i = 0; i < n; i++) out.push(utcDayKey(new Date(now - i * 86400000))); return out; }
function cleanSite(s) { s = String(s || 'hoppy').toLowerCase(); return /^[a-z0-9_]{1,16}$/.test(s) ? s : 'other'; }
function cleanEv(s) { s = String(s || '').toLowerCase(); return /^[a-z0-9_]{1,24}$/.test(s) ? s : ''; }
function bucket(s) { if (s < 1) return '0'; if (s < 5) return '1-4'; if (s < 10) return '5-9'; if (s < 25) return '10-24'; if (s < 50) return '25-49'; if (s < 100) return '50-99'; return '100+'; }
function clientIp(req) { const xf = req.headers['x-forwarded-for']; if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim(); return req.socket?.remoteAddress || 'unknown'; }
async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8'); return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');           // beacons come from other sites
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const db = getRedis();
  if (!db) { res.statusCode = 200; return res.end(JSON.stringify({ ok: false, error: 'stats not configured' })); }

  try {
    if (req.method === 'POST') {
      const ip = clientIp(req);
      const hits = await db.incr('rls:' + ip);
      if (hits === 1) await db.expire('rls:' + ip, RL_WINDOW);
      if (hits > RL_LIMIT) { res.statusCode = 200; return res.end(JSON.stringify({ ok: true })); }

      const body = await readBody(req).catch(() => ({}));
      const site = cleanSite(body.site);
      const ev = cleanEv(body.ev);
      if (!ev) { res.statusCode = 200; return res.end(JSON.stringify({ ok: true })); }
      const day = utcDayKey();

      const cid = String(body.cid || '').slice(0, 40);
      if (cid) { await db.pfadd('du:' + site + ':' + day, cid); await db.expire('du:' + site + ':' + day, KEY_TTL); }
      await db.hincrby('ev:' + site + ':' + day, ev, 1); await db.expire('ev:' + site + ':' + day, KEY_TTL);

      if (ev === 'end') {
        const score = Number(body.score);
        if (Number.isInteger(score) && score >= 0 && score <= MAX_SCORE) {
          await db.incrby('sum:' + site + ':' + day, score); await db.expire('sum:' + site + ':' + day, KEY_TTL);
          await db.hincrby('bkt:' + site + ':' + day, bucket(score), 1); await db.expire('bkt:' + site + ':' + day, KEY_TTL);
        }
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'GET') {
      let days = parseInt(req.query?.days, 10);
      if (!Number.isFinite(days) || days < 1) days = 7;
      days = Math.min(days, 30);
      const dayKeys = recentDayKeys(days);

      const rows = await Promise.all(dayKeys.map(async (day) => {
        const bySite = {};
        await Promise.all(KNOWN_SITES.map(async (site) => {
          const [dau, events, sum, buckets] = await Promise.all([
            db.pfcount('du:' + site + ':' + day),
            db.hgetall('ev:' + site + ':' + day),
            db.get('sum:' + site + ':' + day),
            db.hgetall('bkt:' + site + ':' + day),
          ]);
          const ev = events || {};
          const ends = Number(ev.end) || 0, starts = Number(ev.start) || 0;
          bySite[site] = {
            dau: Number(dau) || 0,
            opens: Number(ev.open) || 0,
            events: ev,
            ends, starts,
            avgScore: ends ? Math.round((Number(sum) || 0) / ends) : 0,
            completion: starts ? Math.round((ends / starts) * 100) : 0,
            buckets: buckets || {},
          };
        }));
        return { day, bySite };
      }));

      res.statusCode = 200;
      return res.end(JSON.stringify({ sites: KNOWN_SITES, days: rows }));
    }

    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
  } catch (err) {
    res.statusCode = 200;   // analytics must never surface errors
    return res.end(JSON.stringify({ ok: false, error: 'stats error' }));
  }
}
