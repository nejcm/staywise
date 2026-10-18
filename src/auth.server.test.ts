import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { aal2Session, getHostAuthState, restartTotpEnrollment, verifiedSession } from './auth.server';

type StubFactor = { id: string; factor_type: 'totp'; status: 'verified' | 'unverified' };

type StubOptions = {
  user?: { id: string; email?: string | null } | null;
  userError?: unknown;
  factors?: StubFactor[];
  factorsError?: unknown;
  currentLevel?: 'aal1' | 'aal2';
  unenrollErrorFor?: string;
};

function stubClient(options: StubOptions) {
  const unenrolled: string[] = [];
  const client = {
    auth: {
      getUser: async () =>
        options.userError
          ? { data: { user: null }, error: options.userError }
          : { data: { user: options.user ?? null }, error: null },
      mfa: {
        listFactors: async () =>
          options.factorsError
            ? { data: null, error: options.factorsError }
            : { data: { all: options.factors ?? [], totp: options.factors ?? [] }, error: null },
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: options.currentLevel ?? 'aal1', nextLevel: 'aal1' },
          error: null,
        }),
        enroll: async () => ({
          data: { id: 'factor-new', totp: { secret: 'SYNTHETICSECRET234567' } },
          error: null,
        }),
        unenroll: async ({ factorId }: { factorId: string }) => {
          if (options.unenrollErrorFor === factorId) return { error: new Error('synthetic unenroll failure') };
          unenrolled.push(factorId);
          return { error: null };
        },
      },
    },
  };
  return { client: client as unknown as SupabaseClient, unenrolled };
}

const verifiedFactor: StubFactor = { id: 'factor-verified', factor_type: 'totp', status: 'verified' };
const unverifiedFactor: StubFactor = { id: 'factor-unverified', factor_type: 'totp', status: 'unverified' };
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'host@example.test' };

describe('verifiedSession', () => {
  it('reports no session when the Auth server rejects the stored session', async () => {
    const { client } = stubClient({ userError: new Error('403 revoked') });
    expect(await verifiedSession(client)).toBeNull();
  });

  it('returns the server-verified identity', async () => {
    const { client } = stubClient({ user });
    expect(await verifiedSession(client)).toEqual({ userId: user.id, email: user.email });
  });
});

describe('getHostAuthState', () => {
  it('treats provider factor-list errors as signed out, never as enrollment', async () => {
    const { client } = stubClient({ user, factorsError: new Error('403 revoked') });
    expect(await getHostAuthState(client)).toEqual({ state: 'signed_out' });
  });

  it('treats a rejected session as signed out', async () => {
    const { client } = stubClient({ userError: new Error('403 revoked'), factors: [unverifiedFactor] });
    expect(await getHostAuthState(client)).toEqual({ state: 'signed_out' });
  });

  it('reports an interrupted enrollment with its unverified factor id', async () => {
    const { client } = stubClient({ user, factors: [unverifiedFactor] });
    expect(await getHostAuthState(client)).toEqual({ state: 'enroll', factorId: unverifiedFactor.id });
  });

  it('requires the second factor when one is verified at AAL1', async () => {
    const { client } = stubClient({ user, factors: [verifiedFactor], currentLevel: 'aal1' });
    expect(await getHostAuthState(client)).toEqual({ state: 'verify', factorId: verifiedFactor.id });
  });

  it('reaches the workspace only at AAL2', async () => {
    const { client } = stubClient({ user, factors: [verifiedFactor], currentLevel: 'aal2' });
    expect(await getHostAuthState(client)).toEqual({ state: 'workspace', totpFactorIds: [verifiedFactor.id] });
  });
});

describe('aal2Session', () => {
  it('reports a revoked session as invalid so callers clear it', async () => {
    const { client } = stubClient({ userError: new Error('403 revoked'), currentLevel: 'aal2' });
    expect(await aal2Session(client)).toEqual({ outcome: 'invalid' });
  });

  it('reports a valid AAL1 session separately so callers keep its cookies', async () => {
    const { client } = stubClient({ user, factors: [verifiedFactor], currentLevel: 'aal1' });
    expect(await aal2Session(client)).toEqual({ outcome: 'aal1' });
  });

  it('accepts an AAL2 session', async () => {
    const { client } = stubClient({ user, factors: [verifiedFactor], currentLevel: 'aal2' });
    expect(await aal2Session(client)).toEqual({
      outcome: 'ok',
      session: { userId: user.id, email: user.email },
    });
  });
});

describe('restartTotpEnrollment', () => {
  it('drops only unverified factors and returns a fresh secret', async () => {
    const { client, unenrolled } = stubClient({ user, factors: [verifiedFactor, unverifiedFactor] });
    expect(await restartTotpEnrollment(client)).toEqual({
      factorId: 'factor-new',
      secret: 'SYNTHETICSECRET234567',
    });
    expect(unenrolled).toEqual([unverifiedFactor.id]);
  });

  it('never unenrolls a verified factor', async () => {
    const { client, unenrolled } = stubClient({ user, factors: [verifiedFactor] });
    expect(await restartTotpEnrollment(client)).toEqual({
      factorId: 'factor-new',
      secret: 'SYNTHETICSECRET234567',
    });
    expect(unenrolled).toEqual([]);
  });

  it('returns nothing when the factor list cannot be read', async () => {
    const { client, unenrolled } = stubClient({ user, factorsError: new Error('403 revoked') });
    expect(await restartTotpEnrollment(client)).toBeNull();
    expect(unenrolled).toEqual([]);
  });

  it('returns nothing when an unverified factor cannot be removed', async () => {
    const { client } = stubClient({ user, factors: [unverifiedFactor], unenrollErrorFor: unverifiedFactor.id });
    expect(await restartTotpEnrollment(client)).toBeNull();
  });
});
