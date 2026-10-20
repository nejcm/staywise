import { getRequest } from '@tanstack/react-start/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from './env.server';
import { isGuardedMutation, runGuarded } from './fn-guards.server';
import { logEvent } from './log.server';

vi.mock('@tanstack/react-start/server', () => ({ getRequest: vi.fn(), setResponseHeaders: vi.fn() }));
vi.mock('./log.server', () => ({ logEvent: vi.fn() }));

function request(headers: Record<string, string>, url = 'http://localhost:3000/host'): Request {
  return new Request(url, { method: 'POST', headers });
}

beforeEach(() => {
  vi.mocked(getRequest).mockReset();
  vi.mocked(logEvent).mockReset();
});

describe('runGuarded', () => {
  it('passes the result through', async () => {
    expect(await runGuarded(async () => 7)).toBe(7);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('turns a throw into a generic error and logs only safe fields', async () => {
    vi.mocked(getRequest).mockReturnValue(request({}, 'http://localhost:3000/host?token=SYNTHETIC'));
    const result = await runGuarded(async () => {
      throw new Error('SYNTHETIC-SECRET');
    });
    expect(result).toEqual({ error: 'unexpected' });
    expect(logEvent).toHaveBeenCalledWith('server_error', {
      appEnv: serverEnv.appEnv,
      status: 500,
      outcome: 'thrown',
      method: 'POST',
      path: '/host',
    });
  });

  it('still answers when there is no request context', async () => {
    vi.mocked(getRequest).mockImplementation(() => {
      throw new Error('no request');
    });
    expect(
      await runGuarded(async () => {
        throw new Error('x');
      }),
    ).toEqual({ error: 'unexpected' });
    expect(logEvent).toHaveBeenCalledWith('server_error', expect.not.objectContaining({ path: expect.anything() }));
  });
});

describe('isGuardedMutation', () => {
  const json = { 'content-type': 'application/json; charset=utf-8', origin: serverEnv.appOrigin };

  it('accepts a same-origin JSON request', () => {
    vi.mocked(getRequest).mockReturnValue(request(json));
    expect(isGuardedMutation()).toBe(true);
  });

  it.each([
    ['a foreign origin', { ...json, origin: 'https://evil.example' }],
    ['a missing origin', { 'content-type': 'application/json' }],
    ['a non-JSON body', { ...json, 'content-type': 'text/plain' }],
  ])('rejects %s', (_name, headers) => {
    vi.mocked(getRequest).mockReturnValue(request(headers));
    expect(isGuardedMutation()).toBe(false);
  });

  it('rejects when there is no request context', () => {
    vi.mocked(getRequest).mockImplementation(() => {
      throw new Error('no request');
    });
    expect(isGuardedMutation()).toBe(false);
  });
});
