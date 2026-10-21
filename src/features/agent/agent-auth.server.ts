import { createHash, createHmac, randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { sql, withOwnerContext } from '../../lib/db.server';
import { serverEnv } from '../../lib/env.server';
import { utcWindow } from '../guest/guest-counters.server';
import type { AgentScope, grantLifetimes } from './agent-validation';

export type AgentPrincipal = { grantId: string; ownerId: string; scopes: AgentScope[]; propertyId: string | null };

const personalTokenPattern = /^sw_pat_[A-Za-z0-9_-]{43}$/;
const lastUsedEveryMs = 10 * 60 * 1000;
export const agentLimits = { perToken: 60, perHost: 120, windowSeconds: 60 } as const;

const tokenDigest = (token: string) => createHash('sha256').update(token).digest();

export function mintPersonalToken(): { token: string; digest: Buffer } {
  const token = `sw_pat_${randomBytes(32).toString('base64url')}`;
  return { token, digest: tokenDigest(token) };
}

export function bearerToken(authorization: string | null): string | null {
  return /^Bearer ([^\s]+)$/i.exec(authorization ?? '')?.[1] ?? null;
}

// Strips control, format (bidi, zero-width) and line-separator characters before a code-point cap.
export function cleanText(value: string, max: number): string {
  return [...value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')].slice(0, max).join('').trim();
}

// The lookup keys on the SHA-256 of a 256-bit secret, so index timing cannot leak the token itself.
export async function resolveAgentToken(
  token: string | null,
  userAgent: string | null,
): Promise<AgentPrincipal | null> {
  if (serverEnv.agentAccessDisabled || !token || !personalTokenPattern.test(token)) return null;
  const [row] = await sql<
    {
      grant_id: string;
      owner_id: string;
      scopes: AgentScope[];
      property_id: string | null;
      last_used_at: Date | null;
    }[]
  >`select grant_id, owner_id, scopes, property_id, last_used_at from app.resolve_agent_token(${tokenDigest(token)})`;
  if (!row) return null;
  if (!row.last_used_at || Date.now() - row.last_used_at.getTime() >= lastUsedEveryMs) {
    const label = userAgent ? cleanText(userAgent, 100) || null : null;
    await withOwnerContext(
      row.owner_id,
      (tx) => tx`
        update app.agent_grants set last_used_at = now(), client_label = coalesce(${label}, client_label)
        where id = ${row.grant_id}
      `,
    );
  }
  return { grantId: row.grant_id, ownerId: row.owner_id, scopes: row.scopes, propertyId: row.property_id };
}

const limitKey = (scope: string, id: string) =>
  createHmac('sha256', serverEnv.shareHmacKey).update(`agent:${scope}:${id}`).digest();

// Tenantless HMAC windows share auth_rate_limits and its daily purge; narrowest first, like OTP sends.
export async function agentRequestAllowed(principal: AgentPrincipal): Promise<boolean> {
  const window = utcWindow(agentLimits.windowSeconds);
  return sql.begin(async (tx) => {
    const bump = async (key: Buffer) => {
      const [row] = await tx<{ count: number }[]>`
        insert into app.auth_rate_limits (key_hash, window_start, count) values (${key}, ${window}, 1)
        on conflict (key_hash, window_start) do update set count = app.auth_rate_limits.count + 1
        returning count
      `;
      return row?.count ?? Number.MAX_SAFE_INTEGER;
    };
    if ((await bump(limitKey('token', principal.grantId))) > agentLimits.perToken) return false;
    return (await bump(limitKey('host', principal.ownerId))) <= agentLimits.perHost;
  });
}

export type AgentGrantSummary = {
  id: string;
  name: string;
  scopes: AgentScope[];
  propertyName: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  clientLabel: string | null;
};

export async function readActiveGrants(tx: postgres.TransactionSql): Promise<AgentGrantSummary[]> {
  const rows = await tx<
    {
      id: string;
      name: string;
      scopes: AgentScope[];
      property_name: string | null;
      created_at: Date;
      expires_at: Date;
      last_used_at: Date | null;
      client_label: string | null;
    }[]
  >`
    select g.id, g.name, g.scopes, p.display_name as property_name, g.created_at, g.expires_at, g.last_used_at, g.client_label
    from app.agent_grants g
    left join app.properties p on p.id = g.property_id
    where g.revoked_at is null and g.expires_at > now()
    order by g.created_at desc
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    scopes: row.scopes,
    propertyName: row.property_name,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    clientLabel: row.client_label,
  }));
}

export async function createPersonalGrant(
  tx: postgres.TransactionSql,
  ownerId: string,
  input: { name: string; scopes: AgentScope[]; propertyId: string | null; days: (typeof grantLifetimes)[number] },
): Promise<{ id: string; token: string }> {
  const { token, digest } = mintPersonalToken();
  const [row] = await tx<{ id: string }[]>`
    insert into app.agent_grants (owner_id, kind, name, scopes, property_id, token_hash, expires_at)
    values (${ownerId}, 'pat', ${input.name}, ${input.scopes}, ${input.propertyId}, ${digest},
      now() + make_interval(days => ${input.days}))
    returning id
  `;
  await tx`insert into app.audit_events (actor_id, action, grant_id) values (${ownerId}, 'agent_grant_created', ${row!.id})`;
  return { id: row!.id, token };
}

export async function revokeGrant(tx: postgres.TransactionSql, ownerId: string, grantId: string): Promise<boolean> {
  const rows =
    await tx`update app.agent_grants set revoked_at = now() where id = ${grantId} and revoked_at is null returning id`;
  if (!rows.length) return false;
  await tx`insert into app.audit_events (actor_id, action, grant_id) values (${ownerId}, 'agent_grant_revoked', ${grantId})`;
  return true;
}

export async function revokeAllGrants(tx: postgres.TransactionSql, ownerId: string): Promise<number> {
  const rows = await tx`update app.agent_grants set revoked_at = now() where revoked_at is null returning id`;
  await tx`insert into app.audit_events (actor_id, action) values (${ownerId}, 'agent_grants_revoked_all')`;
  return rows.length;
}
