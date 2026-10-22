import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { HostShell } from '../components/app-shell';
import { categoryIcon, Icon } from '../components/icons';
import { getHostAuthState } from '../features/host/host-fns';
import { getHostSettings } from '../features/host/settings-fns';
import { categoryIdeas, helpSteps } from '../features/host/host-guidance';
import { sectionCategories, sectionCategoryLabels } from '../features/guide/guide-validation';
import styles from '../features/host/host.module.css';

export const Route = createFileRoute('/host_/help')({
  loader: async () => {
    const state = await getHostAuthState();
    if ('error' in state || state.state === 'signed_out') throw redirect({ to: '/auth/sign-in' });
    if (state.state !== 'workspace') throw redirect({ to: '/host' });
    const result = await getHostSettings();
    if ('error' in result) throw redirect({ to: '/host' });
    return { email: result.email };
  },
  component: HelpPage,
});

function HelpPage() {
  const { email } = Route.useLoaderData();
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
    </HostShell>
  );
}
