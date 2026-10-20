import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalInput } from './canonical-input.server';

describe('canonicalInput', () => {
  const schema = z.object({ name: z.string().trim().min(1) });

  it('returns the parsed, normalized value', () => {
    expect(canonicalInput(schema, { name: '  Villa ' })).toEqual({ name: 'Villa' });
  });

  it('throws a generic error without echoing the input', () => {
    expect(() => canonicalInput(schema, { name: ' ', secret: 'SYNTHETIC-SECRET' })).toThrow('invalid_input');
  });
});
