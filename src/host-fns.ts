import { createServerFn } from '@tanstack/react-start';
import { getRequest, setResponseHeaders } from '@tanstack/react-start/server';
import { z } from 'zod';
import { appEnv, serverEnv } from './env.server';
import {
  aal2Session,
  createRequestAuth,
  getHostAuthState as readHostAuthState,
  restartTotpEnrollment,
  verifiedSession,
  type HostAuthState,
  type RequestAuth,
} from './auth.server';
import { authCookieHeaders, clearSessionCookies } from './auth-cookies.server';
import { recordAudit } from './audit.server';
import { sendSecurityNotice } from './mail.server';
import { withOwnerContext } from './db.server';
import { logEvent } from './log.server';

type FnError = { error: 'auth_required' | 'invalid_input' | 'invalid_code' | 'unexpected' };

// Every handler normalizes its own failures into generic results before Start's server-function
// error handling can log or serialize them (mandatory Phase 2 error-sanitization gate).
async function runGuarded<T>(work: () => Promise<T>): Promise<T | { error: 'unexpected' }> {
  try {
    return await work();
  } catch {
    const meta: Record<string, string | number> = { appEnv, status: 500, outcome: 'thrown' };
    try {
      const request = getRequest();
      meta.method = request.method;
      meta.path = new URL(request.url).pathname;
    } catch {
      // No request context (in-process call): log only the safe fields.
    }
    logEvent('server_error', meta);
    return { error: 'unexpected' };
  }
}

function isJsonRequest(): boolean {
  try {
    return getRequest().headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'application/json';
  } catch {
    return false;
  }
}

// Exact Origin check on top of the framework CSRF middleware for every app-data mutation.
function isSameOriginRequest(): boolean {
  try {
    return getRequest().headers.get('origin') === serverEnv.appOrigin;
  } catch {
    return false;
  }
}

function isGuardedMutation(): boolean {
  return isJsonRequest() && isSameOriginRequest();
}

function requestAuth() {
  return createRequestAuth(getRequest().headers.get('cookie'));
}

// clearSession deletes the request's session cookies on the response, so a signed-out or revoked
// session cannot be replayed after the handler denies it.
function applyAuthCookies(auth: RequestAuth, clearSession = false) {
  const extra = clearSession ? clearSessionCookies(auth.cookieHeader) : [];
  setResponseHeaders(authCookieHeaders([...auth.cookies, ...extra], auth.headers));
}

const emailInput = z.object({ email: z.email() });
const mfaVerifyInput = z.object({ factorId: z.uuid(), code: z.string().regex(/^\d{6}$/) });
const factorIdInput = z.object({ factorId: z.uuid() });

export const requestMagicLink = createServerFn({ method: 'POST' })
  // Call-site typing only: handlers re-validate with zod so bad input stays a generic result.
  .validator((value: unknown) => value as { email: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = emailInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const auth = requestAuth();
      const { error } = await auth.client.auth.signInWithOtp({
        email: input.data.email,
        options: { shouldCreateUser: false, emailRedirectTo: `${serverEnv.appOrigin}/auth/callback` },
      });
      applyAuthCookies(auth);
      // Identical acknowledgement for any valid address: neither membership nor provider outcome
      // may vary the response; failures are only recorded as safe internal fields.
      if (error) logEvent('otp_send_failed', { appEnv, status: 502, outcome: 'provider_error' });
      return { ok: true as const };
    }),
  );

export const getHostAuthState = createServerFn({ method: 'GET' }).handler(async () =>
  runGuarded(async () => {
    const auth = requestAuth();
    const state = await readHostAuthState(auth.client);
    applyAuthCookies(auth, state.state === 'signed_out');
    return state satisfies HostAuthState;
  }),
);

export const mfaEnroll = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as Record<string, never>)
  .handler(async () =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const auth = requestAuth();
      const session = await verifiedSession(auth.client);
      if (!session) {
        applyAuthCookies(auth, true);
        return { error: 'auth_required' } satisfies FnError;
      }
      const { data: factor, error } = await auth.client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'authenticator',
      });
      applyAuthCookies(auth);
      if (error || !factor) return { error: 'unexpected' } satisfies FnError;
      const totp = factor.totp;
      if (!totp) return { error: 'unexpected' } satisfies FnError;
      return { factorId: factor.id, qrCode: totp.qr_code, secret: totp.secret, uri: totp.uri };
    }),
  );

// Recovery path for an interrupted enrollment: fresh secret for the authenticated host without
// touching verified factors; the AAL2 workspace gate is unchanged.
export const restartEnrollment = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as Record<string, never>)
  .handler(async () =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const auth = requestAuth();
      const session = await verifiedSession(auth.client);
      if (!session) {
        applyAuthCookies(auth, true);
        return { error: 'auth_required' } satisfies FnError;
      }
      const restarted = await restartTotpEnrollment(auth.client);
      applyAuthCookies(auth);
      if (!restarted) return { error: 'unexpected' } satisfies FnError;
      return restarted;
    }),
  );

export const mfaVerify = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { factorId: string; code: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = mfaVerifyInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const auth = requestAuth();
      const session = await verifiedSession(auth.client);
      if (!session) {
        applyAuthCookies(auth, true);
        return { error: 'auth_required' } satisfies FnError;
      }
      const { data: existingFactors, error: factorsError } = await auth.client.auth.mfa.listFactors();
      if (factorsError || !existingFactors) {
        applyAuthCookies(auth);
        return { error: 'unexpected' } satisfies FnError;
      }
      const alreadyVerified = existingFactors.totp.some((factor) => factor.id === input.data.factorId);
      const { data: challenge, error: challengeError } = await auth.client.auth.mfa.challenge({
        factorId: input.data.factorId,
      });
      if (challengeError || !challenge) {
        applyAuthCookies(auth);
        return { error: 'invalid_input' } satisfies FnError;
      }
      const { error } = await auth.client.auth.mfa.verify({
        factorId: input.data.factorId,
        challengeId: challenge.id,
        code: input.data.code,
      });
      applyAuthCookies(auth);
      if (error) return { error: 'invalid_code' } satisfies FnError;
      // A step-up on an existing factor is not a new enrollment: no duplicate audit row or notice.
      if (!alreadyVerified) {
        await recordAudit(session.userId, 'mfa_enrolled');
        if (session.email) await sendSecurityNotice(session.email, 'mfa_enrolled');
      }
      return { ok: true as const };
    }),
  );

export const mfaUnenroll = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { factorId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = factorIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const auth = requestAuth();
      const gate = await aal2Session(auth.client);
      applyAuthCookies(auth, gate.outcome === 'invalid');
      if (gate.outcome !== 'ok') return { error: 'auth_required' } satisfies FnError;
      const { error } = await auth.client.auth.mfa.unenroll({ factorId: input.data.factorId });
      applyAuthCookies(auth);
      if (error) return { error: 'unexpected' } satisfies FnError;
      await recordAudit(gate.session.userId, 'mfa_unenrolled');
      if (gate.session.email) await sendSecurityNotice(gate.session.email, 'mfa_unenrolled');
      return { ok: true as const };
    }),
  );

export const signOut = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as Record<string, never>)
  .handler(async () =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const auth = requestAuth();
      await auth.client.auth.signOut();
      applyAuthCookies(auth);
      return { ok: true as const };
    }),
  );

export const listOwnProperties = createServerFn({ method: 'GET' }).handler(async () =>
  runGuarded(async () => {
    const auth = requestAuth();
    const gate = await aal2Session(auth.client);
    // Apply session cookies before the query so a failing read cannot drop a refreshed session; only
    // a revoked session is cleared, while a valid AAL1 session must survive to finish the step-up.
    applyAuthCookies(auth, gate.outcome === 'invalid');
    if (gate.outcome !== 'ok') {
      return { error: 'auth_required' } satisfies FnError;
    }
    const rows = await withOwnerContext(
      gate.session.userId,
      (tx) => tx`select id, display_name, published, created_at from app.properties order by created_at desc`,
    );
    return {
      properties: rows.map((row) => ({
        id: row.id as string,
        displayName: row.display_name as string,
        published: row.published as boolean,
        createdAt: row.created_at as Date,
      })),
    };
  }),
);
