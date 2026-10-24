// Simple in-memory limits to protect your API budget.
// On serverless hosts each instance keeps its own counters, so treat these as a
// best-effort guard. These limits also act as a spending cap, because every question costs a little.

type Bucket = { count: number; resetAt: number };

const perIp = new Map<string, Bucket>();
let daily: Bucket = { count: 0, resetAt: 0 };

const PER_IP_LIMIT = Number(process.env.PER_IP_PER_HOUR ?? 15);
const DAILY_LIMIT = Number(process.env.DAILY_REQUEST_LIMIT ?? 500);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type LimitResult = { ok: true } | { ok: false; reason: "ip" | "daily"; retryAfterSec: number };

export function checkLimits(ip: string): LimitResult {
  const now = Date.now();

  if (now > daily.resetAt) daily = { count: 0, resetAt: now + DAY };
  if (daily.count >= DAILY_LIMIT) {
    return { ok: false, reason: "daily", retryAfterSec: Math.ceil((daily.resetAt - now) / 1000) };
  }

  let b = perIp.get(ip);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + HOUR };
    perIp.set(ip, b);
  }
  if (b.count >= PER_IP_LIMIT) {
    return { ok: false, reason: "ip", retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }

  b.count += 1;
  daily.count += 1;

  // Keep the map from growing forever
  if (perIp.size > 5000) {
    for (const [k, v] of perIp) if (now > v.resetAt) perIp.delete(k);
  }
  return { ok: true };
}
