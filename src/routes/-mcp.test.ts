import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentFailuresExceeded,
  agentRequestAllowed,
  recordAgentFailure,
  resolveAgentToken,
  type AgentPrincipal,
} from '../features/agent/agent-auth.server';
import { serverEnv } from '../lib/env.server';
import { Route } from './mcp';

vi.mock('../features/agent/agent-auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/agent/agent-auth.server')>()),
  resolveAgentToken: vi.fn(),
  agentRequestAllowed: vi.fn(),
  agentFailuresExceeded: vi.fn(),
  recordAgentFailure: vi.fn(),
}));

type Handler = (ctx: { request: Request }) => Promise<Response> | Response;
const { POST, GET, DELETE } = (
  Route.options as unknown as { server: { handlers: { POST: Handler; GET: Handler; DELETE: Handler } } }
).server.handlers;

const token = `sw_pat_${'A'.repeat(43)}`;
const host = new URL(serverEnv.appOrigin).host;
const principal: AgentPrincipal = {
  grantId: '00000000-0000-4000-8000-000000000001',
  ownerId: '00000000-0000-4000-8000-000000000002',
  scopes: ['read'],
  propertyId: null,
};

function rpc(method: string, params?: unknown, headers: Record<string, string> = {}, raw?: string) {
  return POST({
    request: new Request(`${serverEnv.appOrigin}/mcp`, {
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        authorization: `Bearer ${token}`,
        ...headers,
      },
      body: raw ?? JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  });
}

async function rpcResult(response: Response): Promise<{ result?: Record<string, unknown> }> {
  const text = await response.text();
  const data = text.startsWith('{') ? text : (/^data: (.*)$/m.exec(text)?.[1] ?? '{}');
  return JSON.parse(data) as { result?: Record<string, unknown> };
}

const initialize = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'unit', version: '0' },
};

let logs: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(resolveAgentToken).mockReset().mockResolvedValue(principal);
  vi.mocked(agentRequestAllowed).mockReset().mockResolvedValue(true);
  vi.mocked(agentFailuresExceeded).mockReset().mockResolvedValue(false);
  vi.mocked(recordAgentFailure).mockReset().mockResolvedValue();
  logs = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('/mcp boundary', () => {
  it.each([
    ['a foreign Origin', { origin: 'https://evil.example' }],
    ['a null Origin', { origin: 'null' }],
    ['a foreign Host', { host: 'evil.example' }],
  ])('rejects %s with 403 before any token lookup', async (_label, headers) => {
    const response = await rpc('initialize', initialize, headers);
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(resolveAgentToken).not.toHaveBeenCalled();
  });

  it('accepts the app origin itself', async () => {
    expect((await rpc('initialize', initialize, { origin: serverEnv.appOrigin })).status).toBe(200);
  });

  it('answers a missing, bad, expired or revoked token with 401 invalid_token', async () => {
    vi.mocked(resolveAgentToken).mockResolvedValue(null);
    const response = await rpc('initialize', initialize, { authorization: '' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    expect(await response.json()).toEqual({ error: 'invalid_token' });
    expect(resolveAgentToken).toHaveBeenCalledWith(null, null);
    expect(agentRequestAllowed).not.toHaveBeenCalled();
    expect(recordAgentFailure).toHaveBeenCalledWith(null);
  });

  it('counts failures per client IP and answers 429 before any lookup once spent', async () => {
    const ip = { 'x-nf-client-connection-ip': '203.0.113.7' };
    vi.mocked(resolveAgentToken).mockResolvedValue(null);
    expect((await rpc('tools/list', undefined, ip)).status).toBe(401);
    expect(recordAgentFailure).toHaveBeenCalledWith('203.0.113.7');
    vi.mocked(agentFailuresExceeded).mockResolvedValue(true);
    vi.mocked(resolveAgentToken).mockClear();
    const response = await rpc('tools/list', undefined, ip);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(resolveAgentToken).not.toHaveBeenCalled();
  });

  it('never counts a resolved token as a failure', async () => {
    await rpc('tools/list', undefined, { 'x-nf-client-connection-ip': '203.0.113.7' });
    expect(recordAgentFailure).not.toHaveBeenCalled();
  });

  it('passes only the bearer value, never cookies, to the lookup', async () => {
    await rpc('initialize', initialize, { cookie: 'sb-local-auth-token=session', 'user-agent': 'claude-code/2.0' });
    expect(resolveAgentToken).toHaveBeenCalledWith(token, 'claude-code/2.0');
  });

  it('answers 429 once the token or host window is spent', async () => {
    vi.mocked(agentRequestAllowed).mockResolvedValue(false);
    const response = await rpc('tools/list');
    expect(response.status).toBe(429);
    expect(agentRequestAllowed).toHaveBeenCalledWith(principal);
  });

  it('returns 405 for GET and DELETE without touching auth', async () => {
    for (const handler of [GET, DELETE]) {
      const response = await handler({ request: new Request(`${serverEnv.appOrigin}/mcp`) });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
    expect(resolveAgentToken).not.toHaveBeenCalled();
  });

  it('caps the request body', async () => {
    const response = await rpc('initialize', undefined, {}, JSON.stringify({ padding: 'x'.repeat(70 * 1024) }));
    expect(response.status).toBe(413);
  });

  it('serves initialize statelessly with no-store', async () => {
    const response = await rpc('initialize', initialize);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('mcp-session-id')).toBeNull();
    expect((await rpcResult(response)).result?.serverInfo).toEqual({ name: 'staywise', version: '1.0.0' });
  });

  it('lists the read tools, annotated read-only, for a read token', async () => {
    const { result } = await rpcResult(await rpc('tools/list'));
    const tools = result?.tools as { name: string; annotations: unknown; outputSchema?: unknown }[];
    expect(tools.map((tool) => tool.name)).toEqual([
      'list_properties',
      'get_property',
      'list_reservations',
      'list_inbox',
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
      expect(tool.outputSchema).toBeTruthy();
    }
  });

  it.each([
    [[], []],
    [['content:write'], ['update_property', 'upsert_section', 'move_section', 'review_translation']],
    [['reservations:write'], ['upsert_reservations', 'create_stay_link', 'revoke_stay_link']],
    [['inbox:write'], ['mark_inbox_handled']],
  ] as const)('lists only the tools %j allows', async (scopes, names) => {
    vi.mocked(resolveAgentToken).mockResolvedValue({ ...principal, scopes: [...scopes] });
    const { result } = await rpcResult(await rpc('tools/list'));
    expect(((result?.tools ?? []) as { name: string }[]).map((tool) => tool.name)).toEqual(names);
  });

  it('annotates writes per the plan', async () => {
    vi.mocked(resolveAgentToken).mockResolvedValue({
      ...principal,
      scopes: ['content:write', 'reservations:write', 'inbox:write'],
    });
    const { result } = await rpcResult(await rpc('tools/list'));
    const listed = (result?.tools ?? []) as { name: string; annotations: Record<string, boolean> }[];
    const tools = Object.fromEntries(listed.map((tool) => [tool.name, tool]));
    for (const name of ['update_property', 'upsert_section', 'move_section', 'review_translation']) {
      expect(tools[name]?.annotations.destructiveHint).toBe(true);
      expect(tools[name]).toHaveProperty(['_meta', 'anthropic/requiresUserInteraction'], true);
    }
    expect(tools.upsert_reservations?.annotations).toMatchObject({ idempotentHint: true, destructiveHint: false });
    expect(tools.revoke_stay_link?.annotations.destructiveHint).toBe(true);
    expect(tools.create_stay_link?.annotations.destructiveHint).toBe(false);
  });

  it('refuses credential and alert email fields at the schema', async () => {
    vi.mocked(resolveAgentToken).mockResolvedValue({ ...principal, scopes: ['content:write'] });
    const { result } = await rpcResult(await rpc('tools/list'));
    const listed = (result?.tools ?? []) as { name: string; inputSchema: { properties: object } }[];
    const update = listed.find((tool) => tool.name === 'update_property');
    for (const field of ['wifiName', 'wifiPassword', 'keyboxCode', 'alertEmail', 'contactPhone']) {
      expect(Object.keys(update!.inputSchema.properties)).not.toContain(field);
    }
  });

  it('never logs the Authorization header or token, even on a failure', async () => {
    vi.mocked(resolveAgentToken).mockRejectedValue(new Error(`lookup failed for ${token}`));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await rpc('initialize', initialize);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(token);
    const logged = JSON.stringify([...logs.mock.calls, ...errors.mock.calls]);
    expect(logged).not.toContain(token);
    expect(logged.toLowerCase()).not.toContain('authorization');
    expect(logged.toLowerCase()).not.toContain('bearer');
  });
});
