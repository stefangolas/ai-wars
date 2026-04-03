// Simple sliding-window rate limiter — no dependencies required.
// One instance per surface (HTTP API, WebSocket).
//
// Usage:
//   const limiter = new RateLimiter(30, 10_000);  // 30 req per 10s
//   if (!limiter.allow(playerId)) return res.status(429)...

export class RateLimiter {
  constructor(maxRequests = 30, windowMs = 10_000) {
    this.max    = maxRequests;
    this.window = windowMs;
    this._map   = new Map(); // key → { count, start }
    // Purge stale entries every minute to prevent unbounded growth.
    const t = setInterval(() => this._purge(), 60_000);
    if (t.unref) t.unref(); // don't keep the process alive just for cleanup
  }

  // Returns true if the request is allowed; false if the key is over-limit.
  allow(key) {
    const now   = Date.now();
    const entry = this._map.get(key);
    if (!entry || now - entry.start >= this.window) {
      this._map.set(key, { count: 1, start: now });
      return true;
    }
    if (entry.count >= this.max) return false;
    entry.count++;
    return true;
  }

  _purge() {
    const cutoff = Date.now() - this.window;
    for (const [key, entry] of this._map) {
      if (entry.start < cutoff) this._map.delete(key);
    }
  }
}
