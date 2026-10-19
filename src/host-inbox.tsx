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

  return (
    <section data-testid="inbox-panel">
      <h2>Guest messages</h2>
      <p role="status" data-testid="inbox-notice">
        {notice}
      </p>
      {messages === null ? (
        <p data-testid="inbox-unavailable">Inbox unavailable.</p>
      ) : messages.length === 0 ? (
        <p data-testid="inbox-empty">No guest messages yet.</p>
      ) : (
        <ul data-testid="inbox-list">
          {messages.map((entry) => (
            <li key={entry.id} data-testid="inbox-item" data-state={entry.state} data-kind={entry.kind}>
              <p>
                <strong data-testid="inbox-item-kind">{entry.kind === 'question' ? 'Question' : 'Issue'}</strong>
                {' · '}
                <span data-testid="inbox-item-locale">{guestLocaleName(entry.locale)}</span>
                {' · '}
                <span data-testid="inbox-item-created">{stamp(entry.createdAt)}</span>
                {' · '}
                <span data-testid="inbox-item-state">{entry.state === 'handled' ? 'Handled' : 'New'}</span>
                {entry.handledAt ? <span data-testid="inbox-item-handled"> {stamp(entry.handledAt)}</span> : null}
              </p>
              {entry.category ? <p className="guest-category">{sectionCategoryLabels[entry.category]}</p> : null}
              <p className="guest-body" data-testid="inbox-item-body">
                {entry.body}
              </p>
              {entry.followUpEmail ? (
                <p data-testid="inbox-item-email">
                  {entry.followUpEmail}{' '}
                  <span data-testid="inbox-item-email-unverified">(unverified — guest-supplied, not confirmed)</span>
                </p>
              ) : null}
              {entry.kind === 'question' ? (
                <p>
                  <label htmlFor={`inbox-answer-${entry.id}`}>Answer was in the guide?</label>{' '}
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
                </p>
              ) : null}
              <p>
                <button
                  type="button"
                  disabled={busyIds.has(entry.id) || entry.state === 'handled'}
                  onClick={() =>
                    void run(entry.id, () => markInboxHandled({ data: { propertyId, messageId: entry.id } }))
                  }
                  data-testid={`inbox-handle-${entry.id}`}
                >
                  Mark handled
                </button>{' '}
                <button
                  type="button"
                  disabled={busyIds.has(entry.id)}
                  onClick={() => {
                    if (!window.confirm('Delete this guest message permanently?')) return;
                    void run(entry.id, () => deleteInboxMessage({ data: { propertyId, messageId: entry.id } }));
                  }}
                  data-testid={`inbox-delete-${entry.id}`}
                >
                  Delete
                </button>
              </p>
            </li>
          ))}
        </ul>
      )}
      {messages?.length === inboxLimit ? (
        <p data-testid="inbox-truncated">
          Showing the newest {inboxLimit} messages. Delete or wait for older ones to expire to see the rest.
        </p>
      ) : null}
    </section>
  );
}
