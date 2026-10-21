import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';

const failure = { text: 'Something went wrong. Try again.', failed: true };

// Busy state, a notice, and a refresh on success for one host action; onSuccess runs after it and may return the notice text.
export function useHostAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ text: '', failed: false });

  async function run<R extends object>(
    call: () => Promise<R>,
    onSuccess?: (result: Exclude<R, { error: string }>) => string | void | Promise<string | void>,
  ): Promise<void> {
    setBusy(true);
    setNotice({ text: '', failed: false });
    try {
      const result = await call();
      if ('error' in result) {
        setNotice(failure);
        return;
      }
      await router.invalidate();
      setNotice({ text: (await onSuccess?.(result as Exclude<R, { error: string }>)) ?? '', failed: false });
    } catch {
      setNotice(failure);
    } finally {
      setBusy(false);
    }
  }

  return { busy, notice, setNotice, run };
}
