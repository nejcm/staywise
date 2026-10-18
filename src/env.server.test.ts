import { describe, expect, it } from 'vitest';
import { parseAppEnv } from './env.server';

describe('parseAppEnv', () => {
  it('defaults to local outside production', () => {
    expect(parseAppEnv({ NODE_ENV: 'development' })).toBe('local');
  });

  it('requires APP_ENV explicitly in production', () => {
    expect(() => parseAppEnv({ NODE_ENV: 'production' })).toThrow(/APP_ENV/);
  });

  it('accepts an explicit preview environment in production', () => {
    expect(parseAppEnv({ APP_ENV: 'preview', NODE_ENV: 'production' })).toBe('preview');
  });

  it('rejects unknown APP_ENV values', () => {
    expect(() => parseAppEnv({ APP_ENV: 'prod' })).toThrow(/APP_ENV/);
  });
});
