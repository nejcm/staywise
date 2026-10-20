import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/button';
import { CallStrip } from './guest-essentials';
import { Field } from '../../components/field';
import { sectionCategories, type SectionCategory } from '../guide/guide-validation';
import { guestCategoryLabel, guestUiText } from './guest-ui';
import { type MessageKind } from '../messages/message-validation';
import styles from './guest.module.css';

type Snapshot = {
  kind: MessageKind;
  category: SectionCategory;
  body: string;
  replyEmail: string;
};

const fieldIds = {
  category: 'guest-message-category',
  body: 'guest-message-body',
  replyEmail: 'guest-message-email',
};

export function summaryEntries(
  fields: Record<string, string>,
): { field: keyof typeof fieldIds; id: string; code: string }[] {
  return (Object.keys(fieldIds) as (keyof typeof fieldIds)[])
    .filter((field) => fields[field])
    .map((field) => ({ field, id: fieldIds[field], code: fields[field] }));
}

export function messageExcerpt(body: string, max = 120): string {
  const text = body.trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export function SentRecap({
  snapshot,
  locale,
  onAgain,
  phone = null,
}: {
  snapshot: Snapshot;
  locale: string;
  onAgain: () => void;
  phone?: string | null;
}) {
  return (
    <div data-testid="guest-message-sent">
      <p className={styles.sent}>{guestUiText(locale, 'form.sent')}</p>
      <dl className={styles.recap} data-testid="guest-message-recap">
        <dt>{guestUiText(locale, 'form.kind')}</dt>
        <dd>{guestUiText(locale, snapshot.kind === 'issue' ? 'form.kind.issue' : 'form.kind.question')}</dd>
        <dt>{guestUiText(locale, 'form.category')}</dt>
        <dd>{guestCategoryLabel(locale, snapshot.category)}</dd>
        <dt>{guestUiText(locale, 'form.body')}</dt>
        <dd>{messageExcerpt(snapshot.body)}</dd>
        <dt>{guestUiText(locale, 'form.replyAsk')}</dt>
        <dd>{guestUiText(locale, snapshot.replyEmail ? 'form.yes' : 'form.no')}</dd>
      </dl>
      <p className={styles.fallback} data-testid="guest-message-reply-note">
        {guestUiText(locale, 'form.noReply')}
      </p>
      {phone ? (
        <CallStrip
          phone={phone}
          locale={locale}
          text="help.urgentAfterSend"
          variant="secondary"
          testId="guest-sent-call"
        />
      ) : null}
      <p>
        <Button type="button" variant="secondary" onClick={onAgain} data-testid="guest-message-again">
          {guestUiText(locale, 'form.sendAnother')}
        </Button>
      </p>
    </div>
  );
}

// Guest question/report form: one bounded same-origin POST; every failure keeps the guest's text in
// the form and shows a localized reason. It never promises a reply or a response time.
export function GuestMessageForm({
  shareId,
  locale,
  phone = null,
}: {
  shareId: string;
  locale: string;
  phone?: string | null;
}) {
  const [kind, setKind] = useState<MessageKind>('question');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');
  const [wantReply, setWantReply] = useState(false);
  const [replyEmail, setReplyEmail] = useState('');
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Snapshot | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const focusFirst = useRef(false);
  const summary = summaryEntries(sendErrors);

  useEffect(() => {
    if (summaryEntries(sendErrors).length) summaryRef.current?.focus();
  }, [sendErrors]);

  useEffect(() => {
    if (sent || !focusFirst.current) return;
    focusFirst.current = false;
    firstFieldRef.current?.focus();
  }, [sent]);

  function sendAnother() {
    setKind('question');
    setCategory('');
    setBody('');
    setWantReply(false);
    setReplyEmail('');
    setSendErrors({});
    setNotice('');
    focusFirst.current = true;
    setSent(null);
  }

  function fieldError(code: string): string {
    if (code === 'message_required') return guestUiText(locale, 'form.bodyRequired');
    if (code === 'message_too_long') return guestUiText(locale, 'form.bodyTooLong');
    if (code === 'message_invalid') return guestUiText(locale, 'form.bodyInvalid');
    if (code === 'email_invalid') return guestUiText(locale, 'form.emailInvalid');
    if (code === 'email_required') return guestUiText(locale, 'form.emailRequired');
    if (code === 'category_invalid') return guestUiText(locale, 'form.categoryRequired');
    return guestUiText(locale, 'form.error');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (wantReply && !replyEmail.trim()) {
      setNotice('');
      setSendErrors({ replyEmail: 'email_required' });
      return;
    }
    setBusy(true);
    setSendErrors({});
    setNotice('');
    // The address only leaves the browser when the guest explicitly asked for a reply.
    const snapshot: Snapshot = {
      kind,
      category: category as SectionCategory,
      body,
      replyEmail: wantReply ? replyEmail : '',
    };
    try {
      const response = await fetch(`/g/${shareId}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...snapshot,
          locale,
        }),
      });
      const payload: { state?: string; fields?: Record<string, string> } = await response.json().catch(() => ({}));
      if (response.ok && payload.state === 'ok') {
        setSent(snapshot);
        return;
      }
      if (response.status === 429) {
        setNotice(guestUiText(locale, 'form.rateLimited'));
        return;
      }
      if (response.status === 400 && payload.fields) {
        setSendErrors(payload.fields);
        // Kind and locale errors have no field of their own on the form.
        if (!summaryEntries(payload.fields).length) setNotice(guestUiText(locale, 'form.error'));
        return;
      }
      if (response.status === 403) {
        setNotice(guestUiText(locale, 'form.denied'));
        return;
      }
      setNotice(guestUiText(locale, 'form.error'));
    } catch {
      setNotice(guestUiText(locale, 'form.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} data-testid="guest-message-form">
      <h3>{guestUiText(locale, 'help.form.title')}</h3>
      {sent ? (
        <SentRecap snapshot={sent} locale={locale} onAgain={sendAnother} phone={phone} />
      ) : (
        <>
          <p>{guestUiText(locale, 'help.form.intro')}</p>
          <p className={styles.fallback}>{guestUiText(locale, 'help.form.privacy')}</p>
          <form className={styles.form} onSubmit={submit} noValidate>
            {summary.length ? (
              <div
                ref={summaryRef}
                role="alert"
                tabIndex={-1}
                className={styles.alert}
                data-testid="guest-message-summary"
              >
                <p>{guestUiText(locale, 'form.fixTitle')}</p>
                <ul>
                  {summary.map((entry) => (
                    <li key={entry.field}>
                      <a
                        href={`#${entry.id}`}
                        onClick={(event) => {
                          // A native hash navigation re-runs the guest loader through /_serverFn, where the /g cookie is absent.
                          event.preventDefault();
                          document.getElementById(entry.id)?.focus();
                        }}
                      >
                        {fieldError(entry.code)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <fieldset className={styles.formFields} disabled={busy}>
              <fieldset>
                <legend>{guestUiText(locale, 'form.kind')}</legend>
                <div className={styles.segments}>
                  <label>
                    <input
                      type="radio"
                      name="guest-message-kind"
                      ref={firstFieldRef}
                      checked={kind === 'question'}
                      onChange={() => setKind('question')}
                      data-testid="guest-message-kind-question"
                    />{' '}
                    {guestUiText(locale, 'form.kind.question')}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="guest-message-kind"
                      checked={kind === 'issue'}
                      onChange={() => setKind('issue')}
                      data-testid="guest-message-kind-issue"
                    />{' '}
                    {guestUiText(locale, 'form.kind.issue')}
                  </label>
                </div>
              </fieldset>
              <Field
                label={guestUiText(locale, 'form.category')}
                error={sendErrors.category ? fieldError(sendErrors.category) : null}
                errorTestId="guest-message-category-error"
                errorId="guest-message-category-error"
              >
                <select
                  id="guest-message-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  aria-invalid={Boolean(sendErrors.category)}
                  aria-describedby={sendErrors.category ? 'guest-message-category-error' : undefined}
                  data-testid="guest-message-category"
                >
                  <option value="">{guestUiText(locale, 'form.category.choose')}</option>
                  {sectionCategories.map((option) => (
                    <option key={option} value={option}>
                      {guestCategoryLabel(locale, option)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={guestUiText(locale, 'form.body')}
                error={sendErrors.body ? fieldError(sendErrors.body) : null}
                errorTestId="guest-message-body-error"
                errorId="guest-message-body-error"
              >
                <textarea
                  id="guest-message-body"
                  rows={5}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  aria-invalid={Boolean(sendErrors.body)}
                  aria-describedby={sendErrors.body ? 'guest-message-body-error' : undefined}
                  data-testid="guest-message-body"
                />
              </Field>
              <p>
                <label>
                  <input
                    type="checkbox"
                    checked={wantReply}
                    onChange={(event) => {
                      setWantReply(event.target.checked);
                      if (!event.target.checked) setSendErrors(({ replyEmail: _hidden, ...rest }) => rest);
                    }}
                    data-testid="guest-message-reply-ask"
                  />{' '}
                  {guestUiText(locale, 'form.replyAsk')}
                </label>
              </p>
              {wantReply ? (
                <Field
                  label={guestUiText(locale, 'form.replyEmail')}
                  error={sendErrors.replyEmail ? fieldError(sendErrors.replyEmail) : null}
                  errorTestId="guest-message-email-error"
                  errorId="guest-message-email-error"
                >
                  <input
                    id="guest-message-email"
                    type="email"
                    value={replyEmail}
                    onChange={(event) => setReplyEmail(event.target.value)}
                    aria-invalid={Boolean(sendErrors.replyEmail)}
                    aria-describedby={sendErrors.replyEmail ? 'guest-message-email-error' : undefined}
                    data-testid="guest-message-email"
                  />
                </Field>
              ) : null}
              <p>
                <Button type="submit" variant="primary" aria-busy={busy} data-testid="guest-message-submit">
                  {guestUiText(locale, busy ? 'form.sending' : 'form.submit')}
                </Button>
              </p>
            </fieldset>
            {notice ? (
              <p role="alert" className={styles.alert} data-testid="guest-message-error">
                {notice}
              </p>
            ) : null}
            {notice && phone ? (
              <CallStrip
                phone={phone}
                locale={locale}
                text="help.urgentAfterSend"
                variant="secondary"
                testId="guest-failed-call"
              />
            ) : null}
          </form>
        </>
      )}
    </section>
  );
}
