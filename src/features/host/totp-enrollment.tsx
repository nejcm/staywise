import { useState, type FormEvent } from 'react';
import { Button } from '../../components/button';
import { Field } from '../../components/field';
import { Toast } from '../../components/toast';
import type { FnError } from '../../lib/fn-guards.server';
import { mfaVerify, restartEnrollment } from './host-fns';

type Started = { factorId: string; secret: string } | FnError;

// Enroll-or-verify form shared by the workspace gate and the settings page; interrupted means an
// unverified factor exists whose secret is no longer shown.
export function TotpEnrollment({
  factorId,
  interrupted = false,
  start,
  onVerified,
}: {
  factorId: string | null;
  interrupted?: boolean;
  start: () => Promise<Started>;
  onVerified: () => Promise<void>;
}) {
  const [factor, setFactor] = useState(factorId ? { factorId, secret: null as string | null } : null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const failed = 'Something went wrong. Try again.';

  async function begin(call: () => Promise<Started>) {
    setBusy(true);
    setMessage('');
    try {
      const result = await call();
      if ('error' in result) setMessage(failed);
      else setFactor({ factorId: result.factorId, secret: result.secret });
    } catch {
      setMessage(failed);
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!factor) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await mfaVerify({ data: { factorId: factor.factorId, code } });
      if ('error' in result) {
        setMessage(result.error === 'invalid_code' ? 'That code did not match. Try again.' : failed);
        return;
      }
      setCode('');
      setFactor(null);
      await onVerified();
    } catch {
      setMessage(failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {factor ? (
        <form onSubmit={verify} className="stack" data-testid="host-verify-form">
          {factor.secret ? (
            <p>
              Add this secret to your authenticator app: <code data-testid="host-secret">{factor.secret}</code>
            </p>
          ) : interrupted ? (
            <div className="stack" data-testid="host-enroll-interrupted">
              <p>
                Enrollment was not finished. Enter a current code if the secret was already saved, or restart to get a
                new one.
              </p>
              <Button
                type="button"
                onClick={() => begin(() => restartEnrollment({ data: {} }))}
                disabled={busy}
                data-testid="host-enroll-start"
              >
                Restart enrollment
              </Button>
            </div>
          ) : null}
          <Field label="Six-digit code">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              data-testid="host-code"
            />
          </Field>
          <Button type="submit" variant="primary" disabled={busy} data-testid="host-verify-submit">
            Verify
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="primary"
          onClick={() => begin(start)}
          disabled={busy}
          data-testid="host-enroll-start"
        >
          Set up authenticator
        </Button>
      )}
      <Toast testId="host-message" tone={message ? 'error' : undefined}>
        {message}
      </Toast>
    </div>
  );
}
