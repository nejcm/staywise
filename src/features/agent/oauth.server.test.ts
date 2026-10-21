import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../../lib/env.server';
import { mcpResource } from './agent-auth.server';
import {
  allowedClientId,
  authorizationServerMetadata,
  checkAuthorizeRequest,
  clientDocumentLimits,
  exchangeToken,
  loadClient,
  protectedResourceMetadata,
  readForm,
  redirectAllowed,
  type OAuthClient,
} from './oauth.server';

let clientSeq = 0;
const nextClientId = () => `https://claude.ai/oauth/synthetic-client-${(clientSeq += 1)}.json`;
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function document(clientId: string, extra: Record<string, unknown> = {}) {
  return {
    client_id: clientId,
    client_name: 'Synthetic Claude',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    ...extra,
  };
}

function serve(body: unknown, init: ResponseInit = {}) {
  const fetchMock = vi.fn(
    async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OAuth metadata', () => {
  it('names this resource and issuer, S256 only, CIMD and iss supported, no registration endpoint', () => {
    expect(protectedResourceMetadata()).toEqual({
      resource: mcpResource,
      authorization_servers: [serverEnv.appOrigin],
      scopes_supported: ['read', 'content:write', 'reservations:write', 'inbox:write'],
      bearer_methods_supported: ['header'],
    });
    const metadata = authorizationServerMetadata();
    expect(metadata).toMatchObject({
      issuer: serverEnv.appOrigin,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(metadata.scopes_supported).toContain('offline_access');
    expect(metadata).not.toHaveProperty('registration_endpoint');
  });
});

describe('allowedClientId', () => {
  it.each(['https://claude.ai/oauth/client.json', 'https://chatgpt.com/oauth/client'])('accepts %s', (id) => {
    expect(allowedClientId(id)).toBe(true);
  });

  it.each([
    'http://claude.ai/oauth/client.json',
    'https://evil.example/oauth/client.json',
    'https://claude.ai.evil.example/client',
    'https://sub.claude.ai/client',
    'https://claude.ai/',
    'https://claude.ai',
    'https://claude.ai:8443/client',
    'https://user@claude.ai/client',
    'https://CLAUDE.ai/client',
    'https://claude.ai/a/../client',
    'https://claude.ai/client#frag',
    `https://claude.ai/${'x'.repeat(500)}`,
    'not a url',
  ])('refuses %s', (id) => {
    expect(allowedClientId(id)).toBe(false);
  });
});

describe('redirectAllowed', () => {
  const client: OAuthClient = {
    clientId: 'https://claude.ai/oauth/client.json',
    name: 'Synthetic',
    redirectUris: [
      'https://claude.ai/api/mcp/auth_callback',
      'http://127.0.0.1:33418/callback',
      'http://localhost/cb?x=1',
      'http://[::1]/native',
    ],
  };

  it('matches exactly, and loopback on any port with the same host, path and query', () => {
    expect(redirectAllowed(client, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectAllowed(client, 'http://127.0.0.1:51000/callback')).toBe(true);
    expect(redirectAllowed(client, 'http://localhost:9/cb?x=1')).toBe(true);
    expect(redirectAllowed(client, 'http://[::1]:5000/native')).toBe(true);
  });

  it.each([
    'https://claude.ai/api/mcp/auth_callback/',
    'https://claude.ai/api/mcp/auth_callback#x',
    'https://claude.ai/api/mcp/other',
    'http://claude.ai/api/mcp/auth_callback',
    'http://localhost:51000/callback',
    'http://127.0.0.1:51000/other',
    'http://localhost/cb?x=2',
    'https://127.0.0.1/callback',
  ])('refuses %s', (uri) => {
    expect(redirectAllowed(client, uri)).toBe(false);
  });
});

describe('loadClient', () => {
  it('fetches without following redirects, under the timeout, and returns the cleaned client', async () => {
    const id = nextClientId();
    const fetchMock = serve(document(id, { client_name: 'Synthetic‮ Claude' }));
    expect(await loadClient(id)).toEqual({
      clientId: id,
      name: 'Synthetic Claude',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    });
    expect(fetchMock).toHaveBeenCalledWith(id, expect.objectContaining({ redirect: 'error' }));
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('never fetches a client id outside the allowlist', async () => {
    const fetchMock = serve(document('https://evil.example/c'));
    expect(await loadClient('https://evil.example/c')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a document whose client_id differs from its URL', async () => {
    const id = nextClientId();
    serve(document(`${id}x`));
    expect(await loadClient(id)).toBeNull();
  });

  it('refuses an oversized, malformed, non-200, redirected or timed-out document', async () => {
    const id = nextClientId();
    serve(document(id, { padding: 'x'.repeat(clientDocumentLimits.maxBytes) }));
    expect(await loadClient(id)).toBeNull();
    serve('{not json');
    expect(await loadClient(id)).toBeNull();
    serve(document(id, { redirect_uris: [] }));
    expect(await loadClient(id)).toBeNull();
    serve(document(id, { token_endpoint_auth_method: 'client_secret_basic' }));
    expect(await loadClient(id)).toBeNull();
    serve(document(id), { status: 404 });
    expect(await loadClient(id)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('redirect mode is set to error'))),
    );
    expect(await loadClient(id)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new DOMException('timed out', 'TimeoutError'))),
    );
    expect(await loadClient(id)).toBeNull();
  });

  it('caches by max-age and not at all on no-store', async () => {
    const cached = nextClientId();
    const cachedFetch = serve(document(cached), { headers: { 'cache-control': 'public, max-age=600' } });
    await loadClient(cached);
    await loadClient(cached);
    expect(cachedFetch).toHaveBeenCalledTimes(1);

    const uncached = nextClientId();
    const uncachedFetch = serve(document(uncached), { headers: { 'cache-control': 'no-store, max-age=600' } });
    await loadClient(uncached);
    await loadClient(uncached);
    expect(uncachedFetch).toHaveBeenCalledTimes(2);
  });
});

describe('checkAuthorizeRequest', () => {
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
  const valid = (clientId: string, extra: Record<string, string> = {}) => ({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'synthetic-state',
    resource: mcpResource,
    scope: 'read inbox:write offline_access bogus',
    ...extra,
  });

  it('accepts a full request and keeps only known scopes', async () => {
    const id = nextClientId();
    serve(document(id), { headers: { 'cache-control': 'max-age=60' } });
    const check = await checkAuthorizeRequest(valid(id));
    expect(check).toMatchObject({
      state: 'ok',
      redirectUri,
      codeChallenge: challenge,
      requestedScopes: ['read', 'inbox:write'],
    });
    const deny = new URL(check.state === 'ok' ? check.denyUrl : '');
    expect(Object.fromEntries(deny.searchParams)).toEqual({
      error: 'access_denied',
      state: 'synthetic-state',
      iss: serverEnv.appOrigin,
    });
  });

  it('shows an unknown client or unregistered redirect on the page, never redirecting', async () => {
    const id = nextClientId();
    serve(document(id), { headers: { 'cache-control': 'max-age=60' } });
    expect((await checkAuthorizeRequest(valid('https://evil.example/c'))).state).toBe('error');
    expect((await checkAuthorizeRequest(valid(id, { redirect_uri: 'https://evil.example/cb' }))).state).toBe('error');
  });

  it.each([
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ code_challenge: 'short' }, 'invalid_request'],
    [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
  ])('redirects %j back with %s and iss', async (extra, error) => {
    const id = nextClientId();
    serve(document(id), { headers: { 'cache-control': 'max-age=60' } });
    const check = await checkAuthorizeRequest(valid(id, extra));
    expect(check.state).toBe('redirect');
    const url = new URL(check.state === 'redirect' ? check.url : '');
    expect(url.origin + url.pathname).toBe(redirectUri);
    expect(Object.fromEntries(url.searchParams)).toEqual({ error, state: 'synthetic-state', iss: serverEnv.appOrigin });
  });

  it('defaults to read when no known scope is asked', async () => {
    const id = nextClientId();
    serve(document(id), { headers: { 'cache-control': 'max-age=60' } });
    const { resource: _resource, scope: _scope, ...rest } = valid(id);
    expect(await checkAuthorizeRequest(rest)).toMatchObject({ state: 'ok', requestedScopes: ['read'] });
  });
});

describe('exchangeToken input checks', () => {
  const form = (entries: [string, string][]) => new URLSearchParams(entries);

  it.each([
    [[['grant_type', 'password']], 'unsupported_grant_type'],
    [[['grant_type', 'authorization_code']], 'invalid_request'],
    [
      [
        ['grant_type', 'refresh_token'],
        ['refresh_token', 'x'],
      ],
      'invalid_request',
    ],
    [
      [
        ['grant_type', 'authorization_code'],
        ['grant_type', 'authorization_code'],
      ],
      'invalid_request',
    ],
    [
      [
        ['grant_type', 'refresh_token'],
        ['resource', 'https://other.example/mcp'],
      ],
      'invalid_target',
    ],
    [
      [
        ['grant_type', 'authorization_code'],
        ['code', 'sw_ac_short'],
        ['code_verifier', 'v'.repeat(43)],
        ['redirect_uri', 'https://claude.ai/cb'],
        ['client_id', 'https://claude.ai/c'],
      ],
      'invalid_grant',
    ],
  ] as [[string, string][], string][])('answers %j with %s before any lookup', async (entries, error) => {
    expect(await exchangeToken(form(entries))).toEqual({ status: 400, body: { error } });
  });
});

describe('readForm', () => {
  const post = (body: string, type = 'application/x-www-form-urlencoded') =>
    new Request('http://localhost/oauth/token', { method: 'POST', headers: { 'content-type': type }, body });

  it('reads a small form and refuses JSON or an oversized body', async () => {
    expect((await readForm(post('grant_type=refresh_token')))?.get('grant_type')).toBe('refresh_token');
    expect(await readForm(post('{}', 'application/json'))).toBeNull();
    expect(await readForm(post(`x=${'y'.repeat(9 * 1024)}`))).toBeNull();
  });
});
