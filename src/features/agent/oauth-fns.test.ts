import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withOwnerContext } from '../../lib/db.server';
import { isGuardedMutation } from '../../lib/fn-guards.server';
import { sendSecurityNotice } from '../../lib/mail.server';
import { aal2Session } from '../auth/auth.server';
import { approveConsent, getConsent } from './oauth-fns';
import { approveAuthorization, checkAuthorizeRequest, type AuthorizeCheck } from './oauth.server';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ validator: () => ({ handler: (fn: unknown) => fn }) }),
}));
vi.mock('../../lib/fn-guards.server', () => ({
  requestAuth: () => ({ client: {} }),
  applyAuthCookies: vi.fn(),
  isGuardedMutation: vi.fn(),
  runGuarded: (work: () => Promise<unknown>) => work(),
}));
vi.mock('../../lib/db.server', () => ({ withOwnerContext: vi.fn() }));
vi.mock('../../lib/mail.server', () => ({ sendSecurityNotice: vi.fn() }));
vi.mock('../auth/auth.server', () => ({ aal2Session: vi.fn() }));
vi.mock('./oauth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./oauth.server')>()),
  checkAuthorizeRequest: vi.fn(),
  approveAuthorization: vi.fn(),
}));

const consent = getConsent as unknown as (input: { data: unknown }) => Promise<Record<string, unknown>>;
const approve = approveConsent as unknown as (input: { data: unknown }) => Promise<Record<string, unknown>>;
const session = { userId: '00000000-0000-4000-8000-000000000002', email: 'synthetic-host@example.test' };
const ready: AuthorizeCheck = {
  state: 'ok',
  client: { clientId: 'https://claude.ai/oauth/client.json', name: 'Synthetic Claude', redirectUris: [] },
  redirectUri: 'http://127.0.0.1:4000/callback',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  requestedScopes: ['read'],
  oauthState: 's',
  denyUrl: 'http://127.0.0.1:4000/callback?error=access_denied',
};
const params = { client_id: ready.client.clientId };

beforeEach(() => {
  vi.mocked(checkAuthorizeRequest).mockReset().mockResolvedValue(ready);
  vi.mocked(aal2Session)
    .mockReset()
    .mockResolvedValue({ outcome: 'ok', session } as never);
  vi.mocked(withOwnerContext).mockReset();
  vi.mocked(isGuardedMutation).mockReset().mockReturnValue(true);
  vi.mocked(approveAuthorization).mockReset().mockResolvedValue('http://127.0.0.1:4000/callback?code=x');
  vi.mocked(sendSecurityNotice).mockReset();
});

describe('getConsent', () => {
  it('asks to sign in or step up before showing any consent', async () => {
    vi.mocked(aal2Session).mockResolvedValue({ outcome: 'invalid' } as never);
    expect(await consent({ data: params })).toEqual({ state: 'sign_in' });
    vi.mocked(aal2Session).mockResolvedValue({ outcome: 'aal1' } as never);
    expect(await consent({ data: params })).toEqual({ state: 'verify' });
    expect(checkAuthorizeRequest).not.toHaveBeenCalled();
    expect(withOwnerContext).not.toHaveBeenCalled();
  });

  it('checks the request, and so fetches the client document, only after the session gate', async () => {
    vi.mocked(checkAuthorizeRequest).mockResolvedValue({ state: 'redirect', url: 'https://claude.ai/cb?error=x' });
    expect(await consent({ data: params })).toEqual({ state: 'redirect', url: 'https://claude.ai/cb?error=x' });
    expect(vi.mocked(aal2Session).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(checkAuthorizeRequest).mock.invocationCallOrder[0]!,
    );
  });

  it('shows client, bold redirect host, loopback flag and the host properties at AAL2', async () => {
    vi.mocked(withOwnerContext).mockResolvedValue([{ id: 'p1', name: 'Bled' }] as never);
    expect(await consent({ data: params })).toMatchObject({
      state: 'ok',
      clientName: 'Synthetic Claude',
      clientHost: 'claude.ai',
      redirectHost: '127.0.0.1:4000',
      loopback: true,
      requestedScopes: ['read'],
      properties: [{ id: 'p1', name: 'Bled' }],
    });
  });
});

describe('approveConsent', () => {
  const data = { params, scopes: ['read', 'read'], propertyId: null };

  it('re-checks the request and the session, then issues the code redirect', async () => {
    vi.mocked(withOwnerContext).mockImplementation(async (_owner, work) => work({} as never));
    expect(await approve({ data })).toEqual({ ok: true, url: 'http://127.0.0.1:4000/callback?code=x' });
    expect(checkAuthorizeRequest).toHaveBeenCalledWith(params);
    expect(approveAuthorization).toHaveBeenCalledWith({}, session.userId, ready, {
      scopes: ['read'],
      propertyId: null,
    });
    expect(sendSecurityNotice).toHaveBeenCalledWith(session.email, 'agent_grant_created');
  });

  it('refuses a cross-site post, an AAL1 session, a stale request or no scopes', async () => {
    vi.mocked(isGuardedMutation).mockReturnValue(false);
    expect(await approve({ data })).toEqual({ error: 'invalid_input' });
    vi.mocked(isGuardedMutation).mockReturnValue(true);
    expect(await approve({ data: { ...data, scopes: [] } })).toEqual({ error: 'invalid_input' });
    vi.mocked(checkAuthorizeRequest).mockResolvedValue({ state: 'error', message: 'x' });
    expect(await approve({ data })).toEqual({ error: 'invalid_input' });
    vi.mocked(checkAuthorizeRequest).mockResolvedValue(ready);
    vi.mocked(checkAuthorizeRequest).mockClear();
    vi.mocked(aal2Session).mockResolvedValue({ outcome: 'aal1' } as never);
    expect(await approve({ data })).toEqual({ error: 'auth_required' });
    expect(checkAuthorizeRequest).not.toHaveBeenCalled();
    expect(approveAuthorization).not.toHaveBeenCalled();
  });
});
