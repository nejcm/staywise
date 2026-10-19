import { getRequest, setResponseHeaders } from '@tanstack/react-start/server';
import { appEnv, serverEnv } from './env.server';
import { aal2Session, createRequestAuth, type RequestAuth, type VerifiedSession } from '../features/auth/auth.server';
import { authCookieHeaders, clearSessionCookies } from '../features/auth/auth-cookies.server';
import { logEvent } from './log.server';

export type FnError = { error: 'auth_required' | 'invalid_input' | 'invalid_code' | 'unexpected' };

// Every handler normalizes its own failures into generic results before Start's server-function
// error handling can log or serialize them (mandatory Phase 2 error-sanitization gate).
export async function runGuarded<T>(work: () => Promise<T>): Promise<T | FnError> {
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

// Exact Origin check on top of the framework CSRF middleware for every app-data request.
function isSameOriginRequest(): boolean {
  try {
    return getRequest().headers.get('origin') === serverEnv.appOrigin;
  } catch {
    return false;
  }
}

export function isGuardedMutation(): boolean {
  return isJsonRequest() && isSameOriginRequest();
}

export function requestAuth() {
  return createRequestAuth(getRequest().headers.get('cookie'));
}

// clearSession deletes the request's session cookies on the response, so a signed-out or revoked
// session cannot be replayed after the handler denies it.
export function applyAuthCookies(auth: RequestAuth, clearSession = false) {
  const extra = clearSession ? clearSessionCookies(auth.cookieHeader) : [];
  setResponseHeaders(authCookieHeaders([...auth.cookies, ...extra], auth.headers));
}

// One gate for every host handler: live session plus AAL2; only a revoked session is cleared, so
// a valid AAL1 session can still finish the step-up.
export async function aal2Host(): Promise<VerifiedSession | FnError> {
  const auth = requestAuth();
  const gate = await aal2Session(auth.client);
  applyAuthCookies(auth, gate.outcome === 'invalid');
  if (gate.outcome !== 'ok') return { error: 'auth_required' };
  return gate.session;
}
