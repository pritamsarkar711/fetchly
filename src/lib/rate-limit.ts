type RequestLike = { headers: Headers };

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function clientKey(request: RequestLike): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Best-effort per-instance throttling. Platform-level rate limiting should also
 * be enabled in production, but this prevents accidental proxy abuse locally
 * and in a warm serverless instance without storing client data.
 */
export function takeRateLimit(request: RequestLike, scope: string, limit: number, windowMs: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const key = `${scope}:${clientKey(request)}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    current.count += 1;
    if (current.count > limit) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
    }
  }

  // Avoid retaining stale entries in long-running local servers.
  if (buckets.size > 2_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  return { allowed: true, retryAfter: 0 };
}
