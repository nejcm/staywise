import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { HostShell } from '../components/app-shell';
import { Button } from '../components/button';
import { Field } from '../components/field';
import { useHostAction } from '../components/host-action';
import { Toast } from '../components/toast';
import { categoryIcon, Icon } from '../components/icons';
import { getHelpPage } from '../features/host/settings-fns';
import { submitSupportRequest } from '../features/host/support-fns';
import { categoryIdeas, helpSteps } from '../features/host/host-guidance';
import { sectionCategories, sectionCategoryLabels, supportRequestInput } from '../features/guide/guide-validation';
import styles from '../features/host/host.module.css';

export const Route = createFileRoute('/host_/help')({
  loader: async () => {
    const page = await getHelpPage();
    if ('error' in page) throw redirect({ to: '/auth/sign-in' });
    if ('redirect' in page) throw redirect({ to: page.redirect });
    return page;
  },
  component: HelpPage,
});

function HelpPage() {
  const { email, supportEnabled } = Route.useLoaderData();
  return (
    <HostShell email={email}>
      <div className={styles.head}>
        <div>
          <h1>Host guide</h1>
          <p className={styles.sub}>From an empty property to a guide your guests actually use.</p>
        </div>
      </div>
      <section className={`${styles.panel} stack`} aria-labelledby="help-steps-heading">
        <h2 id="help-steps-heading">Getting started</h2>
        <ol className="stack" data-testid="help-steps">
          {helpSteps.map((step) => (
            <li key={step.title}>
              <strong>{step.title}.</strong> {step.body}
            </li>
          ))}
        </ol>
        <p className="small muted">
          Not sure what is left? Each property editor has a checklist at the top that jumps to the missing field.
        </p>
      </section>
      <section className={`${styles.panel} stack`} aria-labelledby="help-ideas-heading">
        <h2 id="help-ideas-heading">What to write in each section</h2>
        {sectionCategories.map((category) => (
          <div key={category} className="stack" data-testid={`help-ideas-${category}`}>
            <h3>
              <Icon icon={categoryIcon(category)} /> {sectionCategoryLabels[category]}
            </h3>
            <ul>
              {categoryIdeas[category].map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <section className={`${styles.panel} stack`} aria-labelledby="help-good-heading">
        <h2 id="help-good-heading">Good habits</h2>
        <ul>
          <li>Write for someone arriving tired, at night, with one bar of signal.</li>
          <li>
            Use the languages your guests speak. Generated translations are drafts until you approve them; guests see
            your original text meanwhile.
          </li>
          <li>Create a stay link per reservation: it expires the day after checkout, so old guests lose access.</li>
          <li>If a link leaks, rotate it. Rotating signs everyone out of the old link.</li>
        </ul>
        <p className="small muted">
          Security and privacy details are in <Link to="/host/settings">Settings</Link> and the{' '}
          <Link to="/privacy">privacy notice</Link>.
        </p>
      </section>
      {supportEnabled && (
        <section className={`${styles.panel} stack`} aria-labelledby="help-report-heading">
          <h2 id="help-report-heading">Report an issue or ask for help</h2>
          <ReportForm />
        </section>
      )}
    </HostShell>
  );
}

function ReportForm() {
  const { busy, notice, setNotice, run } = useHostAction();
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const parsed = supportRequestInput.safeParse({ kind: formData.get('kind'), message: formData.get('message') });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '');
      setNotice({ text: '', failed: false });
      return;
    }
    setError('');
    await run(
      () => submitSupportRequest({ data: parsed.data }),
      () => {
        form.reset();
        return 'Sent. Thank you.';
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="stack" data-testid="report-form">
      <p className="small muted">
        Do not include guest names, messages, or access links. Replies go to your sign-in address.
      </p>
      <Field label="Type">
        <select name="kind" defaultValue="issue" data-testid="report-kind">
          <option value="issue">Something is broken</option>
          <option value="help">I need help</option>
        </select>
      </Field>
      <Field label="What happened?" error={error} errorId="report-message-error" errorTestId="report-message-error">
        <textarea
          name="message"
          maxLength={2000}
          rows={5}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'report-message-error' : undefined}
          data-testid="report-message"
        />
      </Field>
      <div className="actions">
        <Button type="submit" variant="primary" disabled={busy} data-testid="report-send">
          Send
        </Button>
        <Toast testId="report-status" tone={notice.failed ? 'error' : undefined}>
          {notice.text}
        </Toast>
      </div>
    </form>
  );
}
