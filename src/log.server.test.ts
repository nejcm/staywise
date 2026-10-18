import { describe, expect, it } from 'vitest';
import { logEvent } from './log.server';

function captureLogLine(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
}

describe('logEvent', () => {
  it('emits only allowlisted scalar fields', () => {
    const capture = captureLogLine();
    try {
      logEvent('server_error', {
        requestId: 'r1',
        appEnv: 'local',
        method: 'GET',
        path: '/host',
        status: 500,
        outcome: 'thrown',
      });
      expect(JSON.parse(capture.lines[0]!)).toEqual({
        event: 'server_error',
        requestId: 'r1',
        appEnv: 'local',
        method: 'GET',
        path: '/host',
        status: 500,
        outcome: 'thrown',
      });
    } finally {
      capture.restore();
    }
  });

  it('drops sensitive and nested fields instead of serializing them', () => {
    const capture = captureLogLine();
    try {
      logEvent('server_error', {
        requestId: 'r1',
        body: 'synthetic private guest message',
        fragment: 'SYNTHETIC_SECRET',
        translationPayload: 'synthetic private prose',
        details: { email: 'synthetic-guest@example.test' },
      } as never);
      const line = capture.lines[0]!;
      expect(JSON.parse(line)).toEqual({ event: 'server_error', requestId: 'r1' });
      expect(line).not.toContain('SYNTHETIC_SECRET');
      expect(line).not.toContain('synthetic-guest@example.test');
    } finally {
      capture.restore();
    }
  });

  it('drops non-scalar values on allowlisted names', () => {
    const capture = captureLogLine();
    try {
      logEvent('server_error', { path: { nested: 'synthetic private prose' }, status: '500' } as never);
      expect(JSON.parse(capture.lines[0]!)).toEqual({ event: 'server_error', status: '500' });
    } finally {
      capture.restore();
    }
  });

  it('rejects unknown event names', () => {
    const capture = captureLogLine();
    try {
      logEvent('synthetic secret event name' as never);
      expect(JSON.parse(capture.lines[0]!)).toEqual({ event: 'invalid_event' });
    } finally {
      capture.restore();
    }
  });
});
