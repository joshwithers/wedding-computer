/**
 * Emit a single-line structured JSON log event. Workers observability captures
 * stdout, so emitting `{event, ...fields}` lets an operator filter by event
 * type (e.g. queue.failed) and correlate by vendorId — far easier than
 * grepping free-text. Use for the operational backbone (cron, queue, sync,
 * webhooks); plain console.log is fine elsewhere.
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }))
  } catch {
    console.log(`[event] ${event}`)
  }
}
