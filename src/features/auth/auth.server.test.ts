import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aal2Session,
  deleteAuthUser,
  enrollmentSession,
  freshTotpPassed,
  getHostAuthState,
  hostAuthGate,
  restartTotpEnrollment,
  verifiedSession,
} from './auth.server';

const mfa = vi.hoisted(() => ({ required: true }));
const admin = vi.hoisted(() => ({
  secretKey: 'sb_secret_synthetic' as string | null,
  deleteUser: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { admin: { deleteUser: admin.deleteUser } } }),
}));
vi.mock('../../lib/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/env.server')>();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      get mfaRequired() {
        return mfa.required;
      },
      get supabaseSecretKey() {
        return admin.secretKey;
      },
    },
  };
});

type StubFactor = { id: string; factor_type: 'totp'; status: 'verified' | 'unverified' };

type StubOptions = {
  user?: { id: string; email?: string | null } | null;
  userError?: unknown;
  factors?: StubFactor[];
  factorsError?: unknown;
  currentLevel?: 'aal1' | 'aal2';
  unenrollErrorFor?: string;
  verifyError?: unknown;
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
          data: {
            currentLevel: options.currentLevel ?? 'aal1',
            nextLevel: options.factors?.some((f) => f.status === 'verified') ? 'aal2' : 'aal1',
          },
          error: null,
        }),
        enroll: async () => ({
          data: { id: 'factor-new', totp: { secret: 'SYNTHETICSECRET234567' } },
          error: null,
        }),
        challengeAndVerify: async () => ({ data: null, error: options.verifyError ?? null }),
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

describe('hostAuthGate', () => {
  it('returns the verified identity with the state and none when signed out', async () => {
    const { client } = stubClient({ user, factors: [verifiedFactor], currentLevel: 'aal2' });
    expect(await hostAuthGate(client)).toEqual({
      state: { state: 'workspace', totpFactorIds: [verifiedFactor.id] },
      session: { userId: user.id, email: user.email },
    });
    const { client: revoked } = stubClient({ user, factorsError: new Error('403 revoked') });
    expect(await hostAuthGate(revoked)).toEqual({ state: { state: 'signed_out' }, session: null });
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

describe('enrollmentSession', () => {
  afterEach(() => {
    mfa.required = true;
  });

  it('reports a revoked session as invalid', async () => {
    const { client } = stubClient({ userError: new Error('403 revoked') });
    expect(await enrollmentSession(client)).toEqual({ outcome: 'invalid' });
  });

  it.each([true, false])(
    'lets a host without a verified factor enroll at AAL1 (MFA required: %s)',
    async (required) => {
      mfa.required = required;
      const { client } = stubClient({ user, factors: [unverifiedFactor], currentLevel: 'aal1' });
      expect(await enrollmentSession(client)).toEqual({
        outcome: 'ok',
        session: { userId: user.id, email: user.email },
      });
    },
  );

  it.each([true, false])('requires AAL2 once a factor is verified (MFA required: %s)', async (required) => {
    mfa.required = required;
    const { client } = stubClient({ user, factors: [verifiedFactor, unverifiedFactor], currentLevel: 'aal1' });
    expect(await enrollmentSession(client)).toEqual({ outcome: 'aal1' });
  });

  it('accepts a host with a verified factor at AAL2', async () => {
    const { client } = stubClient({ user, factors: [verifiedFactor], currentLevel: 'aal2' });
    expect(await enrollmentSession(client)).toEqual({
      outcome: 'ok',
      session: { userId: user.id, email: user.email },
    });
  });

  it('fails closed when factors cannot be listed', async () => {
    const { client } = stubClient({ user, factorsError: new Error('503'), currentLevel: 'aal2' });
    expect(await enrollmentSession(client)).toEqual({ outcome: 'aal1' });
  });
});

describe('MFA optional', () => {
  afterEach(() => {
    mfa.required = true;
  });

  it('opens the workspace for a verified session without a factor', async () => {
    mfa.required = false;
    const { client } = stubClient({ user, factors: [unverifiedFactor], currentLevel: 'aal1' });
    expect(await getHostAuthState(client)).toEqual({ state: 'workspace', totpFactorIds: [] });
    expect(await aal2Session(client)).toEqual({ outcome: 'ok', session: { userId: user.id, email: user.email } });
  });

  it('still gates a host who has a verified factor', async () => {
    mfa.required = false;
    const { client } = stubClient({ user, factors: [verifiedFactor], currentLevel: 'aal1' });
    expect(await getHostAuthState(client)).toEqual({ state: 'verify', factorId: verifiedFactor.id });
    expect(await aal2Session(client)).toEqual({ outcome: 'aal1' });
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

describe('freshTotpPassed', () => {
  it('passes a host without a verified authenticator without a code', async () => {
    const { client } = stubClient({ user, factors: [unverifiedFactor] });
    expect(await freshTotpPassed(client, undefined)).toBe(true);
  });

  it('requires a code from a host with a verified authenticator, even at AAL2', async () => {
    const { client } = stubClient({ user, factors: [verifiedFactor], currentLevel: 'aal2' });
    expect(await freshTotpPassed(client, undefined)).toBe(false);
    expect(await freshTotpPassed(client, '123456')).toBe(true);
  });

  it('rejects a code the Auth server does not verify', async () => {
    const { client } = stubClient({ user, factors: [verifiedFactor], verifyError: new Error('invalid code') });
    expect(await freshTotpPassed(client, '000000')).toBe(false);
  });

  it('fails closed when factors cannot be listed', async () => {
    const { client } = stubClient({ user, factorsError: new Error('down') });
    expect(await freshTotpPassed(client, '123456')).toBe(false);
  });
});

describe('deleteAuthUser', () => {
  afterEach(() => {
    admin.secretKey = 'sb_secret_synthetic';
    admin.deleteUser.mockReset();
  });

  it('deletes through the admin API and treats an already deleted user as done', async () => {
    admin.deleteUser.mockResolvedValueOnce({ error: null });
    expect(await deleteAuthUser(user.id)).toBe(true);
    expect(admin.deleteUser).toHaveBeenCalledWith(user.id);
    admin.deleteUser.mockResolvedValueOnce({ error: { status: 404 } });
    expect(await deleteAuthUser(user.id)).toBe(true);
  });

  it('reports other admin failures and a missing key', async () => {
    admin.deleteUser.mockResolvedValueOnce({ error: { status: 500 } });
    expect(await deleteAuthUser(user.id)).toBe(false);
    admin.secretKey = null;
    expect(await deleteAuthUser(user.id)).toBe(false);
    expect(admin.deleteUser).toHaveBeenCalledTimes(1);
  });
});
