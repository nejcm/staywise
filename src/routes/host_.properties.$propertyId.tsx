import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { encode } from 'uqr';
import { getHostAuthState } from '../features/host/host-fns';
import {
  createSection,
  deleteProperty,
  getPropertyEditor,
  moveSectionOrder,
  resyncAlertEmail,
  saveProperty,
  saveSection,
  setGuidePublished,
} from '../features/guide/guide-fns';
import { createGuestLink, disableGuestLink, getGuestLink, rotateGuestLink } from '../features/share/share-fns';
import { getInbox } from '../features/messages/messages-fns';
import { InboxPanel } from '../features/host/host-inbox';
import { HostBar } from '../components/app-shell';
import { Button, buttonClass } from '../components/button';
import { useConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Pill } from '../components/pill';
import { Toast } from '../components/toast';
import {
  approveGuideTranslation,
  generateGuideTranslations,
  rejectGuideTranslation,
} from '../features/translation/translation-fns';
import type { ShareLinkState } from '../features/share/share.server';
import {
  approveTranslationInput,
  collectFieldErrors,
  createSectionInput,
  guestLocales,
  propertyFields,
  sectionCategories,
  sectionCategoryLabels,
  sectionFields,
  type SectionCategory,
  type SectionVisibility,
} from '../features/guide/guide-validation';
import { languageNames } from '../features/guest/guest-ui';
import type { GuideEditorData, GuideTranslation } from '../features/guide/guide.server';

export const Route = createFileRoute('/host_/properties/$propertyId')({
  loader: async ({ params }) => {
    const state = await getHostAuthState();
    if ('error' in state || state.state === 'signed_out') {
      throw redirect({ to: '/auth/sign-in' });
    }
    if (state.state !== 'workspace') {
      throw redirect({ to: '/host' });
    }
    const result = await getPropertyEditor({ data: { propertyId: params.propertyId } });
    if ('error' in result) {
      throw redirect({ to: '/host' });
    }
    const share = await getGuestLink({ data: { propertyId: params.propertyId } });
    const inbox = await getInbox({ data: { propertyId: params.propertyId } });
    return {
      editor: result.editor,
      share: 'error' in share ? null : share.share,
      inbox: 'error' in inbox ? null : inbox.messages,
    };
  },
  component: PropertyEditorPage,
});

type EditorProperty = GuideEditorData['property'];
type EditorSection = GuideEditorData['sections'][number];
type EditorTranslation = GuideTranslation;
type GuestLocaleOption = (typeof guestLocales)[number];

function localeName(code: string): string {
  return languageNames[code as GuestLocaleOption] ?? code;
}

function PropertyEditorPage() {
  const { editor, share, inbox } = Route.useLoaderData();
  return (
    <>
      <HostBar />
      <main className="canvas" key={editor.property.id}>
        <div className="title-row">
          <div>
            <Link to="/host" className="crumb" data-testid="editor-back">
              Properties
            </Link>
            <h1 data-testid="editor-property-name">{editor.property.displayName}</h1>
          </div>
          <div className="actions">
            <Link
              to="/host/preview/$propertyId"
              params={{ propertyId: editor.property.id }}
              className={buttonClass()}
              data-testid="editor-preview-link"
            >
              Open guest preview
            </Link>
            <GuidePublish propertyId={editor.property.id} published={editor.property.published} />
          </div>
        </div>
        <div className="layout">
          <div>
            <InboxPanel propertyId={editor.property.id} messages={inbox} />
            <section className="panel" aria-labelledby="sections-heading">
              <header>
                <h2 id="sections-heading">Guide</h2>
                <span className="muted small">
                  {editor.sections.length === 1 ? '1 section' : `${editor.sections.length} sections`}
                </span>
              </header>
              {editor.sections.length === 0 ? (
                <p className="empty" data-testid="editor-sections-empty">
                  No sections yet. Add the first one below.
                </p>
              ) : (
                <ul className="rows">
                  {editor.sections.map((section, index) => (
                    <li key={section.id}>
                      <SectionForm
                        propertyId={editor.property.id}
                        section={section}
                        first={index === 0}
                        last={index === editor.sections.length - 1}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <AddSectionForm propertyId={editor.property.id} />
            </section>
          </div>
          <div>
            <GuestLinkPanel propertyId={editor.property.id} share={share} />
            <TranslationPanel property={editor.property} sections={editor.sections} />
            <PropertyForm property={editor.property} />
            <PropertyDangerZone propertyId={editor.property.id} />
          </div>
        </div>
      </main>
    </>
  );
}

function GuidePublish({ propertyId, published }: { propertyId: string; published: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function toggle() {
    setBusy(true);
    setMessage('');
    try {
      const result = await setGuidePublished({ data: { propertyId, published: !published } });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        return;
      }
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Pill tone={published ? 'positive' : 'neutral'} testId="guide-status">
        {published ? 'Guide is live' : 'Guide is offline'}
      </Pill>
      <Button
        type="button"
        variant={published ? undefined : 'primary'}
        onClick={toggle}
        disabled={busy}
        data-testid="guide-publish"
      >
        {published ? 'Unpublish guide' : 'Publish guide'}
      </Button>
      <Toast testId="guide-status-message">{message}</Toast>
    </>
  );
}

function GuestLinkPanel({ propertyId, share }: { propertyId: string; share: ShareLinkState | null }) {
  const router = useRouter();
  const [issued, setIssued] = useState<{ shareId: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // The raw secret exists in this component state and the one issuance response only; a reload
  // cannot show it again, so the database never holds a replayable capability.
  const url = issued ? `${window.location.origin}/g/${issued.shareId}#${issued.secret}` : null;

  async function run(action: 'create' | 'rotate' | 'disable') {
    setBusy(true);
    setMessage('');
    try {
      const result =
        action === 'create'
          ? await createGuestLink({ data: { propertyId } })
          : action === 'rotate'
            ? await rotateGuestLink({ data: { propertyId } })
            : await disableGuestLink({ data: { propertyId } });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        return;
      }
      if ('secret' in result) {
        setIssued({ shareId: result.shareId, secret: result.secret });
        setMessage('New guest link ready. Share it now — for security it is never shown again.');
      } else {
        setIssued(null);
        setMessage('Guest link disabled. Guests can no longer open the guide.');
      }
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Link copied.');
    } catch {
      setMessage('Copy failed. Select the link text and copy it manually.');
    }
  }

  return (
    <section className="panel stack" aria-labelledby="guest-link-heading" data-testid="guest-link-panel">
      <h2 id="guest-link-heading">Guest link</h2>
      <p data-testid="guest-link-status">
        {share?.link
          ? `Active link issued ${new Date(share.link.createdAt).toLocaleDateString()}.`
          : 'No active guest link.'}
      </p>
      {share?.link && !url ? (
        <p className="muted">The link is shown only once, when it is issued. Rotate it to get a new one to share.</p>
      ) : null}
      {share && !share.guidePublished ? (
        <p className="muted" data-testid="guest-link-unpublished">
          Guests can open the link, but they only see the guide once you publish it.
        </p>
      ) : null}
      {url ? (
        <div className="link-box stack" data-testid="guest-link-issued">
          <input readOnly value={url} aria-label="Guest link" data-testid="guest-link-url" />
          <Button type="button" variant="primary" onClick={() => void copy(url)} data-testid="guest-link-copy">
            Copy link
          </Button>
          <QrSvg value={url} />
          <p className="small muted">
            Rotating creates a new link and immediately stops the old one, including any guest who already opened it.
          </p>
        </div>
      ) : null}
      <div className="actions">
        {share?.link ? (
          <>
            <Button type="button" onClick={() => void run('rotate')} disabled={busy} data-testid="guest-link-rotate">
              Rotate link
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void run('disable')}
              disabled={busy}
              data-testid="guest-link-disable"
            >
              Disable link
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="primary"
            onClick={() => void run('create')}
            disabled={busy}
            data-testid="guest-link-create"
          >
            Create guest link
          </Button>
        )}
      </div>
      <Toast testId="guest-link-message">{message}</Toast>
    </section>
  );
}

// QR SVG is generated in the browser from the one-time secret, so the server-rendered HTML never
// carries the capability; runs of dark modules keep the path compact.
function QrSvg({ value }: { value: string }) {
  const { data } = encode(value, { ecc: 'M', border: 4 });
  const size = data.length;
  const runs: string[] = [];
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let length = 1;
      while (x + length < size && row[x + length]) length += 1;
      runs.push(`M${x} ${y}h${length}v1h-${length}z`);
      x += length;
    }
  });
  return (
    <svg
      className="guest-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code for the guest link"
      shapeRendering="crispEdges"
      data-testid="guest-qr"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={runs.join('')} fill="#000000" />
    </svg>
  );
}

function PropertyForm({ property }: { property: EditorProperty }) {
  const router = useRouter();
  const [sourceLocale, setSourceLocale] = useState(property.sourceLocale);
  const [alertEmail, setAlertEmail] = useState(property.alertEmail);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertBusy, setAlertBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const parsed = propertyFields.safeParse({
      displayName: formData.get('displayName'),
      sourceLocale: formData.get('sourceLocale'),
      enabledLocales: formData.getAll('enabledLocales').map(String),
    });
    if (!parsed.success) {
      setErrors(collectFieldErrors(parsed.error));
      setMessage('Check the highlighted fields.');
      return;
    }
    setErrors({});
    setBusy(true);
    setMessage('');
    try {
      const result = await saveProperty({ data: { propertyId: property.id, ...parsed.data } });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        return;
      }
      setMessage('Saved.');
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resyncEmail() {
    setAlertBusy(true);
    setAlertMessage('');
    try {
      const result = await resyncAlertEmail({ data: { propertyId: property.id } });
      if ('error' in result) {
        setAlertMessage('Something went wrong. Try again.');
        return;
      }
      setAlertEmail(result.alertEmail);
      setAlertMessage('Alert address updated to your current sign-in address.');
      await router.invalidate();
    } catch {
      setAlertMessage('Something went wrong. Try again.');
    } finally {
      setAlertBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="panel stack" data-testid="property-form">
      <h2>Property settings</h2>
      <Field
        label="Property name"
        error={errors.displayName}
        errorId="property-name-error"
        errorTestId="property-name-error"
      >
        <input
          name="displayName"
          defaultValue={property.displayName}
          maxLength={120}
          required
          aria-invalid={Boolean(errors.displayName)}
          aria-describedby={errors.displayName ? 'property-name-error' : undefined}
          data-testid="property-name"
        />
      </Field>
      <Field
        label="Guide language"
        error={errors.sourceLocale}
        errorId="property-locale-error"
        errorTestId="property-locale-error"
      >
        <select
          name="sourceLocale"
          value={sourceLocale}
          onChange={(event) => setSourceLocale(event.target.value)}
          aria-invalid={Boolean(errors.sourceLocale)}
          aria-describedby={errors.sourceLocale ? 'property-locale-error' : undefined}
          data-testid="property-locale"
        >
          {guestLocales.map((code) => (
            <option key={code} value={code}>
              {languageNames[code]}
            </option>
          ))}
        </select>
      </Field>
      <fieldset key={sourceLocale} data-testid="property-locales">
        <legend>Guest languages</legend>
        <p className="small muted">
          Guests always read the guide in {languageNames[sourceLocale as GuestLocaleOption]} (the source language). Tick
          any other languages you want stored translations for; nothing is sent to a translation provider until you
          press Generate translations.
        </p>
        {guestLocales
          .filter((code) => code !== sourceLocale)
          .map((code) => (
            <p key={code} style={{ marginTop: 8 }}>
              <label>
                <input
                  type="checkbox"
                  name="enabledLocales"
                  value={code}
                  defaultChecked={property.enabledLocales.includes(code)}
                  data-testid={`property-enabled-${code}`}
                />
                {languageNames[code]}
              </label>
            </p>
          ))}
      </fieldset>
      <section aria-labelledby="alert-email-heading" className="stack">
        <h3 id="alert-email-heading">New-message alerts</h3>
        <p className="small" data-testid="alert-email">
          {alertEmail ? `Alerts go to ${alertEmail}.` : 'No alert address is stored for this property.'}
        </p>
        <div className="actions">
          <Button
            type="button"
            onClick={() => void resyncEmail()}
            disabled={alertBusy}
            data-testid="alert-email-resync"
          >
            Use my current sign-in address
          </Button>
        </div>
        <Toast testId="alert-email-message">{alertMessage}</Toast>
      </section>
      <div className="actions">
        <Button type="submit" variant="primary" disabled={busy} data-testid="property-save">
          Save property
        </Button>
        <Toast testId="property-save-status">{message}</Toast>
      </div>
    </form>
  );
}

function PropertyDangerZone({ propertyId }: { propertyId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { confirm, dialog } = useConfirmDialog();

  async function remove() {
    const confirmed = await confirm({
      title: 'Delete this property?',
      body: 'This permanently removes its guide, guest links, active guest sessions, messages, translations, and usage counters.',
      confirmLabel: 'Delete property',
    });
    if (!confirmed) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await deleteProperty({ data: { propertyId } });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        return;
      }
      await navigate({ to: '/host' });
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="property-delete-heading"
      className="panel panel-danger stack"
      data-testid="property-danger-zone"
    >
      <h2 id="property-delete-heading">Delete property</h2>
      <p className="small muted">
        Deleting a property cannot be undone. Host audit records stay for the retention window.
      </p>
      <div className="actions">
        <Button
          type="button"
          variant="danger"
          onClick={() => void remove()}
          disabled={busy}
          data-testid="property-delete"
        >
          Delete property
        </Button>
        <Toast testId="property-delete-message">{message}</Toast>
      </div>
      {dialog}
    </section>
  );
}

function SectionForm({
  propertyId,
  section,
  first,
  last,
}: {
  propertyId: string;
  section: EditorSection;
  first: boolean;
  last: boolean;
}) {
  const router = useRouter();
  const [visibility, setVisibility] = useState<SectionVisibility>(section.visibility);
  // The fields are uncontrolled, so they still show this revision after a refresh brings a newer one.
  const [loadedRevision, setLoadedRevision] = useState(section.sourceRevision);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = sectionFields.safeParse({
      category: values.category,
      title: values.title,
      body: values.body,
      visibility: values.visibility,
      secretValue: values.secretValue ?? '',
      published: values.published === 'on',
    });
    if (!parsed.success) {
      setErrors(collectFieldErrors(parsed.error));
      setMessage('Check the highlighted fields.');
      return;
    }
    setErrors({});
    setBusy(true);
    setMessage('');
    try {
      const result = await saveSection({
        data: { propertyId, sectionId: section.id, expectedRevision: loadedRevision, ...parsed.data },
      });
      if ('error' in result) {
        setMessage('Could not save; if this section changed in another tab, reload the page and try again.');
        return;
      }
      setLoadedRevision(result.sourceRevision);
      setMessage('Saved.');
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function move(direction: 'up' | 'down') {
    setBusy(true);
    setMessage('');
    try {
      const result = await moveSectionOrder({ data: { propertyId, sectionId: section.id, direction } });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        return;
      }
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const status =
    section.visibility === 'host'
      ? { label: 'Private note', tone: 'accent' as const }
      : section.published
        ? { label: 'Published', tone: 'positive' as const }
        : { label: 'Draft', tone: 'neutral' as const };

  return (
    <details className="section" data-testid="section-item">
      <summary>
        <span className="section-name">
          <strong>{section.title || sectionCategoryLabels[section.category]}</strong>
          <span>
            {[
              section.title && section.title !== sectionCategoryLabels[section.category]
                ? sectionCategoryLabels[section.category]
                : null,
              ...section.translations.map((translation) => localeName(translation.locale)),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <Pill tone={status.tone}>{status.label}</Pill>
      </summary>
      <div className="section-body">
        <form onSubmit={submit} noValidate className="stack" data-testid="section-form">
          <div className="field-row">
            <Field label="Category">
              <select name="category" defaultValue={section.category} data-testid="section-category">
                {sectionCategories.map((category: SectionCategory) => (
                  <option key={category} value={category}>
                    {sectionCategoryLabels[category]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Visibility">
              <select
                name="visibility"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as SectionVisibility)}
                data-testid="section-visibility"
              >
                <option value="guest">Guest content</option>
                <option value="host">Private note (never shown to guests)</option>
              </select>
            </Field>
          </div>
          <Field
            label="Title"
            error={errors.title}
            errorId={`section-title-error-${section.id}`}
            errorTestId="section-title-error"
          >
            <input
              name="title"
              defaultValue={section.title}
              maxLength={200}
              required
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? `section-title-error-${section.id}` : undefined}
              data-testid="section-title"
            />
          </Field>
          <Field
            label="Text"
            error={errors.body}
            errorId={`section-body-error-${section.id}`}
            errorTestId="section-body-error"
          >
            <textarea name="body" defaultValue={section.body} maxLength={8000} rows={6} data-testid="section-body" />
          </Field>
          {visibility === 'host' ? (
            <Field label="Secret value (stored for you only)">
              <input
                name="secretValue"
                defaultValue={section.secretValue ?? ''}
                maxLength={500}
                aria-invalid={Boolean(errors.secretValue)}
                aria-describedby={errors.secretValue ? `section-secret-error-${section.id}` : undefined}
                data-testid="section-secret"
              />
            </Field>
          ) : (
            <label>
              <input
                type="checkbox"
                name="published"
                defaultChecked={section.published}
                data-testid="section-published"
              />
              Published for guests
            </label>
          )}
          {errors.secretValue ? (
            <p id={`section-secret-error-${section.id}`} role="alert" data-testid="section-secret-error">
              {errors.secretValue}
            </p>
          ) : null}
          <div className="actions">
            <Button type="submit" variant="primary" disabled={busy} data-testid="section-save">
              Save section
            </Button>
            <Button type="button" onClick={() => move('up')} disabled={busy || first} data-testid="section-move-up">
              Move up
            </Button>
            <Button type="button" onClick={() => move('down')} disabled={busy || last} data-testid="section-move-down">
              Move down
            </Button>
            <Toast testId="section-status">{message}</Toast>
          </div>
        </form>
        <TranslationBlocks propertyId={propertyId} translations={section.translations} />
      </div>
    </details>
  );
}

// Stored translations for one source section: drafts are edited and approved here, approved rows
// are shown as guests would read them, and a revision mismatch is labelled stale and cannot be
// approved (the canonical write re-checks the same condition).
function TranslationBlocks({ propertyId, translations }: { propertyId: string; translations: EditorTranslation[] }) {
  if (translations.length === 0) return null;
  return (
    <div data-testid="section-translations">
      {translations.map((translation) => (
        <TranslationBlock
          key={`${translation.id}:${translation.sourceRevision}`}
          propertyId={propertyId}
          translation={translation}
        />
      ))}
    </div>
  );
}

function TranslationBlock({ propertyId, translation }: { propertyId: string; translation: EditorTranslation }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const locale = translation.locale;
  const { confirm, dialog } = useConfirmDialog();

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = approveTranslationInput.safeParse({
      propertyId,
      translationId: translation.id,
      sourceRevision: translation.sourceRevision,
      title: values.title,
      body: values.body,
    });
    if (!parsed.success) {
      setErrors(collectFieldErrors(parsed.error));
      setMessage('Check the highlighted fields.');
      return;
    }
    setErrors({});
    setBusy(true);
    setMessage('');
    try {
      const result = await approveGuideTranslation({ data: parsed.data });
      if ('error' in result) {
        setMessage('Could not approve; if the source text changed meanwhile, generate the translation again.');
        return;
      }
      setMessage('Translation approved.');
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    const approved = translation.state === 'approved';
    if (
      approved &&
      !(await confirm({
        title: 'Withdraw this approved translation?',
        body: 'Guests will see the original text.',
        confirmLabel: 'Withdraw translation',
      }))
    ) {
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await rejectGuideTranslation({ data: { propertyId, translationId: translation.id } });
      if ('error' in result) {
        setMessage(
          approved ? 'Could not withdraw the translation. Try again.' : 'Could not remove the draft. Try again.',
        );
        return;
      }
      setMessage(approved ? 'Translation withdrawn.' : 'Draft removed.');
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="translation stack" data-testid={`translation-${locale}`}>
      <legend>
        {localeName(locale)}{' '}
        <Pill tone={translation.state === 'approved' ? 'positive' : 'neutral'}>
          {translation.state === 'approved' ? 'Approved' : 'Draft'}
        </Pill>{' '}
        {translation.stale ? <Pill tone="attention">Source changed</Pill> : null}
      </legend>
      {translation.stale ? (
        <p role="alert" data-testid={`translation-stale-${locale}`}>
          The source text changed after this translation. Generate translations again before guests can see it.
        </p>
      ) : null}
      {translation.state === 'draft' ? (
        <form onSubmit={approve} noValidate className="stack">
          <Field
            label="Title"
            error={errors.title}
            errorId={`translation-title-error-${translation.id}`}
            errorTestId="translation-title-error"
          >
            <input
              name="title"
              defaultValue={translation.title}
              maxLength={400}
              required
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? `translation-title-error-${translation.id}` : undefined}
              data-testid={`translation-title-${locale}`}
            />
          </Field>
          <Field
            label="Text"
            error={errors.body}
            errorId={`translation-body-error-${translation.id}`}
            errorTestId="translation-body-error"
          >
            <textarea
              name="body"
              defaultValue={translation.body}
              maxLength={16000}
              rows={5}
              aria-invalid={Boolean(errors.body)}
              aria-describedby={errors.body ? `translation-body-error-${translation.id}` : undefined}
              data-testid={`translation-body-${locale}`}
            />
          </Field>
          <div className="actions">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || translation.stale}
              data-testid={`translation-approve-${locale}`}
            >
              Approve translation
            </Button>
            <Button type="button" onClick={reject} disabled={busy} data-testid={`translation-reject-${locale}`}>
              Reject draft
            </Button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <div>
            <h4 data-testid={`translation-approved-title-${locale}`}>{translation.title}</h4>
            <p className="translation-text" data-testid={`translation-approved-body-${locale}`}>
              {translation.body}
            </p>
          </div>
          <div className="actions">
            <Button type="button" onClick={reject} disabled={busy} data-testid={`translation-withdraw-${locale}`}>
              Withdraw translation
            </Button>
          </div>
        </div>
      )}
      <Toast testId={`translation-status-${locale}`}>{message}</Toast>
      {dialog}
    </fieldset>
  );
}

// One explicit host action asks the provider for drafts of every changed eligible section; the
// guest pages never call a provider and only ever read approved current rows.
function TranslationPanel({ property, sections }: { property: EditorProperty; sections: EditorSection[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const targets = property.enabledLocales.filter((code) => code !== property.sourceLocale);

  async function generate() {
    setBusy(true);
    setMessage('');
    try {
      const result = await generateGuideTranslations({ data: { propertyId: property.id } });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        return;
      }
      if (result.state === 'blocked') {
        const labels = result.sectionIds
          .map((id) => sections.find((section) => section.id === id))
          .filter((section) => section !== undefined)
          .map((section) => sectionCategoryLabels[section.category]);
        setMessage(
          `Nothing was sent: these sections look like they contain secrets or contact details — ${labels.join(
            ', ',
          )}. Edit them, then generate again.`,
        );
        return;
      }
      if (result.state === 'provider_unavailable') {
        setMessage('Translation is not available right now, and nothing was sent.');
        return;
      }
      if (result.state === 'generated') {
        setMessage(
          result.generated === 0
            ? 'Every enabled language is already translated for the current source text.'
            : `Generated ${result.generated} draft translation${result.generated === 1 ? '' : 's'}. Review each one under its section.`,
        );
        await router.invalidate();
        return;
      }
      setMessage('Enable a guest language first, then generate.');
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack" aria-labelledby="translation-heading" data-testid="translation-panel">
      <h2 id="translation-heading">Translations</h2>
      <p data-testid="translation-status">
        {targets.length === 0
          ? 'No guest languages enabled yet: guests read the source language only.'
          : `Enabled guest languages: ${targets.map((code) => localeName(code)).join(', ')}. Source language: ${localeName(
              property.sourceLocale,
            )}.`}
      </p>
      <p className="small muted">
        Drafts are generated by Google Cloud Translation (EU) and stay invisible to guests until you approve them under
        each section.
      </p>
      <div className="actions">
        <Button
          type="button"
          onClick={generate}
          disabled={busy || targets.length === 0}
          data-testid="translation-generate"
        >
          Generate translations
        </Button>
      </div>
      <Toast testId="translation-message">{message}</Toast>
    </section>
  );
}

function AddSectionForm({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = createSectionInput.safeParse({ propertyId, category: values.category });
    if (!parsed.success) {
      setMessage('Choose a category first.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await createSection({ data: parsed.data });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        return;
      }
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="add-section" data-testid="section-new-form">
      <h3>Add a section</h3>
      <div className="actions">
        <select
          name="category"
          defaultValue="arrival"
          aria-label="New section category"
          data-testid="section-new-category"
        >
          {sectionCategories.map((category: SectionCategory) => (
            <option key={category} value={category}>
              {sectionCategoryLabels[category]}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={busy} data-testid="section-new-submit">
          Add section
        </Button>
      </div>
      <Toast testId="section-new-status">{message}</Toast>
    </form>
  );
}
