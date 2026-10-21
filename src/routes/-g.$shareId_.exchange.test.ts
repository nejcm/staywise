import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../lib/env.server';
import { withLinkContext } from '../lib/db.server';
import { Route } from './g.$shareId_.exchange';

vi.mock('../lib/db.server', () => ({ withLinkContext: vi.fn() }));

type Handler = (ctx: { request: Request; params: { shareId: string } }) => Promise<Response> | Response;
const { POST, GET } = (Route.options as unknown as { server: { handlers: { POST: Handler; GET: Handler } } }).server
  .handlers;

const shareId = 'share-id-0123456789';
const secret = 'a'.repeat(43);

function post(body: unknown, headers: Record<string, string> = {}) {
  const request = new Request('http://localhost/g/x/exchange', {
    method: 'POST',
    headers: { origin: serverEnv.appOrigin, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST({ request, params: { shareId } });
}

beforeEach(() => {
  vi.mocked(withLinkContext).mockReset();
});

describe('guest link exchange', () => {
  it('sets the session cookie for a valid secret', async () => {
    vi.mocked(withLinkContext).mockResolvedValue({ token: 'session-token', propertyId: 'p1' });
    const response = await post({ secret });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('session-token');
    expect(withLinkContext).toHaveBeenCalledWith(shareId, expect.any(Function));
  });

  it('answers every failure with the same denial', async () => {
    vi.mocked(withLinkContext).mockResolvedValue(null);
    const bodies = [];
    for (const response of [
      await post({ secret }),
      await post({ secret: 'short' }),
      await post('{nope'),
      await post({ secret }, { origin: 'https://evil.example' }),
      await post({ secret }, { 'content-type': 'text/plain' }),
    ]) {
      expect(response.status).toBe(403);
      expect(response.headers.get('set-cookie')).toBeNull();
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('returns a generic 500 when the exchange throws', async () => {
    vi.mocked(withLinkContext).mockRejectedValue(new Error('SYNTHETIC-SECRET'));
    const response = await post({ secret });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('SYNTHETIC');
  });

  it('only accepts POST', async () => {
    expect((await GET({ request: new Request('http://localhost/'), params: { shareId } })).status).toBe(405);
  });
});
