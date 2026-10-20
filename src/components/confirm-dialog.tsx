import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './button';
import styles from './confirm-dialog.module.css';

type Request = { title: string; body: string; confirmLabel: string };

/** Promise-based replacement for window.confirm; render `dialog` once in the caller. */
export function useConfirmDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const titleId = useId();

  useEffect(() => () => resolveRef.current?.(false), []);

  function confirm(next: Request) {
    resolveRef.current?.(false);
    setRequest(next);
    ref.current?.showModal();
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }

  // Native close() returns focus to the opener; Escape reaches here through onClose.
  function settle(confirmed: boolean) {
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
    ref.current?.close();
  }

  const dialog = (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={() => settle(false)}>
      <h2 id={titleId}>{request?.title}</h2>
      <p>{request?.body}</p>
      <div className="actions">
        <Button type="button" onClick={() => settle(false)} data-testid="confirm-cancel">
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={() => settle(true)} data-testid="confirm-accept">
          {request?.confirmLabel}
        </Button>
      </div>
    </dialog>
  );

  return { confirm, dialog };
}
