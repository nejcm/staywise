import { createServerEntry } from '@tanstack/react-start/server';
import { describe, expect, it } from 'vitest';
import { startInstance } from './start';

type NextResult = { response: Response };
type BaselineServerFn = (args: { request: Request; next: () => Promise<NextResult> }) => Promise<Response | NextResult>;

const options = await startInstance.getOptions();
const baseline = options.requestMiddleware![0]!.options.server as unknown as BaselineServerFn;

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
async function runRequest(next: () => Promise<NextResult>) {
  const request = new Request('https://staywise.test/sample');
  const entry = createServerEntry({ fetch: async () => toResponse(await baseline({ request, next })) });
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
