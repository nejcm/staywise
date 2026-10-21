import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';

const failure = { text: 'Something went wrong. Try again.', failed: true };

// Busy state, a notice, and a refresh after success for one host action; onSuccess may return the success text.
export function useHostAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ text: '', failed: false });

  async function run<R extends object>(
    call: () => Promise<R | { error: string }>,
    onSuccess?: (result: R) => string | void | Promise<string | void>,
  ): Promise<void> {
    setBusy(true);
    setNotice({ text: '', failed: false });
    try {
      const result = await call();
      if ('error' in result) {
        setNotice(failure);
        return;
      }
      setNotice({ text: (await onSuccess?.(result as R)) ?? '', failed: false });
      await router.invalidate();
    } catch {
      setNotice(failure);
    } finally {
      setBusy(false);
    }
  }

  return { busy, notice, setNotice, run };
}
