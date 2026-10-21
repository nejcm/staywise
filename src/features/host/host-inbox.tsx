import { useRouter } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/button';
import { Icon } from '../../components/icons';
import { useConfirmDialog } from '../../components/confirm-dialog';
import { Pill } from '../../components/pill';
import { Toast } from '../../components/toast';
import { guestLocaleName } from '../guest/guest-ui';
import { sectionCategoryLabels } from '../guide/guide-validation';
import { inboxLimit } from '../messages/message-validation';
import { deleteInboxMessage, markInboxHandled, tagInboxAnswer } from '../messages/messages-fns';
import type { InboxMessage } from '../messages/messages.server';
import styles from './host.module.css';

// Host inbox: one property-scoped, newest-first list. Guest text is shown verbatim here and nowhere
// else; the reply address stays visibly unverified and the alert mail never carries either.
export function InboxPanel({ propertyId, messages }: { propertyId: string; messages: InboxMessage[] | null }) {
  const router = useRouter();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState({ text: '', failed: false });
  const { confirm, dialog } = useConfirmDialog();

  function stamp(iso: string): string {
    return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
  }

  async function run(messageId: string, work: () => Promise<{ error: string } | { ok: boolean }>): Promise<void> {
    setBusyIds((current) => new Set(current).add(messageId));
    setNotice({ text: '', failed: false });
    try {
      const result = await work();
      if ('error' in result) setNotice({ text: 'Something went wrong. Try again.', failed: true });
      else if (!result.ok) setNotice({ text: 'Nothing changed — the inbox below is refreshed.', failed: false });
      await router.invalidate();
    } catch {
      setNotice({ text: 'Something went wrong. Try again.', failed: true });
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
    }
  }

  const waiting = messages?.filter((entry) => entry.state !== 'handled').length ?? 0;

  return (
    <section className={styles.panel} aria-labelledby="inbox-heading" data-testid="inbox-panel">
      <header className={styles.panelHead}>
        <h2 id="inbox-heading">Guest messages</h2>
        {messages && messages.length > 0 ? (
          <span className={styles.count}>{waiting === 0 ? 'All handled' : `${waiting} waiting for you`}</span>
        ) : null}
      </header>
      <Toast testId="inbox-notice" tone={notice.failed ? 'error' : undefined}>
        {notice.text}
      </Toast>
      {messages === null ? (
        <p className={styles.empty} data-testid="inbox-unavailable">
          Inbox unavailable.
        </p>
      ) : messages.length === 0 ? (
        <p className={styles.empty} data-testid="inbox-empty">
          No guest messages yet. Questions and issue reports from the guide's Help page land here.
        </p>
      ) : (
        <ul className={styles.rows} data-testid="inbox-list">
          {messages.map((entry) => (
            <li
              key={entry.id}
              className={styles.message}
              data-testid="inbox-item"
              data-state={entry.state}
              data-kind={entry.kind}
            >
              <p className={styles.meta}>
                <Pill tone={entry.kind === 'question' ? 'accent' : 'attention'} testId="inbox-item-kind">
                  {entry.kind === 'question' ? 'Question' : 'Issue'}
                </Pill>
                {entry.category ? <span>{sectionCategoryLabels[entry.category]}</span> : null}
                <span data-testid="inbox-item-locale">{guestLocaleName(entry.locale)}</span>
                <span data-testid="inbox-item-created">{stamp(entry.createdAt)}</span>
                <Pill tone={entry.state === 'handled' ? 'positive' : 'attention'} testId="inbox-item-state">
                  {entry.state === 'handled' ? (
                    <>
                      <Icon icon={Check} />
                      Handled
                    </>
                  ) : (
                    'New'
                  )}
                </Pill>
                {entry.handledAt ? <span data-testid="inbox-item-handled"> {stamp(entry.handledAt)}</span> : null}
              </p>
              <p className={styles.messageBody} data-testid="inbox-item-body">
                {entry.body}
              </p>
              {entry.followUpEmail ? (
                <p className={styles.email} data-testid="inbox-item-email">
                  Reply address: {entry.followUpEmail}{' '}
                  <span data-testid="inbox-item-email-unverified">(unverified — guest-supplied, not confirmed)</span>
                </p>
              ) : null}
              <div className={styles.messageFoot}>
                {entry.kind === 'question' ? (
                  <label htmlFor={`inbox-answer-${entry.id}`}>
                    Answer was in the guide?
                    <select
                      id={`inbox-answer-${entry.id}`}
                      className="control-sm"
                      value={entry.answerInGuide === null ? '' : entry.answerInGuide ? 'yes' : 'no'}
                      disabled={busyIds.has(entry.id)}
                      onChange={(event) =>
                        void run(entry.id, () =>
                          tagInboxAnswer({
                            data: {
                              propertyId,
                              messageId: entry.id,
                              answerInGuide: event.target.value === 'yes',
                            },
                          }),
                        )
                      }
                      data-testid={`inbox-answer-${entry.id}`}
                    >
                      <option value="" disabled>
                        Not tagged
                      </option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                ) : (
                  <span />
                )}
                <div className="actions">
                  <Button
                    type="button"
                    size="sm"
                    variant={entry.state === 'handled' ? undefined : 'primary'}
                    disabled={busyIds.has(entry.id) || entry.state === 'handled'}
                    onClick={() =>
                      void run(entry.id, () => markInboxHandled({ data: { propertyId, messageId: entry.id } }))
                    }
                    data-testid={`inbox-handle-${entry.id}`}
                  >
                    Mark handled
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger-outline"
                    disabled={busyIds.has(entry.id)}
                    onClick={async () => {
                      const confirmed = await confirm({
                        title: 'Delete this guest message?',
                        body: 'It is removed permanently.',
                        confirmLabel: 'Delete message',
                      });
                      if (!confirmed) return;
                      void run(entry.id, () => deleteInboxMessage({ data: { propertyId, messageId: entry.id } }));
                    }}
                    data-testid={`inbox-delete-${entry.id}`}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {messages?.length === inboxLimit ? (
        <p className="small muted" data-testid="inbox-truncated">
          Showing the newest {inboxLimit} messages. Delete or wait for older ones to expire to see the rest.
        </p>
      ) : null}
      {dialog}
    </section>
  );
}
