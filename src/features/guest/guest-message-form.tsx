import { useState, type FormEvent } from 'react';
import { Button } from '../../components/button';
import { Field } from '../../components/field';
import { sectionCategories } from '../guide/guide-validation';
import { guestCategoryLabel, guestUiText } from './guest-ui';
import { type MessageKind } from '../messages/message-validation';

// Guest question/report form: one bounded same-origin POST; every failure keeps the guest's text in
// the form and shows a localized reason. It never promises a reply or a response time.
export function GuestMessageForm({ shareId, locale }: { shareId: string; locale: string }) {
  const [kind, setKind] = useState<MessageKind>('question');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');
  const [wantReply, setWantReply] = useState(false);
  const [replyEmail, setReplyEmail] = useState('');
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  function fieldError(code: string): string {
    if (code === 'message_required') return guestUiText(locale, 'form.bodyRequired');
    if (code === 'message_too_long') return guestUiText(locale, 'form.bodyTooLong');
    if (code === 'message_invalid') return guestUiText(locale, 'form.bodyInvalid');
    if (code === 'email_invalid') return guestUiText(locale, 'form.emailInvalid');
    if (code === 'category_invalid') return guestUiText(locale, 'form.categoryRequired');
    return guestUiText(locale, 'form.error');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setSendErrors({});
    setNotice('');
    try {
      const response = await fetch(`/g/${shareId}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          category,
          locale,
          body,
          // The address only leaves the browser when the guest explicitly asked for a reply.
          replyEmail: wantReply ? replyEmail : '',
        }),
      });
      const payload: { state?: string; fields?: Record<string, string> } = await response.json().catch(() => ({}));
      if (response.ok && payload.state === 'ok') {
        setSent(true);
        return;
      }
      if (response.status === 429) {
        setNotice(guestUiText(locale, 'form.rateLimited'));
        return;
      }
      if (response.status === 400 && payload.fields) {
        setSendErrors(payload.fields);
        // Kind and locale errors have no field of their own on the form.
        const shown = ['category', 'body', 'replyEmail'].some((field) => payload.fields?.[field]);
        if (!shown) setNotice(guestUiText(locale, 'form.error'));
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
    <section className="guest-card" data-testid="guest-message-form">
      <h3>{guestUiText(locale, 'help.form.title')}</h3>
      {sent ? (
        <p data-testid="guest-message-sent">{guestUiText(locale, 'form.sent')}</p>
      ) : (
        <>
          <p>{guestUiText(locale, 'help.form.intro')}</p>
          <p className="guest-fallback">{guestUiText(locale, 'help.form.privacy')}</p>
          <form className="guest-form" onSubmit={submit} noValidate>
            <fieldset>
              <legend>{guestUiText(locale, 'form.kind')}</legend>
              <label>
                <input
                  type="radio"
                  name="guest-message-kind"
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
            </fieldset>
            <Field
              label={guestUiText(locale, 'form.category')}
              error={sendErrors.category ? fieldError(sendErrors.category) : null}
              errorTestId="guest-message-category-error"
            >
              <select
                id="guest-message-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-invalid={Boolean(sendErrors.category)}
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
            >
              <textarea
                id="guest-message-body"
                rows={5}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                aria-invalid={Boolean(sendErrors.body)}
                data-testid="guest-message-body"
              />
            </Field>
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={wantReply}
                  onChange={(event) => setWantReply(event.target.checked)}
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
              >
                <input
                  id="guest-message-email"
                  type="email"
                  value={replyEmail}
                  onChange={(event) => setReplyEmail(event.target.value)}
                  aria-invalid={Boolean(sendErrors.replyEmail)}
                  data-testid="guest-message-email"
                />
              </Field>
            ) : null}
            <p>
              <Button type="submit" variant="primary" disabled={busy} data-testid="guest-message-submit">
                {guestUiText(locale, 'form.submit')}
              </Button>
            </p>
            {notice ? (
              <p role="alert" data-testid="guest-message-error">
                {notice}
              </p>
            ) : null}
          </form>
        </>
      )}
    </section>
  );
}
