import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { encode } from 'uqr';
import { getHostAuthState } from '../host-fns';
import {
  createSection,
  getPropertyEditor,
  moveSectionOrder,
  saveProperty,
  saveSection,
  setGuidePublished,
} from '../guide-fns';
import { createGuestLink, disableGuestLink, getGuestLink, rotateGuestLink } from '../share-fns';
import type { ShareLinkState } from '../share.server';
import {
  collectFieldErrors,
  createSectionInput,
  propertyFields,
  sectionCategories,
  sectionCategoryLabels,
  sectionFields,
  type SectionCategory,
  type SectionVisibility,
} from '../guide-validation';
import type { GuideEditorData } from '../guide.server';

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
    return { editor: result.editor, share: 'error' in share ? null : share.share };
  },
  component: PropertyEditorPage,
});

type EditorProperty = GuideEditorData['property'];
type EditorSection = GuideEditorData['sections'][number];

function PropertyEditorPage() {
  const { editor, share } = Route.useLoaderData();
  return (
    <main key={editor.property.id}>
      <p>
        <Link to="/host" data-testid="editor-back">
          All properties
        </Link>
      </p>
      <h1 data-testid="editor-property-name">{editor.property.displayName}</h1>
      <GuidePublish propertyId={editor.property.id} published={editor.property.published} />
      <GuestLinkPanel propertyId={editor.property.id} share={share} />
      <PropertyForm property={editor.property} />
      <p>
        <Link
          to="/host/preview/$propertyId"
          params={{ propertyId: editor.property.id }}
          data-testid="editor-preview-link"
        >
          Open guest preview
        </Link>
      </p>
      <h2>Sections</h2>
      {editor.sections.length === 0 ? (
        <p data-testid="editor-sections-empty">No sections yet. Add the first one below.</p>
      ) : (
        <ul>
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
    </main>
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
    <p>
      <span data-testid="guide-status">{published ? 'Guide is live.' : 'Guide is offline.'}</span>{' '}
      <button type="button" onClick={toggle} disabled={busy} data-testid="guide-publish">
        {published ? 'Unpublish guide' : 'Publish guide'}
      </button>{' '}
      <span role="status" data-testid="guide-status-message">
        {message}
      </span>
    </p>
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
    <section data-testid="guest-link-panel">
      <h2>Guest link</h2>
      <p data-testid="guest-link-status">
        {share?.link
          ? `Active link issued ${new Date(share.link.createdAt).toLocaleDateString()}.`
          : 'No active guest link.'}
      </p>
      {share && !share.guidePublished ? (
        <p data-testid="guest-link-unpublished">
          Guests can open the link, but they only see the guide once you publish it.
        </p>
      ) : null}
      <p>
        {share?.link ? (
          <>
            <button type="button" onClick={() => void run('rotate')} disabled={busy} data-testid="guest-link-rotate">
              Rotate link
            </button>{' '}
            <button type="button" onClick={() => void run('disable')} disabled={busy} data-testid="guest-link-disable">
              Disable link
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void run('create')} disabled={busy} data-testid="guest-link-create">
            Create guest link
          </button>
        )}
      </p>
      {url ? (
        <div data-testid="guest-link-issued">
          <p>
            Rotating creates a new link and immediately stops the old one, including any guest who already opened it.
          </p>
          <p>
            <input readOnly value={url} aria-label="Guest link" data-testid="guest-link-url" />
          </p>
          <p>
            <button type="button" onClick={() => void copy(url)} data-testid="guest-link-copy">
              Copy link
            </button>
          </p>
          <QrSvg value={url} />
        </div>
      ) : null}
      <p role="status" data-testid="guest-link-message">
        {message}
      </p>
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = propertyFields.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
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

  return (
    <form onSubmit={submit} noValidate data-testid="property-form">
      <p>
        <label>
          Property name{' '}
          <input
            name="displayName"
            defaultValue={property.displayName}
            maxLength={120}
            required
            aria-invalid={Boolean(errors.displayName)}
            aria-describedby={errors.displayName ? 'property-name-error' : undefined}
            data-testid="property-name"
          />
        </label>
      </p>
      {errors.displayName ? (
        <p id="property-name-error" role="alert" data-testid="property-name-error">
          {errors.displayName}
        </p>
      ) : null}
      <p>
        <label>
          Guide language{' '}
          <input
            name="sourceLocale"
            defaultValue={property.sourceLocale}
            maxLength={5}
            required
            title="Language tag like en or pt-BR"
            aria-invalid={Boolean(errors.sourceLocale)}
            aria-describedby={errors.sourceLocale ? 'property-locale-error' : undefined}
            data-testid="property-locale"
          />
        </label>
      </p>
      {errors.sourceLocale ? (
        <p id="property-locale-error" role="alert" data-testid="property-locale-error">
          {errors.sourceLocale}
        </p>
      ) : null}
      <p>
        <button type="submit" disabled={busy} data-testid="property-save">
          Save property
        </button>
      </p>
      <p role="status" data-testid="property-save-status">
        {message}
      </p>
    </form>
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
      const result = await saveSection({ data: { propertyId, sectionId: section.id, ...parsed.data } });
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

  return (
    <section data-testid="section-item">
      <h3>
        {sectionCategoryLabels[section.category]}
        {section.visibility === 'host' ? ' (private note)' : ''}
      </h3>
      <form onSubmit={submit} noValidate data-testid="section-form">
        <p>
          <label>
            Category{' '}
            <select name="category" defaultValue={section.category} data-testid="section-category">
              {sectionCategories.map((category: SectionCategory) => (
                <option key={category} value={category}>
                  {sectionCategoryLabels[category]}
                </option>
              ))}
            </select>
          </label>
        </p>
        <p>
          <label>
            Title{' '}
            <input
              name="title"
              defaultValue={section.title}
              maxLength={200}
              required
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? `section-title-error-${section.id}` : undefined}
              data-testid="section-title"
            />
          </label>
        </p>
        {errors.title ? (
          <p id={`section-title-error-${section.id}`} role="alert" data-testid="section-title-error">
            {errors.title}
          </p>
        ) : null}
        <p>
          <label>
            Text{' '}
            <textarea name="body" defaultValue={section.body} maxLength={8000} rows={6} data-testid="section-body" />
          </label>
        </p>
        {errors.body ? (
          <p id={`section-body-error-${section.id}`} role="alert" data-testid="section-body-error">
            {errors.body}
          </p>
        ) : null}
        <p>
          <label>
            Visibility{' '}
            <select
              name="visibility"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as SectionVisibility)}
              data-testid="section-visibility"
            >
              <option value="guest">Guest content</option>
              <option value="host">Private note (never shown to guests)</option>
            </select>
          </label>
        </p>
        {visibility === 'host' ? (
          <p>
            <label>
              Secret value (stored for you only){' '}
              <input
                name="secretValue"
                defaultValue={section.secretValue ?? ''}
                maxLength={500}
                aria-invalid={Boolean(errors.secretValue)}
                aria-describedby={errors.secretValue ? `section-secret-error-${section.id}` : undefined}
                data-testid="section-secret"
              />
            </label>
          </p>
        ) : (
          <p>
            <label>
              <input
                type="checkbox"
                name="published"
                defaultChecked={section.published}
                data-testid="section-published"
              />{' '}
              Published for guests
            </label>
          </p>
        )}
        {errors.secretValue ? (
          <p id={`section-secret-error-${section.id}`} role="alert" data-testid="section-secret-error">
            {errors.secretValue}
          </p>
        ) : null}
        <p>
          <button type="submit" disabled={busy} data-testid="section-save">
            Save section
          </button>{' '}
          <button type="button" onClick={() => move('up')} disabled={busy || first} data-testid="section-move-up">
            Move up
          </button>{' '}
          <button type="button" onClick={() => move('down')} disabled={busy || last} data-testid="section-move-down">
            Move down
          </button>
        </p>
        <p role="status" data-testid="section-status">
          {message}
        </p>
      </form>
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
    <form onSubmit={submit} noValidate data-testid="section-new-form">
      <h2>Add a section</h2>
      <p>
        <label>
          Category{' '}
          <select name="category" defaultValue="arrival" data-testid="section-new-category">
            {sectionCategories.map((category: SectionCategory) => (
              <option key={category} value={category}>
                {sectionCategoryLabels[category]}
              </option>
            ))}
          </select>
        </label>{' '}
        <button type="submit" disabled={busy} data-testid="section-new-submit">
          Add section
        </button>
      </p>
      <p role="status" data-testid="section-new-status">
        {message}
      </p>
    </form>
  );
}
