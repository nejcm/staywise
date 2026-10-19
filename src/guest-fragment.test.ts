import { describe, expect, it } from 'vitest';
import { bearerSecretFromFragment } from './guest-fragment';

describe('guest fragment detection', () => {
  it('extracts a 43-character bearer secret with or without the hash marker', () => {
    const secret = 'A1_-'.repeat(10) + 'BcD';
    expect(secret).toHaveLength(43);
    expect(bearerSecretFromFragment(`#${secret}`)).toBe(secret);
    expect(bearerSecretFromFragment(secret)).toBe(secret);
  });

  it('does not treat skip or section anchors as credentials', () => {
    expect(bearerSecretFromFragment('#guest-content')).toBeNull();
    expect(bearerSecretFromFragment('#wifi')).toBeNull();
    expect(bearerSecretFromFragment('')).toBeNull();
  });

  it('rejects fragments of the wrong length or alphabet', () => {
    expect(bearerSecretFromFragment(`#${'A'.repeat(42)}`)).toBeNull();
    expect(bearerSecretFromFragment(`#${'A'.repeat(44)}`)).toBeNull();
    expect(bearerSecretFromFragment(`#${'A'.repeat(42)}!`)).toBeNull();
  });
});
