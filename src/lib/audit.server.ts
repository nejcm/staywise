import type postgres from 'postgres';
import { sql } from './db.server';
import { withOwnerContext } from './db.server';
import { appEnv } from './env.server';
import { logEvent } from './log.server';

const auditActions = [
  'sign_in',
  'callback_failure',
  'mfa_enrolled',
  'mfa_unenrolled',
  'mfa_verified',
  'publish',
  'unpublish',
  'link_created',
  'link_rotated',
  'link_disabled',
  'translation_generated',
  'translation_approved',
  'translation_rejected',
  'message_handled',
  'message_tagged',
  'message_deleted',
  'delete',
  'account_deleted',
  'stay_link_created',
  'stay_link_revoked',
  'agent_tool_call',
  'agent_grant_created',
  'agent_grant_revoked',
  'agent_grants_revoked_all',
] as const;
export type AuditAction = (typeof auditActions)[number];

// Same-transaction audit append for security-critical writes: a failure must abort the caller so
// the state change and its audit record commit or roll back together.
export async function insertAudit(
  tx: postgres.TransactionSql,
  actorId: string,
  action: AuditAction,
  grantId: string | null = null,
): Promise<void> {
  await tx`insert into app.audit_events (actor_id, action, grant_id) values (${actorId}, ${action}, ${grantId})`;
}

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
