// MoneyDeck — simple in-memory rate limiter (per IP per named bucket)
'use strict';

const buckets = new Map(); // key -> { count, resetAt }

// Defaults tuned for a demo/prototype deployment; tune in production.
const RULES = {
  login:    { windowMs: 15 * 60 * 1000, max: 20 },   // 20 login attempts / 15 min / IP
  api:      { windowMs: 60 * 1000,      max: 240 },  // general API pressure
};

function rateLimit(name) {
  const rule = RULES[name] || { windowMs: 60_000, max: 240 };
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${name}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + rule.windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    // opportunistic cleanup so the map cannot grow unbounded
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    if (b.count > rule.max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: `Too many requests. Try again in ${retry}s.` });
    }
    next();
  };
}

module.exports = { rateLimit };
