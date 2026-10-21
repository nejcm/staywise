import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { appEnv, serverEnv } from '../../lib/env.server';
import {
  aal2Session,
  getHostAuthState as readHostAuthState,
  restartTotpEnrollment,
  verifiedSession,
  type HostAuthState,
} from '../auth/auth.server';
import { applyAuthCookies, isGuardedMutation, requestAuth, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { recordAudit } from '../../lib/audit.server';
import { otpSendAllowed } from '../auth/auth-limits.server';
import { sendSecurityNotice } from '../../lib/mail.server';
import { withOwnerContext } from '../../lib/db.server';
import { logEvent } from '../../lib/log.server';

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
    const { rows, waiting } = await withOwnerContext(gate.session.userId, async (tx) => ({
      rows: await tx`
        select p.id, p.display_name, p.address, p.published, p.source_locale, p.enabled_locales,
          greatest(p.updated_at, (select max(s.updated_at) from app.guide_sections s where s.property_id = p.id)) as edited_at,
          coalesce((select array_agg(distinct s.category) from app.guide_sections s where s.property_id = p.id), '{}') as categories,
          (select count(*) from app.guide_sections s
            where s.property_id = p.id and s.visibility = 'guest' and not s.published)::int as unpublished_sections,
          coalesce((select array_agg(l) from unnest(p.enabled_locales) l
            where not exists (
              select 1 from app.guide_sections s
              where s.property_id = p.id and s.visibility = 'guest' and s.published
                and not exists (
                  select 1 from app.guide_translations t
                  where t.section_id = s.id and t.locale = l and t.state = 'approved'
                    and t.source_revision = s.source_revision and t.source_locale = p.source_locale)
            )), '{}') as reviewed_locales,
          exists (select 1 from app.share_links k where k.property_id = p.id and k.enabled) as link_on,
          (select count(*) from app.guest_messages m where m.property_id = p.id and m.state = 'new')::int as waiting
        from app.properties p
        order by p.created_at desc
      `,
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
      properties: rows.map((row) => ({
        id: row.id as string,
        displayName: row.display_name as string,
        address: row.address as string | null,
        published: row.published as boolean,
        editedAt: (row.edited_at as Date).toISOString(),
        sourceLocale: row.source_locale as string,
        enabledLocales: row.enabled_locales as string[],
        reviewedLocales: row.reviewed_locales as string[],
        categories: row.categories as string[],
        unpublishedSections: row.unpublished_sections as number,
        linkOn: row.link_on as boolean,
        waiting: row.waiting as number,
      })),
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
