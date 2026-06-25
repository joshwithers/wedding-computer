/**
 * Lightweight Server-Timing collector.
 *
 * In Cloudflare Workers the clock (`Date.now()`) only advances across I/O — it's
 * frozen between async boundaries as a side-channel mitigation. That's exactly
 * what we want here: these marks measure the wall-clock spent *waiting* on D1 /
 * KV / R2 round-trips, not CPU. Pure-CPU spans read ~0, which is fine — the
 * thing we're hunting is serial round-trip latency.
 *
 * Usage:
 *   const members = await timed(c, 'members', () => getWeddingMembers(db, id))
 *
 * The `serverTiming` wiring in index.tsx creates the collector per request and
 * emits a `Server-Timing` response header, visible in the browser DevTools
 * Network tab (Timing → Server Timing). `total` is the whole request.
 */

export type TimingMark = { name: string; dur: number }
export type TimingCollector = { start: number; marks: TimingMark[] }

export function newTiming(): TimingCollector {
  return { start: Date.now(), marks: [] }
}

/** Wrap an async op so its duration shows up in the Server-Timing header. */
export async function timed<T>(
  c: { get: (k: 'timing') => TimingCollector | undefined },
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const t = c.get('timing')
  if (!t) return fn()
  const s = Date.now()
  try {
    return await fn()
  } finally {
    t.marks.push({ name, dur: Date.now() - s })
  }
}

/** Render the collected marks (plus a `total`) as a Server-Timing header value. */
export function serverTimingHeader(t: TimingCollector): string {
  const safe = (n: string) => n.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
  const parts = t.marks.map((m, i) => `${safe(m.name)}-${i};dur=${m.dur}`)
  parts.push(`total;dur=${Date.now() - t.start}`)
  return parts.join(', ')
}
