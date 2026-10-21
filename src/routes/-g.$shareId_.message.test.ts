import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../lib/env.server';
import { bumpGuestCounter } from '../features/guest/guest-counters.server';
import { submitGuestMessage } from '../features/messages/messages.server';
import { sendGuestMessageAlert } from '../lib/mail.server';
import { Route } from './g.$shareId_.message';

vi.mock('../features/messages/messages.server', () => ({ submitGuestMessage: vi.fn() }));
vi.mock('../features/guest/guest-counters.server', () => ({ bumpGuestCounter: vi.fn() }));
vi.mock('../lib/mail.server', () => ({ sendGuestMessageAlert: vi.fn() }));
vi.mock('../features/share/share.server', () => ({ guestSessionToken: () => 'token' }));

type Handler = (ctx: { request: Request; params: { shareId: string } }) => Promise<Response> | Response;
const { POST, GET } = (Route.options as unknown as { server: { handlers: { POST: Handler; GET: Handler } } }).server
  .handlers;

const valid = { kind: 'question', category: 'wifi', locale: 'en', body: 'Where is the router?', replyEmail: '' };

function post(body: unknown, headers: Record<string, string> = {}) {
  const request = new Request('http://localhost/g/x/message', {
    method: 'POST',
    headers: { origin: serverEnv.appOrigin, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST({ request, params: { shareId: 'share-id-0123456789' } });
}

beforeEach(() => {
  vi.mocked(submitGuestMessage).mockReset();
  vi.mocked(bumpGuestCounter).mockReset();
  vi.mocked(sendGuestMessageAlert).mockReset();
});

describe('guest message intake', () => {
  it('stores a valid message, bumps the counter, and alerts the host', async () => {
    vi.mocked(submitGuestMessage).mockResolvedValue({ state: 'ok', propertyId: 'p1', alertEmail: 'host@example.test' });
    const response = await post(valid);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'ok' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(bumpGuestCounter).toHaveBeenCalledWith({
      shareId: 'share-id-0123456789',
      propertyId: 'p1',
      kind: 'submissions',
    });
    expect(sendGuestMessageAlert).toHaveBeenCalledWith('host@example.test');
  });

  it('answers a suppressed duplicate like a success without side effects', async () => {
    vi.mocked(submitGuestMessage).mockResolvedValue({ state: 'duplicate' } as never);
    expect((await post(valid)).status).toBe(200);
    expect(bumpGuestCounter).not.toHaveBeenCalled();
    expect(sendGuestMessageAlert).not.toHaveBeenCalled();
  });

  it.each([
    ['denied', 403],
    ['rate_limited', 429],
  ])('maps %s to %i', async (state, status) => {
    vi.mocked(submitGuestMessage).mockResolvedValue({ state } as never);
    const response = await post(valid);
    expect(response.status).toBe(status);
    expect((await response.json()).state).toBe(state);
    expect(sendGuestMessageAlert).not.toHaveBeenCalled();
  });

  it('returns field errors and never reaches storage for an invalid body', async () => {
    const response = await post({ ...valid, body: '   ' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ state: 'invalid', fields: { body: 'message_required' } });
    expect(submitGuestMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['a foreign origin', { origin: 'https://evil.example' }],
    ['a non-JSON content type', { 'content-type': 'text/plain' }],
    ['an oversized declared length', { 'content-length': '999999' }],
  ])('denies %s', async (_name, headers) => {
    expect((await post(valid, headers)).status).toBe(403);
    expect(submitGuestMessage).not.toHaveBeenCalled();
  });

  it('treats malformed JSON as an invalid message', async () => {
    expect((await post('{not json')).status).toBe(400);
  });

  it('returns a generic error when storage throws, without echoing content', async () => {
    vi.mocked(submitGuestMessage).mockRejectedValue(new Error(valid.body));
    const response = await post(valid);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(valid.body);
  });

  it('only accepts POST', async () => {
    const response = await GET({ request: new Request('http://localhost/'), params: { shareId: 'x' } });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});
