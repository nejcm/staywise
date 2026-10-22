import { createHash, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { z } from 'zod';
import { insertAudit } from '../../lib/audit.server';
import { sql, withOwnerContext } from '../../lib/db.server';
import { serverEnv } from '../../lib/env.server';
import { readBoundedBytes } from '../messages/message-validation';
import { cleanText, mcpResource, mintToken, revokeGrant, tokenDigest } from './agent-auth.server';
import { agentScopes, type AgentScope } from './agent-validation';

const issuer = serverEnv.appOrigin;
export const resourceMetadataUrl = `${issuer}/.well-known/oauth-protected-resource/mcp`;

const clientHosts = new Set(['claude.ai', 'chatgpt.com']);
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
export const clientDocumentLimits = { maxBytes: 5 * 1024, timeoutMs: 3000, maxCacheSeconds: 24 * 60 * 60 } as const;
const codePattern = /^sw_ac_[A-Za-z0-9_-]{43}$/;
const refreshPattern = /^sw_rt_[A-Za-z0-9_-]{43}$/;
const grantTokenPattern = /^sw_(at|rt)_[A-Za-z0-9_-]{43}$/;
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;
const challengePattern = /^[A-Za-z0-9_-]{43}$/;

export const protectedResourceMetadata = () => ({
  resource: mcpResource,
  authorization_servers: [issuer],
  scopes_supported: [...agentScopes],
  bearer_methods_supported: ['header'],
});

export const authorizationServerMetadata = () => ({
  issuer,
  authorization_endpoint: `${issuer}/oauth/authorize`,
  token_endpoint: `${issuer}/oauth/token`,
  revocation_endpoint: `${issuer}/oauth/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  revocation_endpoint_auth_methods_supported: ['none'],
  scopes_supported: [...agentScopes, 'offline_access'],
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
});

export type OAuthClient = { clientId: string; name: string; redirectUris: string[] };

const clientDocument = z.object({
  client_id: z.string(),
  client_name: z.string(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(20),
  token_endpoint_auth_method: z.literal('none').optional(),
});

// Q26: hosted Claude and ChatGPT only; the URL must already be in canonical form so it compares exactly. A query string
// is refused so a parameter-reflecting endpoint on either origin cannot pose as a client document; exact client IDs
// are pinned once the vendors publish theirs.
export function allowedClientId(clientId: string): boolean {
  const url = clientId.length <= 500 ? URL.parse(clientId) : null;
  return (
    url !== null &&
    url.href === clientId &&
    url.protocol === 'https:' &&
    clientHosts.has(url.hostname) &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname !== '/' &&
    url.search === '' &&
    url.hash === ''
  );
}

const clientCache = new Map<string, { client: OAuthClient; until: number }>();

function cacheSeconds(cacheControl: string | null): number {
  if (!cacheControl || /no-store|no-cache/i.test(cacheControl)) return 0;
  const maxAge = Number(/(?:^|[,\s])max-age=(\d+)/i.exec(cacheControl)?.[1] ?? 0);
  return Math.min(maxAge, clientDocumentLimits.maxCacheSeconds);
}

export async function loadClient(clientId: string): Promise<OAuthClient | null> {
  if (!allowedClientId(clientId)) return null;
  const cached = clientCache.get(clientId);
  if (cached && cached.until > Date.now()) return cached.client;
  let response: Response;
  try {
    response = await fetch(clientId, {
      redirect: 'error',
      signal: AbortSignal.timeout(clientDocumentLimits.timeoutMs),
      headers: { accept: 'application/json' },
    });
  } catch {
    return null;
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const body = await readBoundedBytes(response.body, clientDocumentLimits.maxBytes);
  if (body.state !== 'ok') return null;
  let parsed: ReturnType<typeof clientDocument.safeParse>;
  try {
    parsed = clientDocument.safeParse(JSON.parse(new TextDecoder().decode(body.bytes)));
  } catch {
    return null;
  }
  const name = parsed.success ? cleanText(parsed.data.client_name, 100) : '';
  if (!parsed.success || parsed.data.client_id !== clientId || !name) return null;
  const client = { clientId, name, redirectUris: parsed.data.redirect_uris };
  const seconds = cacheSeconds(response.headers.get('cache-control'));
  if (seconds > 0) {
    if (clientCache.size >= 100) clientCache.clear();
    clientCache.set(clientId, { client, until: Date.now() + seconds * 1000 });
  }
  return client;
}

export function isLoopbackRedirect(redirectUri: string): boolean {
  const url = URL.parse(redirectUri);
  return url?.protocol === 'http:' && loopbackHosts.has(url.hostname);
}

// Exact match, except that a loopback redirect may use any port (native clients pick one at run time).
export function redirectAllowed(client: OAuthClient, redirectUri: string): boolean {
  const requested = URL.parse(redirectUri);
  if (!requested || requested.hash || (requested.protocol !== 'https:' && !isLoopbackRedirect(redirectUri))) {
    return false;
  }
  return client.redirectUris.some((listed) => {
    if (listed === redirectUri) return true;
    const candidate = URL.parse(listed);
    return (
      candidate !== null &&
      isLoopbackRedirect(listed) &&
      isLoopbackRedirect(redirectUri) &&
      candidate.hostname === requested.hostname &&
      candidate.pathname === requested.pathname &&
      candidate.search === requested.search
    );
  });
}

function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries({ ...params, iss: issuer })) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  return url.href;
}

export type AuthorizeCheck =
  | { state: 'error'; message: string }
  | { state: 'redirect'; url: string }
  | {
      state: 'ok';
      client: OAuthClient;
      redirectUri: string;
      codeChallenge: string;
      requestedScopes: AgentScope[];
      oauthState: string | undefined;
      denyUrl: string;
    };

// Errors before the redirect URI is verified are shown on the page, never sent to an unverified URI.
export async function checkAuthorizeRequest(params: Record<string, string>): Promise<AuthorizeCheck> {
  const clientId = params.client_id ?? '';
  const redirectUri = params.redirect_uri ?? '';
  const client = await loadClient(clientId);
  if (!client) return { state: 'error', message: 'This app is not one Staywise can connect to.' };
  if (!redirectAllowed(client, redirectUri)) {
    return { state: 'error', message: 'This app asked to return to an address it has not registered.' };
  }
  const oauthState = params.state && params.state.length <= 1000 ? params.state : undefined;
  const fail = (error: string) => ({
    state: 'redirect' as const,
    url: redirectWith(redirectUri, { error, state: oauthState }),
  });
  if (params.response_type !== 'code') return fail('unsupported_response_type');
  if (params.code_challenge_method !== 'S256' || !challengePattern.test(params.code_challenge ?? '')) {
    return fail('invalid_request');
  }
  if (params.resource !== undefined && params.resource !== mcpResource) return fail('invalid_target');
  const asked = (params.scope ?? '').split(' ');
  const requestedScopes = agentScopes.filter((scope) => asked.includes(scope));
  return {
    state: 'ok',
    client,
    redirectUri,
    codeChallenge: params.code_challenge!,
    requestedScopes: requestedScopes.length ? requestedScopes : ['read'],
    oauthState,
    denyUrl: redirectWith(redirectUri, { error: 'access_denied', state: oauthState }),
  };
}

export const consentInput = z.object({
  scopes: z
    .array(z.enum(agentScopes))
    .min(1)
    .transform((scopes) => [...new Set(scopes)]),
  propertyId: z.uuid().nullable(),
});

// Q27: the grant ends 90 days after consent; the code lasts 60 seconds. Both expiries come from SQL.
// A new consent supersedes the client's earlier grants, so a step-up never leaves the old scopes live.
export async function approveAuthorization(
  tx: postgres.TransactionSql,
  ownerId: string,
  request: Extract<AuthorizeCheck, { state: 'ok' }>,
  consent: z.infer<typeof consentInput>,
): Promise<string> {
  const earlier = await tx<{ id: string }[]>`
    select id from app.agent_grants
    where owner_id = ${ownerId} and kind = 'oauth' and client_id = ${request.client.clientId} and revoked_at is null
  `;
  for (const { id } of earlier) await revokeGrant(tx, ownerId, id);
  const [grant] = await tx<{ id: string }[]>`
    insert into app.agent_grants (owner_id, kind, name, client_id, resource, scopes, property_id, expires_at)
    values (${ownerId}, 'oauth', ${request.client.name}, ${request.client.clientId}, ${mcpResource}, ${consent.scopes},
      ${consent.propertyId}, now() + interval '90 days')
    returning id
  `;
  const code = mintToken('ac');
  await tx`
    insert into app.agent_grant_tokens (token_hash, grant_id, kind, expires_at, code_challenge, redirect_uri)
    values (${code.digest}, ${grant!.id}, 'code', now() + interval '60 seconds', ${request.codeChallenge}, ${request.redirectUri})
  `;
  await insertAudit(tx, ownerId, 'agent_grant_created', grant!.id);
  return redirectWith(request.redirectUri, { code: code.token, state: request.oauthState });
}

type TokenBody = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};
export type TokenResult =
  | { status: 200; body: TokenBody }
  | { status: 400; body: { error: string; error_description?: string } };

const oauthError = (error: string, description?: string): TokenResult => ({
  status: 400,
  body: description ? { error, error_description: description } : { error },
});
const invalidGrant = oauthError('invalid_grant');

function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const stored = Buffer.from(challenge);
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

async function tokenOwner(digest: Buffer): Promise<string | null> {
  const [row] = await sql<{ owner_id: string | null }[]>`select app.agent_grant_token_owner(${digest}) as owner_id`;
  return row?.owner_id ?? null;
}

// Access lasts 1 hour and refresh 30 days, neither beyond the grant's own end (Q27).
async function issueTokens(tx: postgres.TransactionSql, grantId: string, scopes: AgentScope[]): Promise<TokenResult> {
  const access = mintToken('at');
  const refresh = mintToken('rt');
  const [issued] = await tx<{ expires_in: number }[]>`
    with grant_end as (select expires_at from app.agent_grants where id = ${grantId}),
    refreshed as (
      insert into app.agent_grant_tokens (token_hash, grant_id, kind, expires_at)
      select ${refresh.digest}, ${grantId}, 'refresh', least(now() + interval '30 days', expires_at) from grant_end
    )
    insert into app.agent_grant_tokens (token_hash, grant_id, kind, expires_at)
    select ${access.digest}, ${grantId}, 'access', least(now() + interval '1 hour', expires_at) from grant_end
    returning floor(extract(epoch from expires_at - now()))::int as expires_in
  `;
  return {
    status: 200,
    body: {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: issued!.expires_in,
      refresh_token: refresh.token,
      scope: scopes.join(' '),
    },
  };
}

type GrantTokenRow = {
  kind: 'code' | 'access' | 'refresh';
  used: boolean;
  live: boolean;
  active: boolean;
  code_challenge: string | null;
  redirect_uri: string | null;
  grant_id: string;
  client_id: string;
  scopes: AgentScope[];
};

// The row lock serializes concurrent redemptions, so the second use of a code or refresh token is always seen.
async function lockGrantToken(tx: postgres.TransactionSql, digest: Buffer): Promise<GrantTokenRow | undefined> {
  const [row] = await tx<GrantTokenRow[]>`
    select t.kind, t.used_at is not null as used, t.expires_at > now() as live,
      g.revoked_at is null and g.expires_at > now() as active,
      t.code_challenge, t.redirect_uri, g.id as grant_id, g.client_id, g.scopes
    from app.agent_grant_tokens t
    join app.agent_grants g on g.id = t.grant_id
    where t.token_hash = ${digest}
    for update of t
  `;
  return row;
}

// Reuse of a spent code or refresh token means one copy leaked, so the whole grant ends (Q27).
async function redeem(
  digest: Buffer,
  kind: 'code' | 'refresh',
  accept: (row: GrantTokenRow) => TokenResult | null,
): Promise<TokenResult> {
  const ownerId = await tokenOwner(digest);
  if (!ownerId) return invalidGrant;
  return withOwnerContext(ownerId, async (tx) => {
    const row = await lockGrantToken(tx, digest);
    if (!row || row.kind !== kind) return invalidGrant;
    if (row.used) {
      await revokeGrant(tx, ownerId, row.grant_id);
      return invalidGrant;
    }
    if (!row.live || !row.active) return invalidGrant;
    const refused = accept(row);
    if (refused) return refused;
    await tx`update app.agent_grant_tokens set used_at = now() where token_hash = ${digest}`;
    return issueTokens(tx, row.grant_id, row.scopes);
  });
}

export async function exchangeToken(form: URLSearchParams): Promise<TokenResult> {
  if ([...new Set(form.keys())].some((name) => form.getAll(name).length > 1)) return oauthError('invalid_request');
  const resource = form.get('resource');
  if (resource !== null && resource !== mcpResource) return oauthError('invalid_target');
  const clientId = form.get('client_id');
  const grantType = form.get('grant_type');
  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const verifier = form.get('code_verifier');
    const redirectUri = form.get('redirect_uri');
    if (!code || !verifier || !redirectUri || !clientId) return oauthError('invalid_request');
    if (!codePattern.test(code) || !verifierPattern.test(verifier)) return invalidGrant;
    return redeem(tokenDigest(code), 'code', (row) =>
      row.client_id === clientId && row.redirect_uri === redirectUri && pkceMatches(verifier, row.code_challenge ?? '')
        ? null
        : invalidGrant,
    );
  }
  if (grantType === 'refresh_token') {
    const token = form.get('refresh_token');
    if (!token || !clientId) return oauthError('invalid_request');
    if (!refreshPattern.test(token)) return invalidGrant;
    const asked =
      form
        .get('scope')
        ?.split(' ')
        .filter((scope) => scope && scope !== 'offline_access') ?? [];
    return redeem(tokenDigest(token), 'refresh', (row) => {
      if (row.client_id !== clientId) return invalidGrant;
      return asked.every((scope) => (row.scopes as string[]).includes(scope)) ? null : oauthError('invalid_scope');
    });
  }
  return oauthError('unsupported_grant_type');
}

// RFC 7009: always succeeds from the caller's view; revoking either token ends the whole grant.
export async function revokeOAuthToken(form: URLSearchParams): Promise<void> {
  const token = form.get('token');
  if (!token || !grantTokenPattern.test(token)) return;
  const digest = tokenDigest(token);
  const ownerId = await tokenOwner(digest);
  if (!ownerId) return;
  const clientId = form.get('client_id');
  await withOwnerContext(ownerId, async (tx) => {
    const row = await lockGrantToken(tx, digest);
    if (row && row.kind !== 'code' && (clientId === null || clientId === row.client_id)) {
      await revokeGrant(tx, ownerId, row.grant_id);
    }
  });
}

const noStore = { 'cache-control': 'no-store', pragma: 'no-cache' };
const FORM_MAX = 8 * 1024;

export const postOnly = () => new Response(null, { status: 405, headers: { allow: 'POST', ...noStore } });

export function oauthJson(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}

export function metadataResponse(metadata: () => object): Response {
  if (serverEnv.agentAccessDisabled) return new Response(null, { status: 404, headers: noStore });
  return Response.json(metadata(), {
    headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' },
  });
}

export async function readForm(request: Request): Promise<URLSearchParams | null> {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return null;
  const body = await readBoundedBytes(request.body, FORM_MAX);
  return body.state === 'ok' ? new URLSearchParams(new TextDecoder().decode(body.bytes)) : null;
}
