import { createServerEntry } from '@tanstack/react-start/server';
import { describe, expect, it, vi } from 'vitest';
import { startInstance } from './start';

type NextResult = { response: Response };
type BaselineServerFn = (args: { request: Request; next: () => Promise<NextResult> }) => Promise<Response | NextResult>;

async function baselineOf(instance: typeof startInstance): Promise<BaselineServerFn> {
  const options = await instance.getOptions();
  return options.requestMiddleware![0]!.options.server as unknown as BaselineServerFn;
}

const baseline = await baselineOf(startInstance);

function captureConsole() {
  const lines: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  return {
    lines,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

function toResponse(result: Response | NextResult): Response {
  return result instanceof Response ? result : result.response;
}

// Runs the real middleware through the installed server entry, the same boundary Start uses in production.
async function runRequest(next: () => Promise<NextResult>, path = '/sample', middleware = baseline) {
  const request = new Request(`https://staywise.test${path}`);
  const entry = createServerEntry({ fetch: async () => toResponse(await middleware({ request, next })) });
  return entry.fetch(request);
}

describe('baseline request middleware', () => {
  it('decorates successful responses without logging', async () => {
    const capture = captureConsole();
    try {
      const response = await runRequest(async () => ({ response: new Response('ok') }));
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('X-Request-Id')).toBeTruthy();
      expect(capture.lines).toEqual([]);
      expect(capture.errors).toEqual([]);
    } finally {
      capture.restore();
    }
  });

  it('marks nonce-bearing HTML responses private and no-store', async () => {
    const capture = captureConsole();
    try {
      const html = await runRequest(async () => ({
        response: new Response('<p>ok</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      }));
      expect(html.headers.get('Cache-Control')).toBe('private, no-store');
      const text = await runRequest(async () => ({
        response: new Response('ok', { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
      }));
      expect(text.headers.get('Cache-Control')).toBeNull();
      expect(capture.lines).toEqual([]);
      expect(capture.errors).toEqual([]);
    } finally {
      capture.restore();
    }
  });

  it('marks host, auth, server-function and guest paths no-store in any letter case', async () => {
    const capture = captureConsole();
    try {
      for (const path of [
        '/host',
        '/HOST/settings',
        '/Auth/callback',
        '/_serverFn/x',
        '/_SERVERFN/x',
        '/G',
        '/g/abc',
      ]) {
        const response = await runRequest(async () => ({ response: new Response('ok') }), path);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      }
      const other = await runRequest(async () => ({ response: new Response('ok') }), '/hosting');
      expect(other.headers.get('Cache-Control')).toBeNull();
      expect(capture.lines).toEqual([]);
    } finally {
      capture.restore();
    }
  });

  it('keeps the CSP dev allowances and omits HSTS for APP_ENV=local', async () => {
    const response = await runRequest(async () => ({ response: new Response('ok') }));
    expect(response.headers.get('Content-Security-Policy')).toContain("'unsafe-inline'");
    expect(response.headers.get('Strict-Transport-Security')).toBeNull();
  });

  it('drops the CSP dev allowances and pins HSTS outside local even when NODE_ENV is not production', async () => {
    expect(process.env.NODE_ENV).not.toBe('production');
    vi.resetModules();
    vi.doMock('./lib/env.server', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./lib/env.server')>()),
      appEnv: 'preview',
    }));
    try {
      const deployed = await baselineOf((await import('./start')).startInstance);
      const response = await runRequest(async () => ({ response: new Response('ok') }), '/sample', deployed);
      expect(response.headers.get('Content-Security-Policy')).not.toContain('unsafe-inline');
      expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=63072000');
    } finally {
      vi.doUnmock('./lib/env.server');
      vi.resetModules();
    }
  });

  it('drops the CSP dev allowances for the local production preview without pinning HSTS', async () => {
    vi.resetModules();
    // As in playwright.config.ts: a production build served with APP_ENV=local.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ENV', 'local');
    try {
      const preview = await baselineOf((await import('./start')).startInstance);
      const response = await runRequest(async () => ({ response: new Response('ok') }), '/sample', preview);
      expect(response.headers.get('Content-Security-Policy')).not.toContain('unsafe-inline');
      expect(response.headers.get('Strict-Transport-Security')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('decorates returned 500 responses and logs one safe event', async () => {
    const capture = captureConsole();
    try {
      const response = await runRequest(async () => ({ response: new Response(null, { status: 500 }) }));
      expect(response.status).toBe(500);
      expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('X-Request-Id')).toBeTruthy();
      expect(capture.lines).toHaveLength(1);
      expect(JSON.parse(capture.lines[0]!)).toMatchObject({
        event: 'server_error',
        method: 'GET',
        path: '/sample',
        status: 500,
        outcome: 'returned',
      });
      expect(capture.errors).toEqual([]);
    } finally {
      capture.restore();
    }
  });

  it('converts a thrown error into a decorated 500 without Start logging the raw error', async () => {
    const capture = captureConsole();
    try {
      const response = await runRequest(async () => {
        throw new Error('synthetic-guest@example.test SYNTHETIC_SECRET');
      });
      expect(response.status).toBe(500);
      expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('X-Request-Id')).toBeTruthy();
      expect(capture.lines).toHaveLength(1);
      expect(JSON.parse(capture.lines[0]!)).toMatchObject({
        event: 'server_error',
        path: '/sample',
        status: 500,
        outcome: 'thrown',
      });
      const output = capture.lines.join('\n');
      expect(output).not.toContain('SYNTHETIC_SECRET');
      expect(output).not.toContain('synthetic-guest@example.test');
      expect(capture.errors).toEqual([]);
    } finally {
      capture.restore();
    }
  });

  it('rethrows thrown Responses so Start keeps redirect semantics', async () => {
    const capture = captureConsole();
    try {
      const response = await runRequest(async () => {
        throw new Response(null, { status: 307, headers: { Location: '/host' } });
      });
      expect(response.status).toBe(307);
      expect(response.headers.get('Location')).toBe('/host');
      expect(capture.lines).toEqual([]);
      expect(capture.errors).toEqual([]);
    } finally {
      capture.restore();
    }
  });
});
