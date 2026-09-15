export function createRateLimiter({
  limit = 300,
  windowMs = 60_000,
  now = Date.now,
  maxKeys = 10_000,
} = {}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Rate limit must be a positive integer.");
  }
  if (!Number.isFinite(windowMs) || windowMs < 1) {
    throw new RangeError("Rate-limit window must be positive.");
  }

  const buckets = new Map();

  const prune = (currentTime) => {
    if (buckets.size < maxKeys) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= currentTime) buckets.delete(key);
    }
  };

  return {
    consume(key = "unknown") {
      const currentTime = now();
      prune(currentTime);
      const existing = buckets.get(key);
      const bucket =
        !existing || existing.resetAt <= currentTime
          ? { count: 0, resetAt: currentTime + windowMs }
          : existing;

      bucket.count += 1;
      buckets.set(key, bucket);

      return {
        allowed: bucket.count <= limit,
        remaining: Math.max(0, limit - bucket.count),
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.resetAt - currentTime) / 1_000)
        ),
      };
    },
  };
}

export function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; " +
      "base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  );
}
