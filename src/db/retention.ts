/**
 * Nightly data retention — keeps append-only / write-only tables from growing
 * unbounded toward the D1 10GB cap. Each step deletes a bounded batch (so a
 * first run on a large table can't blow the cron's subrequest/time budget);
 * successive nights catch up. All steps are best-effort and independent.
 */

const BATCH = 2000

const PRUNES: { label: string; sql: string }[] = [
  // Expired sessions accumulate forever (only explicit logout deletes them).
  {
    label: 'expired sessions',
    sql: `DELETE FROM sessions WHERE id IN (
            SELECT id FROM sessions WHERE expires_at < datetime('now') LIMIT ${BATCH})`,
  },
  // System notifications (digests/reminders/etc.) are write-only — filtered
  // out of the vendor inbox and never read. Keep 90 days for debugging.
  {
    label: 'old system emails',
    sql: `DELETE FROM emails WHERE id IN (
            SELECT id FROM emails WHERE is_system = 1 AND created_at < datetime('now','-90 days') LIMIT ${BATCH})`,
  },
  {
    label: 'old analytics events',
    sql: `DELETE FROM analytics_events WHERE id IN (
            SELECT id FROM analytics_events WHERE created_at < datetime('now','-365 days') LIMIT ${BATCH})`,
  },
  {
    label: 'old audit log entries',
    sql: `DELETE FROM audit_log WHERE id IN (
            SELECT id FROM audit_log WHERE created_at < datetime('now','-365 days') LIMIT ${BATCH})`,
  },
  // CSV import staging — the full upload is stored per-row here.
  {
    label: 'old import records',
    sql: `DELETE FROM import_records WHERE id IN (
            SELECT id FROM import_records WHERE created_at < datetime('now','-30 days') LIMIT ${BATCH})`,
  },
  // ...and twice on the job row (raw_data + preview_data). Drop the heavy
  // payloads from old jobs but keep the job metadata.
  {
    label: 'old import job payloads',
    sql: `UPDATE import_jobs SET raw_data = NULL, preview_data = NULL
          WHERE id IN (
            SELECT id FROM import_jobs
            WHERE (raw_data IS NOT NULL OR preview_data IS NOT NULL)
              AND created_at < datetime('now','-30 days') LIMIT ${BATCH})`,
  },
  // Form submissions keep the submitter's IP + user-agent only for abuse triage
  // (migration 075). Scrub that PII after 90 days; the submission itself stays.
  {
    label: 'form-submission PII (>90d)',
    sql: `UPDATE form_submissions SET ip_address = NULL, user_agent = NULL
          WHERE id IN (
            SELECT id FROM form_submissions
            WHERE (ip_address IS NOT NULL OR user_agent IS NOT NULL)
              AND created_at < datetime('now','-90 days') LIMIT ${BATCH})`,
  },
]

export async function runRetention(db: D1Database): Promise<void> {
  for (const step of PRUNES) {
    try {
      const res = await db.prepare(step.sql).run()
      const n = (res.meta as { changes?: number })?.changes ?? 0
      if (n > 0) console.log(`[retention] ${step.label}: ${n}`)
    } catch (e: any) {
      console.error(`[retention] ${step.label} failed:`, e.message)
    }
  }
}
