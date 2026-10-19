import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { guestLocaleName } from './guest-ui';
import { sectionCategoryLabels } from './guide-validation';
import { inboxLimit } from './message-validation';
import { deleteInboxMessage, markInboxHandled, tagInboxAnswer } from './messages-fns';
import type { InboxMessage } from './messages.server';

// Host inbox: one property-scoped, newest-first list. Guest text is shown verbatim here and nowhere
// else; the reply address stays visibly unverified and the alert mail never carries either.
export function InboxPanel({ propertyId, messages }: { propertyId: string; messages: InboxMessage[] | null }) {
  const router = useRouter();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState('');

  function stamp(iso: string): string {
    return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
  }

  async function run(messageId: string, work: () => Promise<{ error: string } | { ok: boolean }>): Promise<void> {
    setBusyIds((current) => new Set(current).add(messageId));
    setNotice('');
    try {
      const result = await work();
      if ('error' in result) setNotice('Something went wrong. Try again.');
      else if (!result.ok) setNotice('Nothing changed — the inbox below is refreshed.');
      await router.invalidate();
    } catch {
      setNotice('Something went wrong. Try again.');
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
    <section className="panel" aria-labelledby="inbox-heading" data-testid="inbox-panel">
      <header>
        <h2 id="inbox-heading">Guest messages</h2>
        {messages && messages.length > 0 ? (
          <span className="muted small">{waiting === 0 ? 'All handled' : `${waiting} waiting for you`}</span>
        ) : null}
      </header>
      <p role="status" className="small" data-testid="inbox-notice">
        {notice}
      </p>
      {messages === null ? (
        <p className="empty" data-testid="inbox-unavailable">
          Inbox unavailable.
        </p>
      ) : messages.length === 0 ? (
        <p className="empty" data-testid="inbox-empty">
          No guest messages yet. Questions and issue reports from the guide's Help page land here.
        </p>
      ) : (
        <ul className="rows" data-testid="inbox-list">
          {messages.map((entry) => (
            <li
              key={entry.id}
              className="message"
              data-testid="inbox-item"
              data-state={entry.state}
              data-kind={entry.kind}
            >
              <p className="message-meta">
                <span className={entry.kind === 'question' ? 'pill' : 'pill issue'} data-testid="inbox-item-kind">
                  {entry.kind === 'question' ? 'Question' : 'Issue'}
                </span>
                {entry.category ? <span>{sectionCategoryLabels[entry.category]}</span> : null}
                <span data-testid="inbox-item-locale">{guestLocaleName(entry.locale)}</span>
                <span data-testid="inbox-item-created">{stamp(entry.createdAt)}</span>
                <span className={entry.state === 'handled' ? undefined : 'pill new'} data-testid="inbox-item-state">
                  {entry.state === 'handled' ? 'Handled' : 'New'}
                </span>
                {entry.handledAt ? <span data-testid="inbox-item-handled"> {stamp(entry.handledAt)}</span> : null}
              </p>
              <p className="message-body" data-testid="inbox-item-body">
                {entry.body}
              </p>
              {entry.followUpEmail ? (
                <p className="small" style={{ marginTop: 8 }} data-testid="inbox-item-email">
                  Reply address: {entry.followUpEmail}{' '}
                  <span className="muted" data-testid="inbox-item-email-unverified">
                    (unverified — guest-supplied, not confirmed)
                  </span>
                </p>
              ) : null}
              <div className="message-foot">
                {entry.kind === 'question' ? (
                  <label htmlFor={`inbox-answer-${entry.id}`}>
                    Answer was in the guide?
                    <select
                      id={`inbox-answer-${entry.id}`}
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
                  <button
                    type="button"
                    className={entry.state === 'handled' ? undefined : 'primary'}
                    disabled={busyIds.has(entry.id) || entry.state === 'handled'}
                    onClick={() =>
                      void run(entry.id, () => markInboxHandled({ data: { propertyId, messageId: entry.id } }))
                    }
                    data-testid={`inbox-handle-${entry.id}`}
                  >
                    Mark handled
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busyIds.has(entry.id)}
                    onClick={() => {
                      if (!window.confirm('Delete this guest message permanently?')) return;
                      void run(entry.id, () => deleteInboxMessage({ data: { propertyId, messageId: entry.id } }));
                    }}
                    data-testid={`inbox-delete-${entry.id}`}
                  >
                    Delete
                  </button>
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
    </section>
  );
}
