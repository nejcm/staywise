// Agent OAuth against the local stack and dev server; consent is approved in-process (no browser AAL2 session)
// with the client document fetch stubbed, so nothing leaves the machine. Synthetic data only.
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpResource, readActiveGrants, tokenDigest } from '../features/agent/agent-auth.server';
import { approveAuthorization, checkAuthorizeRequest } from '../features/agent/oauth.server';
import { sql, withOwnerContext } from '../lib/db.server';
import {
  APP,
  adminClient,
  detectDevServer,
  detectLocalDb,
  detectLocalStack,
  localAdmin,
  type LocalStack,
} from './integration-helpers';

const localStack = detectLocalStack();
const localDbUp = await detectLocalDb();
const devServerUp = await detectDevServer();
const describeLocal = localStack && localDbUp && devServerUp && mcpResource === `${APP}/mcp` ? describe : describe.skip;

const realFetch = globalThis.fetch;
const clientId = 'https://claude.ai/oauth/synthetic-staywise-integration.json';
const redirectUri = 'http://127.0.0.1:4711/callback';

type Tokens = { access_token: string; refresh_token: string; expires_in: number; scope: string; token_type: string };
type Grant = { code: string; verifier: string };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === clientId
        ? Response.json({
            client_id: clientId,
            client_name: 'Synthetic Claude',
            redirect_uris: ['http://127.0.0.1/callback'],
          })
        : realFetch(input, init),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await sql.end({ timeout: 0 });
});

async function approve(ownerId: string, scope = 'read', propertyId: string | null = null): Promise<Grant> {
  const verifier = randomBytes(32).toString('base64url');
  const request = await checkAuthorizeRequest({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'synthetic-state',
    resource: mcpResource,
    scope,
  });
  if (request.state !== 'ok') throw new Error('synthetic authorize request refused');
  const url = new URL(
    await withOwnerContext(ownerId, (tx) =>
      approveAuthorization(tx, ownerId, request, { scopes: request.requestedScopes, propertyId }),
    ),
  );
  expect(url.searchParams.get('iss')).toBe(new URL(APP).origin);
  expect(url.searchParams.get('state')).toBe('synthetic-state');
  return { code: url.searchParams.get('code') ?? '', verifier };
}

async function token(fields: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await realFetch(`${APP}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...fields }),
  });
  expect(response.headers.get('cache-control')).toBe('no-store');
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const exchange = (grant: Grant, extra: Record<string, string> = {}) =>
  token({
    grant_type: 'authorization_code',
    code: grant.code,
    code_verifier: grant.verifier,
    redirect_uri: redirectUri,
    resource: mcpResource,
    ...extra,
  });

const refresh = (refreshToken: string, extra: Record<string, string> = {}) =>
  token({ grant_type: 'refresh_token', refresh_token: refreshToken, resource: mcpResource, ...extra });

async function mcp(accessToken: string, method: string, params?: unknown) {
  return realFetch(`${APP}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

async function grantRevoked(code: string): Promise<boolean> {
  const admin = localAdmin();
  try {
    const [row] = await admin<{ revoked: boolean }[]>`
      select g.revoked_at is not null as revoked from app.agent_grant_tokens t
      join app.agent_grants g on g.id = t.grant_id where t.token_hash = ${tokenDigest(code)}
    `;
    return row?.revoked ?? false;
  } finally {
    await admin.end({ timeout: 0 });
  }
}

describeLocal('agent OAuth against the local stack', () => {
  it('runs code, token, /mcp, step-up, refresh rotation and refresh reuse end to end', async () => {
    const local = localStack as LocalStack;
    const ownerId = await adminClient(local).createUser(`synthetic-oauth-flow-${Date.now()}@example.test`);
    try {
      const grant = await approve(ownerId);
      expect(await withOwnerContext(ownerId, readActiveGrants)).toEqual([]);

      const first = await exchange(grant);
      expect(first.status).toBe(200);
      const tokens = first.body as Tokens;
      expect(tokens).toMatchObject({ token_type: 'Bearer', scope: 'read' });
      expect(tokens.access_token).toMatch(/^sw_at_/);
      expect(tokens.refresh_token).toMatch(/^sw_rt_/);
      expect(tokens.expires_in).toBeGreaterThan(3500);
      expect(tokens.expires_in).toBeLessThanOrEqual(3600);

      const listed = await withOwnerContext(ownerId, readActiveGrants);
      expect(listed).toMatchObject([
        { kind: 'oauth', clientHost: 'claude.ai', name: 'Synthetic Claude', scopes: ['read'] },
      ]);

      expect((await mcp(tokens.access_token, 'tools/call', { name: 'list_properties', arguments: {} })).status).toBe(
        200,
      );
      const stepUp = await mcp(tokens.access_token, 'tools/call', { name: 'mark_inbox_handled', arguments: {} });
      expect(stepUp.status).toBe(403);
      expect(stepUp.headers.get('www-authenticate')).toContain('error="insufficient_scope", scope="inbox:write"');

      expect((await refresh(tokens.refresh_token, { scope: 'read inbox:write' })).body).toEqual({
        error: 'invalid_scope',
      });
      const rotated = await refresh(tokens.refresh_token, { scope: 'read offline_access' });
      expect(rotated.status).toBe(200);
      const next = rotated.body as Tokens;
      expect(next.refresh_token).not.toBe(tokens.refresh_token);
      expect((await mcp(next.access_token, 'tools/list')).status).toBe(200);

      expect(await refresh(tokens.refresh_token)).toEqual({ status: 400, body: { error: 'invalid_grant' } });
      expect(await grantRevoked(grant.code)).toBe(true);
      const dead = await mcp(next.access_token, 'tools/list');
      expect(dead.status).toBe(401);
      expect(dead.headers.get('www-authenticate')).toContain('resource_metadata="');
      expect(await refresh(next.refresh_token)).toEqual({ status: 400, body: { error: 'invalid_grant' } });
      expect(await withOwnerContext(ownerId, readActiveGrants)).toEqual([]);
    } finally {
      await adminClient(local).deleteUser(ownerId);
    }
  });

  it('binds a code to its verifier, redirect, client and resource, and lets it be used once', async () => {
    const local = localStack as LocalStack;
    const ownerId = await adminClient(local).createUser(`synthetic-oauth-code-${Date.now()}@example.test`);
    try {
      const grant = await approve(ownerId);
      const refused = { status: 400, body: { error: 'invalid_grant' } };
      expect(await exchange(grant, { code_verifier: randomBytes(32).toString('base64url') })).toEqual(refused);
      expect(await exchange(grant, { redirect_uri: 'http://127.0.0.1:4712/callback' })).toEqual(refused);
      expect(await exchange(grant, { client_id: 'https://chatgpt.com/oauth/synthetic.json' })).toEqual(refused);
      expect(await exchange(grant, { resource: 'https://other.example/mcp' })).toEqual({
        status: 400,
        body: { error: 'invalid_target' },
      });

      const issued = await exchange(grant);
      expect(issued.status).toBe(200);
      expect(await exchange(grant)).toEqual(refused);
      expect(await grantRevoked(grant.code)).toBe(true);
      expect((await mcp((issued.body as Tokens).access_token, 'tools/list')).status).toBe(401);

      const expired = await approve(ownerId);
      const admin = localAdmin();
      try {
        await admin`update app.agent_grant_tokens set expires_at = now() - interval '1 second'
          where token_hash = ${tokenDigest(expired.code)}`;
      } finally {
        await admin.end({ timeout: 0 });
      }
      expect(await exchange(expired)).toEqual(refused);
    } finally {
      await adminClient(local).deleteUser(ownerId);
    }
  });

  it("supersedes the client's earlier grant on a new consent, so a step-up leaves one live grant", async () => {
    const local = localStack as LocalStack;
    const ownerId = await adminClient(local).createUser(`synthetic-oauth-supersede-${Date.now()}@example.test`);
    try {
      const first = await approve(ownerId);
      const old = (await exchange(first)).body as Tokens;
      const second = await approve(ownerId, 'read inbox:write');
      expect(await grantRevoked(first.code)).toBe(true);
      expect((await mcp(old.access_token, 'tools/list')).status).toBe(401);
      const stepped = (await exchange(second)).body as Tokens;
      expect(stepped.scope).toBe('read inbox:write');
      expect(await withOwnerContext(ownerId, readActiveGrants)).toMatchObject([{ scopes: ['read', 'inbox:write'] }]);
    } finally {
      await adminClient(local).deleteUser(ownerId);
    }
  });

  it('answers GET on the token and revoke endpoints with 405', async () => {
    for (const path of ['/oauth/token', '/oauth/revoke']) {
      const response = await realFetch(`${APP}${path}`);
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
  });

  it('resolves an access token only for this resource, and revoke ends the whole grant', async () => {
    const local = localStack as LocalStack;
    const ownerId = await adminClient(local).createUser(`synthetic-oauth-revoke-${Date.now()}@example.test`);
    try {
      const tokens = (await exchange(await approve(ownerId))).body as Tokens;
      const digest = tokenDigest(tokens.access_token);
      expect(
        await sql`select * from app.resolve_agent_access_token(${digest}, 'https://other.example/mcp')`,
      ).toHaveLength(0);
      expect(await sql`select * from app.resolve_agent_access_token(${digest}, ${mcpResource})`).toHaveLength(1);

      const revoke = (value: string, client = clientId) =>
        realFetch(`${APP}/oauth/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: value, client_id: client }),
        });
      expect((await revoke(tokens.refresh_token, 'https://chatgpt.com/oauth/synthetic.json')).status).toBe(200);
      expect((await mcp(tokens.access_token, 'tools/list')).status).toBe(200);
      expect((await revoke(tokens.refresh_token)).status).toBe(200);
      expect((await mcp(tokens.access_token, 'tools/list')).status).toBe(401);
      expect((await revoke(`sw_rt_${'A'.repeat(43)}`)).status).toBe(200);
    } finally {
      await adminClient(local).deleteUser(ownerId);
    }
  });
});
