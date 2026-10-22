import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logEvent } from './log.server';

const { captureExceptionImmediate, PostHog, env } = vi.hoisted(() => {
  const capture = vi.fn();
  return {
    captureExceptionImmediate: capture,
    PostHog: vi.fn(function () {
      return { captureExceptionImmediate: capture };
    }),
    env: {
      posthog: { apiKey: 'phc_test', host: 'https://eu.i.posthog.com' } as { apiKey: string; host: string } | null,
    },
  };
});
vi.mock('posthog-node', () => ({ PostHog }));
vi.mock('./env.server', () => ({
  appEnv: 'local',
  get serverEnv() {
    return env;
  },
}));
vi.mock('./log.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./log.server')>()),
  logEvent: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  captureExceptionImmediate.mockReset().mockResolvedValue(undefined);
  PostHog.mockClear();
  vi.mocked(logEvent).mockReset();
  env.posthog = { apiKey: 'phc_test', host: 'https://eu.i.posthog.com' };
});

describe('scrubException', () => {
  it('drops the message and source context, keeps type and locations', async () => {
    const { scrubException } = await import('./error-reporting.server');
    const event = {
      properties: {
        $exception_list: [
          {
            type: 'TypeError',
            value: 'guest SYNTHETIC-SECRET',
            stacktrace: {
              frames: [
                { filename: 'a.ts', lineno: 3, context_line: 'secret()', pre_context: ['x'], post_context: ['y'] },
              ],
            },
          },
        ],
      },
    };
    expect(JSON.stringify(scrubException(event))).not.toMatch(/SYNTHETIC-SECRET|secret\(\)|"x"|"y"/);
    expect(event.properties.$exception_list[0]).toMatchObject({
      type: 'TypeError',
      stacktrace: { frames: [{ filename: 'a.ts', lineno: 3 }] },
    });
  });
});

describe('reportServerError', () => {
  it('logs and sends only allowlisted fields with ids redacted from the path', async () => {
    const { reportServerError } = await import('./error-reporting.server');
    const error = new Error('x');
    const fields: Record<string, string | number> = {
      requestId: 'r1',
      status: 500,
      path: '/g/abc123/guide',
      extra: 'nope',
    };
    await reportServerError(error, fields);
    expect(logEvent).toHaveBeenCalledWith('server_error', fields);
    expect(captureExceptionImmediate).toHaveBeenCalledWith(error, undefined, {
      requestId: 'r1',
      status: 500,
      path: '/g/:shareId/guide',
    });
    const options = (PostHog.mock.calls as unknown as [string, unknown][])[0]![1] as {
      before_send: (event: unknown) => { properties: { $exception_list: { value: string }[] } };
    };
    const scrubbed = options.before_send({ properties: { $exception_list: [{ value: 'SYNTHETIC-SECRET' }] } });
    expect(scrubbed.properties.$exception_list[0]!.value).toBe('');
    expect(PostHog).toHaveBeenCalledWith('phc_test', expect.objectContaining({ host: 'https://eu.i.posthog.com' }));
  });

  it('does not send a returned 5xx that has no exception', async () => {
    const { reportServerError } = await import('./error-reporting.server');
    await reportServerError(undefined, { status: 502 });
    expect(captureExceptionImmediate).not.toHaveBeenCalled();
  });

  it('redacts uuid path segments', async () => {
    const { redactPath } = await import('./error-reporting.server');
    expect(redactPath('/host/properties/3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab/hero')).toBe('/host/properties/:id/hero');
  });

  it('only logs when PostHog is not configured', async () => {
    env.posthog = null;
    const { reportServerError } = await import('./error-reporting.server');
    await reportServerError(new Error('x'), { status: 500 });
    expect(PostHog).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('never fails the caller when sending fails', async () => {
    captureExceptionImmediate.mockRejectedValue(new Error('network'));
    const { reportServerError } = await import('./error-reporting.server');
    await expect(reportServerError(new Error('x'), { status: 500 })).resolves.toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith('error_report_failed', expect.objectContaining({ status: 500 }));
  });
});
