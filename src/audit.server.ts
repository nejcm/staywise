import { sql } from './db.server';
import { withOwnerContext } from './db.server';
import { appEnv } from './env.server';
import { logEvent } from './log.server';

const auditActions = ['sign_in', 'callback_failure', 'mfa_enrolled', 'mfa_unenrolled'] as const;
export type AuditAction = (typeof auditActions)[number];

// Minimal audit row: actor, action, time — never message bodies, emails, codes, or tokens.
// Audit writes must not break the auth flow; failures are logged with safe fields only.
export async function recordAudit(actorId: string | null, action: AuditAction): Promise<void> {
  try {
    if (actorId) {
      // RLS on audit_events requires the actor context for actor-attributed rows.
      await withOwnerContext(
        actorId,
        (tx) => tx`insert into app.audit_events (actor_id, action) values (${actorId}, ${action})`,
      );
      return;
    }
    await sql`insert into app.audit_events (actor_id, action) values (null, ${action})`;
  } catch {
    logEvent('audit_write_failed', { appEnv, status: 500 });
  }
}
