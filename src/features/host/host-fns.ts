import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { appEnv, serverEnv } from '../../lib/env.server';
import {
  aal2Session,
  deleteAuthUser,
  freshTotpPassed,
  getHostAuthState as readHostAuthState,
  restartTotpEnrollment,
  verifiedSession,
  type HostAuthState,
} from '../auth/auth.server';
import { applyAuthCookies, isGuardedMutation, requestAuth, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { recordAudit } from '../../lib/audit.server';
import { recordSignIn, signInContext } from '../../lib/sign-in-context.server';
import { otpSendAllowed } from '../auth/auth-limits.server';
import { sendSecurityNotice } from '../../lib/mail.server';
import { withOwnerContext } from '../../lib/db.server';
import { drainAllStorageDeletions } from '../../lib/storage.server';
import { revokeAllGrants } from '../agent/agent-auth.server';
import { readOwnProperties } from './host.server';
import { logEvent } from '../../lib/log.server';

const emailInput = z.object({ email: z.email() });
const mfaVerifyInput = z.object({ factorId: z.uuid(), code: z.string().regex(/^\d{6}$/) });
const factorIdInput = z.object({ factorId: z.uuid() });
const deleteAccountInput = z.object({
  email: z.string().trim().max(320),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const requestMagicLink = createServerFn({ method: 'POST' })
  // Call-site typing only: handlers re-validate with zod so bad input stays a generic result.
  .validator((value: unknown) => value as { email: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = emailInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      // Netlify sets this header at its edge; a client cannot supply it.
      const clientIp = getRequest().headers.get('x-nf-client-connection-ip');
      if (!(await otpSendAllowed({ email: input.data.email, clientIp }))) {
        logEvent('otp_rate_limited', { appEnv, status: 429, outcome: 'suppressed' });
        return { ok: true as const };
      }
      const auth = requestAuth(clientIp);
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
      if (alreadyVerified) {
        await recordSignIn(session.userId, 'mfa_verified', signInContext(getRequest().headers));
      } else {
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
      // Before the unenroll, so a failure after it can never leave agent grants alive without TOTP (Q24).
      await withOwnerContext(gate.session.userId, (tx) => revokeAllGrants(tx, gate.session.userId));
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

// Typed email and, when enrolled, a fresh TOTP code guard the one irreversible host action (ADR 0002).
export const deleteAccount = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { email: string; code?: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = deleteAccountInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const auth = requestAuth();
      const gate = await aal2Session(auth.client);
      applyAuthCookies(auth, gate.outcome === 'invalid');
      if (gate.outcome !== 'ok') return { error: 'auth_required' } satisfies FnError;
      if (!gate.session.email || gate.session.email.toLowerCase() !== input.data.email.toLowerCase()) {
        return { error: 'invalid_input' } satisfies FnError;
      }
      const passed = await freshTotpPassed(auth.client, input.data.code);
      applyAuthCookies(auth);
      if (!passed) return { error: 'invalid_code' } satisfies FnError;
      if (!(await deleteAuthUser(gate.session.userId))) return { error: 'unexpected' } satisfies FnError;
      await drainAllStorageDeletions();
      await recordAudit(null, 'account_deleted');
      await auth.client.auth.signOut({ scope: 'local' });
      applyAuthCookies(auth, true);
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
    const { properties, waiting } = await withOwnerContext(gate.session.userId, async (tx) => ({
      properties: await readOwnProperties(tx),
      waiting: await tx`
        select m.id, m.property_id, p.display_name, m.kind, m.locale, left(m.body, 160) as excerpt, m.created_at
        from app.guest_messages m join app.properties p on p.id = m.property_id
        where m.state = 'new'
        order by m.created_at desc
        limit 3
      `,
    }));
    return {
      email: gate.session.email,
      properties,
      waiting: waiting.map((row) => ({
        id: row.id as string,
        propertyId: row.property_id as string,
        propertyName: row.display_name as string,
        kind: row.kind as 'issue' | 'question',
        locale: row.locale as string,
        excerpt: row.excerpt as string,
        createdAt: (row.created_at as Date).toISOString(),
      })),
    };
  }),
);
