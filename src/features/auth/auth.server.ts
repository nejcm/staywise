import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '../../lib/env.server';
import { authCookieHeaders, clearCodeVerifierCookies, type AuthCookie } from './auth-cookies.server';
import { recordAudit } from '../../lib/audit.server';
import { recordSetupEvent } from '../../lib/setup-events.server';

export type RequestAuth = {
  client: SupabaseClient;
  cookies: AuthCookie[];
  headers: Record<string, string>;
  cookieHeader: string | null;
};

// One client per request, server-only. forwardedFor switches to the secret key, which Auth requires
// before it trusts Sb-Forwarded-For; only the magic-link request passes it.
export function createRequestAuth(cookieHeader: string | null, forwardedFor: string | null = null): RequestAuth {
  const forward = forwardedFor !== null && serverEnv.supabaseSecretKey !== null;
  const auth: RequestAuth = {
    client: null as unknown as SupabaseClient,
    cookies: [],
    headers: {},
    cookieHeader,
  };
  const key = forward ? (serverEnv.supabaseSecretKey as string) : serverEnv.supabasePublishableKey;
  auth.client = createServerClient(serverEnv.supabaseUrl, key, {
    ...(forward ? { global: { headers: { 'sb-forwarded-for': forwardedFor as string } } } : {}),
    cookies: {
      getAll: () => parseCookieHeader(cookieHeader ?? ''),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) auth.cookies.push({ name, value });
        Object.assign(auth.headers, headers);
      },
    },
  });
  return auth;
}

export type HostAuthState =
  | { state: 'signed_out' }
  | { state: 'enroll'; factorId: string | null; optional: boolean }
  | { state: 'verify'; factorId: string }
  | { state: 'workspace'; totpFactorIds: string[] };

// A verified authenticator always gates the workspace at AAL2; without one, enrollment is forced
// only by MFA_REQUIRED or when the host asked to set one up.
export async function getHostAuthState(
  client: SupabaseClient,
  options: { setup?: boolean } = {},
): Promise<HostAuthState> {
  const session = await verifiedSession(client);
  if (!session) return { state: 'signed_out' };
  const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
  if (factorsError || !factors) return { state: 'signed_out' };
  const totp = factors.all.filter((factor) => factor.factor_type === 'totp');
  const verified = totp.filter((factor) => factor.status === 'verified');
  if (verified.length) {
    const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal2') return { state: 'workspace', totpFactorIds: verified.map((f) => f.id) };
    return { state: 'verify', factorId: verified[0].id };
  }
  if (!serverEnv.mfaRequired && !options.setup) return { state: 'workspace', totpFactorIds: [] };
  return {
    state: 'enroll',
    factorId: totp.find((f) => f.status === 'unverified')?.id ?? null,
    optional: !serverEnv.mfaRequired,
  };
}

export type VerifiedSession = { userId: string; email: string | null };

// Server-side identity check for every request: getUser() asks the Auth server, which rejects
// revoked sessions (unlike locally verified JWTs), and refreshes expired tokens first.
export async function verifiedSession(client: SupabaseClient): Promise<VerifiedSession | null> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? null };
}

export type Aal2Session = { outcome: 'ok'; session: VerifiedSession } | { outcome: 'aal1' } | { outcome: 'invalid' };

// Distinguishes a revoked session (safe to clear) from a valid AAL1 session that only needs the
// second factor: clearing an AAL1 session would sign the host out of their own step-up.
export async function aal2Session(client: SupabaseClient): Promise<Aal2Session> {
  const session = await verifiedSession(client);
  if (!session) return { outcome: 'invalid' };
  // listFactors asks the Auth server; the cookie's cached user.factors (and so aal.nextLevel) is client-editable.
  const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
  if (factorsError || !factors) return { outcome: 'aal1' };
  const needsAal2 = serverEnv.mfaRequired || factors.totp.some((factor) => factor.status === 'verified');
  if (!needsAal2) return { outcome: 'ok', session };
  const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  return aal?.currentLevel === 'aal2' ? { outcome: 'ok', session } : { outcome: 'aal1' };
}

// Recovery for an interrupted enrollment: discard only this user's unverified TOTP factors and
// start a fresh one; verified factors (and the AAL2 gate they imply) are never touched.
export async function restartTotpEnrollment(
  client: SupabaseClient,
): Promise<{ factorId: string; secret: string } | null> {
  const { data: factors, error: listError } = await client.auth.mfa.listFactors();
  if (listError || !factors) return null;
  for (const factor of factors.all) {
    if (factor.factor_type !== 'totp' || factor.status !== 'unverified') continue;
    const { error: unenrollError } = await client.auth.mfa.unenroll({ factorId: factor.id });
    if (unenrollError) return null;
  }
  const { data: factor, error: enrollError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'authenticator',
  });
  if (enrollError || !factor?.totp) return null;
  return { factorId: factor.id, secret: factor.totp.secret };
}

// Sole GET callback allowed to mutate auth state: exchanges the one-use code, always jumps to a
// fixed destination, clears the verifier cookie, and audits the outcome without redirect input.
export async function completeAuthCallback(request: Request): Promise<Response> {
  const code = new URL(request.url).searchParams.get('code');
  const cookieHeader = request.headers.get('cookie');
  const auth = createRequestAuth(cookieHeader);
  let userId: string | null = null;
  if (code) {
    try {
      const { data, error } = await auth.client.auth.exchangeCodeForSession(code);
      if (!error && data.user) userId = data.user.id;
    } catch {
      userId = null;
    }
  }
  const headers = authCookieHeaders([...auth.cookies, ...clearCodeVerifierCookies(cookieHeader)], auth.headers);
  headers.set('Location', userId ? '/host' : '/auth/sign-in?status=restart');
  await recordAudit(userId, userId ? 'sign_in' : 'callback_failure');
  if (userId) await recordSetupEvent(userId, 'sign_in');
  return new Response(null, { status: 303, headers });
}
