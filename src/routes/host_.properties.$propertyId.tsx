import { Link, createFileRoute, redirect, useBlocker, useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, ChevronLeft, Circle, ImageUp, Plus, Trash } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { QrSvg } from '../components/qr-svg';
import { getHostAuthState } from '../features/host/host-fns';
import {
  createSection,
  deleteProperty,
  getPropertyEditor,
  moveSectionOrder,
  revertAgentChange,
  removeHero,
  resyncAlertEmail,
  saveHeroAlt,
  saveProperty,
  saveSection,
  setGuidePublished,
} from '../features/guide/guide-fns';
import {
  createGuestLink,
  createStayGuestLink,
  disableGuestLink,
  getGuestLink,
  reissueStayGuestLink,
  revokeStayGuestLink,
  rotateGuestLink,
} from '../features/share/share-fns';
import { getInbox } from '../features/messages/messages-fns';
import { InboxPanel } from '../features/host/host-inbox';
import { ThemePicker } from '../features/guide/theme-picker';
import { HostShell } from '../components/app-shell';
import { Button, buttonClass } from '../components/button';
import { useConfirmDialog } from '../components/confirm-dialog';
import { useHostAction } from '../components/host-action';
import { Field } from '../components/field';
import { Icon } from '../components/icons';
import { Pill } from '../components/pill';
import { Toast } from '../components/toast';
import {
  approveGuideTranslation,
  generateGuideTranslations,
  rejectGuideTranslation,
} from '../features/translation/translation-fns';
import type { ShareLinkState, Stay } from '../features/share/share.server';
import type { GuideGap } from '../features/messages/messages.server';
import { readiness, type ReadinessItem } from '../features/guide/readiness';
import {
  approveTranslationInput,
  collectFieldErrors,
  createSectionInput,
  answerHoursPaired,
  answerHoursPairedIssue,
  essentialsFields,
  guestLocales,
  heroAltSchema,
  propertyFields,
  sectionCategories,
  sectionCategoryLabels,
  sectionFields,
  type SectionCategory,
  type SectionVisibility,
} from '../features/guide/guide-validation';
import { guestUiText, languageNames, messageRetentionDays } from '../features/guest/guest-ui';
import type { GuideEditorData, GuideTranslation, HeroImage, PropertyEssentials } from '../features/guide/guide.server';
import { HERO_MAX_BYTES } from '../features/guide/image-validation';
import styles from '../features/host/host.module.css';
import editorStyles from '../features/host/editor.module.css';

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
    // Sequential on purpose: parallel auth-backed calls race the near-expiry session refresh.
    const share = await getGuestLink({ data: { propertyId: params.propertyId } });
    const inbox = await getInbox({ data: { propertyId: params.propertyId } });
    return {
      editor: result.editor,
      gaps: result.gaps,
      heroUpload: result.heroUpload,
      share: 'error' in share ? null : share.share,
      stays: 'error' in share ? null : share.stays,
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

const tabs = [
  { id: 'property', label: 'Property' },
  { id: 'guide', label: 'Guide' },
  { id: 'share', label: 'Share' },
  { id: 'inbox', label: 'Inbox' },
] as const;
type TabId = (typeof tabs)[number]['id'];

const anchorTabs: Record<string, TabId> = {
  'cover-photo-heading': 'property',
  'guest-link-heading': 'share',
};

function PropertyEditorPage() {
  const { editor, gaps, heroUpload, share, stays, inbox } = Route.useLoaderData();
  const { property, sections } = editor;
  const [tab, setTab] = useState<TabId>('property');
  const [selected, setSelected] = useState(sections[0]?.id ?? 'new');
  const pendingAnchor = useRef<string | null>(null);
  const [, setFocusTick] = useState(0);
  const [view, setView] = useState<'list' | 'editor'>('list');
  const active = selected === 'new' || sections.some((section) => section.id === selected) ? selected : 'new';
  const unpublished = sections.filter((section) => section.visibility === 'guest' && !section.published).length;

  function open(id: string) {
    setTab('guide');
    setSelected(id);
    setView('editor');
  }

  function focusAnchor(anchor: string | null, tabId?: TabId) {
    if (tabId) setTab(tabId);
    pendingAnchor.current = anchor;
    setFocusTick((tick) => tick + 1);
  }

  function jump(item: ReadinessItem) {
    if (item.pane === 'basics') focusAnchor(item.anchor, 'property');
    else if (item.pane) {
      open(item.pane);
      focusAnchor(item.anchor);
    } else focusAnchor(item.anchor, item.anchor ? anchorTabs[item.anchor] : undefined);
  }

  const pendingFocus = useRef<string | null>(null);

  // The tab un-hides on the commit, so focus the anchor after it.
  useEffect(() => {
    if (pendingAnchor.current) document.getElementById(pendingAnchor.current)?.focus();
    pendingAnchor.current = null;
  });

  // The new section's title only renders once the loader refetch returns it.
  useEffect(() => {
    const title = pendingFocus.current && document.getElementById(`section-title-${pendingFocus.current}`);
    if (!title) return;
    title.focus();
    pendingFocus.current = null;
  });

  function openCreated(sectionId: string) {
    open(sectionId);
    pendingFocus.current = sectionId;
  }

  return (
    <HostShell key={property.id}>
      <nav aria-label="Breadcrumb" className={styles.crumb}>
        <Link to="/host" data-testid="editor-back">
          Properties
        </Link>{' '}
        / <span aria-current="page">{property.displayName}</span>
      </nav>
      <div className={styles.head}>
        <div className={editorStyles.heading}>
          <h1 data-testid="editor-property-name">{property.displayName}</h1>
          <div className={styles.pills}>
            <Pill tone={property.published ? 'positive' : 'neutral'} testId="guide-status">
              {property.published ? 'Guide is live' : 'Guide is offline'}
            </Pill>
            {unpublished ? (
              <Pill tone="attention">
                {unpublished === 1 ? '1 unpublished section' : `${unpublished} unpublished sections`}
              </Pill>
            ) : null}
          </div>
        </div>
        <div className="actions">
          <Link
            to="/host/preview/$propertyId"
            params={{ propertyId: property.id }}
            className={buttonClass('ghost')}
            data-testid="editor-preview-link"
          >
            Preview
          </Link>
          <button type="button" className={buttonClass()} onClick={() => focusAnchor('guest-link-heading', 'share')}>
            Share link / QR
          </button>
          <GuidePublish propertyId={property.id} published={property.published} />
        </div>
      </div>
      <ReadinessPanel items={readiness(editor, Boolean(share?.link), heroUpload)} onJump={jump} />
      <GapPanel propertyId={property.id} gaps={gaps} onCreated={openCreated} />
      <div className={editorStyles.tabs} role="tablist" aria-label="Property sections">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`editor-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`editor-tabpanel-${entry.id}`}
            onClick={() => setTab(entry.id)}
            data-testid={`editor-tab-${entry.id}`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {/* Inactive tabs stay mounted so unsaved text survives switching. */}
      <div
        role="tabpanel"
        id="editor-tabpanel-property"
        aria-labelledby="editor-tab-property"
        hidden={tab !== 'property'}
        className="stack"
      >
        <div className={`${styles.panel} stack`}>
          <PropertyForm property={property} timeZones={editor.timeZones} />
        </div>
        <CoverPhotoPanel propertyId={property.id} hero={editor.hero} available={heroUpload} />
        <PropertyDangerZone propertyId={property.id} />
      </div>
      <div
        role="tabpanel"
        id="editor-tabpanel-guide"
        aria-labelledby="editor-tab-guide"
        hidden={tab !== 'guide'}
        className="stack"
      >
        <div className={editorStyles.workspace} data-view={view}>
          <nav className={`${styles.panel} ${editorStyles.sectionNav}`} aria-labelledby="sections-heading">
            <h2 id="sections-heading">Guide sections</h2>
            {sections.length === 0 ? (
              <p className={editorStyles.navEmpty} data-testid="editor-sections-empty">
                No sections yet.
              </p>
            ) : (
              <ol aria-label="Sections in guest order">
                {sections.map((section, index) => (
                  <SectionNavRow
                    key={section.id}
                    propertyId={property.id}
                    section={section}
                    active={section.id === active}
                    first={index === 0}
                    last={index === sections.length - 1}
                    onOpen={() => open(section.id)}
                  />
                ))}
              </ol>
            )}
            <button
              type="button"
              className={`${buttonClass('ghost')} ${editorStyles.addButton}`}
              aria-current={active === 'new' ? 'true' : undefined}
              onClick={() => open('new')}
              data-testid="section-add"
            >
              <Icon icon={Plus} />
              Add section
            </button>
          </nav>
          <div className={`${styles.panel} ${editorStyles.editorPanel}`}>
            <button
              type="button"
              className={`${buttonClass('ghost')} ${editorStyles.back}`}
              onClick={() => setView('list')}
            >
              <Icon icon={ChevronLeft} />
              Sections
            </button>
            {sections.map((section) => (
              <div key={section.id} hidden={active !== section.id}>
                <SectionForm propertyId={property.id} sourceLocale={property.sourceLocale} section={section} />
              </div>
            ))}
            {active === 'new' ? <AddSectionForm propertyId={property.id} onCreated={openCreated} /> : null}
          </div>
        </div>
        <TranslationPanel property={property} sections={sections} />
      </div>
      <div
        role="tabpanel"
        id="editor-tabpanel-share"
        aria-labelledby="editor-tab-share"
        hidden={tab !== 'share'}
        className={editorStyles.panels}
      >
        <GuestLinkPanel property={property} share={share} />
        <StaysPanel propertyId={property.id} stays={stays} />
      </div>
      <div
        role="tabpanel"
        id="editor-tabpanel-inbox"
        aria-labelledby="editor-tab-inbox"
        hidden={tab !== 'inbox'}
        className="stack"
      >
        <InboxPanel propertyId={property.id} messages={inbox} />
        <AlertPanel property={property} />
      </div>
    </HostShell>
  );
}

function sectionName(section: EditorSection) {
  return section.title || sectionCategoryLabels[section.category];
}

function SectionNavRow({
  propertyId,
  section,
  active,
  first,
  last,
  onOpen,
}: {
  propertyId: string;
  section: EditorSection;
  active: boolean;
  first: boolean;
  last: boolean;
  onOpen: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = sectionName(section);
  const note = section.visibility === 'host' ? 'Private note' : section.published ? null : 'Draft · not published';

  async function move(direction: 'up' | 'down') {
    setBusy(true);
    setFailed(false);
    try {
      const result = await moveSectionOrder({ data: { propertyId, sectionId: section.id, direction } });
      if ('error' in result) {
        setFailed(true);
        return;
      }
      await router.invalidate();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={editorStyles.navRow}>
      <button
        type="button"
        className={editorStyles.navItem}
        aria-current={active ? 'true' : undefined}
        onClick={onOpen}
        data-testid="section-item"
      >
        {name}
        {note ? (
          <small className={section.visibility === 'guest' ? editorStyles.draftNote : undefined}>{note}</small>
        ) : null}
      </button>
      <span className={editorStyles.navMoves}>
        {first ? null : (
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            onClick={() => void move('up')}
            disabled={busy}
            aria-label={`Move ${name} up`}
            data-testid="section-move-up"
          >
            <Icon icon={ArrowUp} />
          </button>
        )}
        {last ? null : (
          <button
            type="button"
            className={`${buttonClass('ghost', 'sm')} ${editorStyles.moveDown}`}
            onClick={() => void move('down')}
            disabled={busy}
            aria-label={`Move ${name} down`}
            data-testid="section-move-down"
          >
            <Icon icon={ArrowDown} />
          </button>
        )}
      </span>
      {failed ? (
        <p role="alert" className={editorStyles.navError}>
          Could not move. Try again.
        </p>
      ) : null}
    </li>
  );
}

function GuidePublish({ propertyId, published }: { propertyId: string; published: boolean }) {
  const { busy, notice, run } = useHostAction();

  function toggle() {
    void run(() => setGuidePublished({ data: { propertyId, published: !published } }));
  }

  return (
    <>
      <Button
        type="button"
        variant={published ? 'ghost' : 'primary'}
        onClick={toggle}
        disabled={busy}
        id="guide-publish"
        data-testid="guide-publish"
      >
        {published ? 'Unpublish guide' : 'Publish guide'}
      </Button>
      <Toast testId="guide-status-message" tone={notice.failed ? 'error' : undefined}>
        {notice.text}
      </Toast>
    </>
  );
}

function GuestLinkPanel({ property, share }: { property: EditorProperty; share: ShareLinkState | null }) {
  const propertyId = property.id;
  const router = useRouter();
  const [issued, setIssued] = useState<{ shareId: string; secret: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const qrBox = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageFailed, setMessageFailed] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  // The raw secret exists in this component state and the one issuance response only; a reload
  // cannot show it again, so the database never holds a replayable capability.
  const url = issued ? `${window.location.origin}/g/${issued.shareId}#${issued.secret}` : null;
  const unsaved = Boolean(url) && !saved;
  useBlocker({
    shouldBlockFn: async () =>
      !(await confirm({
        title: 'Leave without saving the link?',
        body: 'The link is shown only once. Leave without saving it?',
        confirmLabel: 'Leave',
      })),
    enableBeforeUnload: unsaved,
    disabled: !unsaved,
  });

  async function run(action: 'create' | 'rotate' | 'disable') {
    if (
      action === 'rotate' &&
      !(await confirm({
        title: 'Make a new guest link?',
        body: "The current link and every printed QR card stop working at once. You'll need to reprint the QR card and resend the link to current guests.",
        confirmLabel: 'Make new link',
      }))
    )
      return;
    setBusy(true);
    setMessage('');
    setMessageFailed(false);
    try {
      const result =
        action === 'create'
          ? await createGuestLink({ data: { propertyId } })
          : action === 'rotate'
            ? await rotateGuestLink({ data: { propertyId } })
            : await disableGuestLink({ data: { propertyId } });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        setMessageFailed(true);
        return;
      }
      if ('secret' in result) {
        setIssued({ shareId: result.shareId, secret: result.secret });
        setSaved(false);
        setMessage('New guest link ready. Share it now — for security it is never shown again.');
        setMessageFailed(false);
      } else {
        setIssued(null);
        setMessage('Guest link disabled. Guests can no longer open the guide.');
        setMessageFailed(false);
      }
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setSaved(true);
      setMessage('Link copied.');
      setMessageFailed(false);
    } catch {
      setMessage('Copy failed. Select the link text and copy it manually.');
      setMessageFailed(true);
    }
  }

  function download() {
    const svg = qrBox.current?.querySelector('svg');
    if (!svg) return;
    const href = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${property.displayName.replace(/[^\p{L}\p{N}]+/gu, '-')}-guest-qr.svg`;
    anchor.click();
    URL.revokeObjectURL(href);
    setSaved(true);
  }

  function print() {
    setSaved(true);
    window.print();
  }

  return (
    <section className={`${styles.panel} stack`} aria-labelledby="guest-link-heading" data-testid="guest-link-panel">
      <header className={editorStyles.panelTitle}>
        <h2 id="guest-link-heading" tabIndex={-1}>
          Guest link
        </h2>
        <Pill tone={share?.link ? 'positive' : 'neutral'}>{share?.link ? 'On' : 'Off'}</Pill>
      </header>
      <p data-testid="guest-link-status">
        {share?.link ? `Active link issued ${share.link.createdAt.slice(0, 10)}.` : 'No active guest link.'}
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
        <div className={`${editorStyles.linkBox} stack`} data-testid="guest-link-issued">
          <input readOnly value={url} aria-label="Guest link" data-testid="guest-link-url" />
          <Button type="button" onClick={() => void copy(url)} data-testid="guest-link-copy">
            Copy link
          </Button>
          {/* Drawn in the browser from the one-time secret, so server-rendered HTML never carries it. */}
          <div ref={qrBox} className={editorStyles.printCard}>
            <strong className={editorStyles.printOnly}>{property.displayName}</strong>
            <p className={editorStyles.printOnly}>{guestUiText(property.sourceLocale, 'card.scan')}</p>
            <QrSvg value={url} label="QR code for the guest link" className={editorStyles.qr} testId="guest-qr" />
            <p className={`${editorStyles.printOnly} small`}>{url}</p>
          </div>
          <div className="actions">
            <Button type="button" onClick={download} data-testid="guest-qr-download">
              Download QR (SVG)
            </Button>
            <Button type="button" onClick={print} data-testid="guest-qr-print">
              Print card
            </Button>
          </div>
          <p className="small">
            Rotating creates a new link and immediately stops the old one, including any guest who already opened it.
          </p>
        </div>
      ) : null}
      <div className="actions">
        {share?.link ? (
          <>
            <Button type="button" onClick={() => void run('rotate')} disabled={busy} data-testid="guest-link-rotate">
              Make new link
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void run('disable')}
              disabled={busy}
              data-testid="guest-link-disable"
            >
              Turn link off
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
      <Toast testId="guest-link-message" tone={messageFailed ? 'error' : undefined}>
        {message}
      </Toast>
      {dialog}
    </section>
  );
}

function StaysPanel({ propertyId, stays }: { propertyId: string; stays: Stay[] | null }) {
  const router = useRouter();
  const [issued, setIssued] = useState<{ reservationId: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageFailed, setMessageFailed] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  function fail() {
    setMessage('Something went wrong. Try again.');
    setMessageFailed(true);
  }

  async function act(work: () => Promise<boolean>) {
    setBusy(true);
    setMessage('');
    setMessageFailed(false);
    try {
      if (await work()) await router.invalidate();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void act(async () => {
      const result = await createStayGuestLink({
        data: { propertyId, stayStart: String(form.get('stayStart')), stayEnd: String(form.get('stayEnd')) },
      });
      if ('error' in result) {
        setMessage('Check the dates and try again.');
        setMessageFailed(true);
        return false;
      }
      // Same one-time rule as the property link: the secret lives only in this state.
      setIssued({
        reservationId: result.reservationId,
        url: `${window.location.origin}/g/${result.shareId}#${result.secret}`,
      });
      setMessage('Stay link ready. Share it now — for security it is never shown again.');
      return true;
    });
  }

  async function reissue(reservationId: string) {
    if (
      !(await confirm({
        title: 'Get a new link for this stay?',
        body: 'Any earlier link for this stay stops working. Use this for a link your agent set up, or one you no longer have.',
        confirmLabel: 'New link',
      }))
    )
      return;
    await act(async () => {
      const result = await reissueStayGuestLink({ data: { propertyId, reservationId } });
      if ('error' in result) {
        fail();
        return false;
      }
      setIssued({ reservationId, url: `${window.location.origin}/g/${result.shareId}#${result.secret}` });
      setMessage('Stay link ready. Share it now — for security it is never shown again.');
      return true;
    });
  }

  async function revoke(reservationId: string) {
    if (
      !(await confirm({
        title: 'Revoke this stay link?',
        body: 'Guests of this stay lose access at once. The property link and other stays keep working.',
        confirmLabel: 'Revoke',
      }))
    )
      return;
    await act(async () => {
      const result = await revokeStayGuestLink({ data: { propertyId, reservationId } });
      if ('error' in result) {
        fail();
        return false;
      }
      if (issued?.reservationId === reservationId) setIssued(null);
      setMessage('Stay link revoked.');
      return true;
    });
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Link copied.');
      setMessageFailed(false);
    } catch {
      setMessage('Copy failed. Select the link text and copy it manually.');
      setMessageFailed(true);
    }
  }

  return (
    <section className={`${styles.panel} stack`} aria-labelledby="stays-heading" data-testid="stays-panel">
      <h2 id="stays-heading">Stays</h2>
      <p className="muted">
        A stay link works for one booking and stops the day after check-out, so you never need to rotate the property
        link to lock out a past guest.
      </p>
      {stays?.length ? (
        <ul className="stack" data-testid="stays-list">
          {stays.map((stay) => (
            <li key={stay.reservationId} className={editorStyles.gap} data-testid="stay">
              <span>
                {stay.stayStart} → {stay.stayEnd}{' '}
                <Pill tone={stay.linkOn ? 'positive' : 'neutral'}>{stay.linkOn ? 'Link on' : 'Revoked'}</Pill>
              </span>
              {stay.linkOn ? (
                <span className="actions">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void reissue(stay.reservationId)}
                    disabled={busy}
                    data-testid="stay-reissue"
                  >
                    New link
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void revoke(stay.reservationId)}
                    disabled={busy}
                    data-testid="stay-revoke"
                  >
                    Revoke
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="stays-empty">No current or upcoming stays.</p>
      )}
      {issued ? (
        <div className={`${editorStyles.linkBox} stack`} data-testid="stay-issued">
          <input readOnly value={issued.url} aria-label="Stay link" data-testid="stay-url" />
          <Button type="button" onClick={() => void copy(issued.url)} data-testid="stay-copy">
            Copy link
          </Button>
          <QrSvg value={issued.url} label="QR code for the stay link" className={editorStyles.qr} testId="stay-qr" />
        </div>
      ) : null}
      <form onSubmit={add} className="stack" data-testid="stay-form">
        <div className={editorStyles.fieldRow}>
          <Field label="Check-in">
            <input type="date" name="stayStart" required data-testid="stay-start" />
          </Field>
          <Field label="Check-out">
            <input type="date" name="stayEnd" required data-testid="stay-end" />
          </Field>
        </div>
        <div className="actions">
          <Button type="submit" disabled={busy} data-testid="stay-add">
            Add stay
          </Button>
        </div>
      </form>
      <Toast testId="stays-message" tone={messageFailed ? 'error' : undefined}>
        {message}
      </Toast>
      {dialog}
    </section>
  );
}

const essentialInputs: {
  name: Exclude<keyof PropertyEssentials, 'timezone'>;
  label: string;
  type: 'time' | 'text' | 'tel';
  maxLength?: number;
  credential: boolean;
}[] = [
  { name: 'checkinTime', label: 'Check-in time', type: 'time', credential: false },
  { name: 'checkoutTime', label: 'Checkout time', type: 'time', credential: false },
  { name: 'wifiName', label: 'Wi-Fi network name', type: 'text', maxLength: 64, credential: false },
  { name: 'wifiPassword', label: 'Wi-Fi password', type: 'text', maxLength: 128, credential: true },
  { name: 'keyboxCode', label: 'Key-box code', type: 'text', maxLength: 32, credential: true },
  { name: 'address', label: 'Address', type: 'text', maxLength: 200, credential: false },
];
const contactInputs: typeof essentialInputs = [
  {
    name: 'contactPhone',
    label: 'Phone (international format, e.g. +38641234567)',
    type: 'tel',
    maxLength: 16,
    credential: false,
  },
  { name: 'answerFrom', label: 'Usually answers from', type: 'time', credential: false },
  { name: 'answerTo', label: 'Usually answers until', type: 'time', credential: false },
];

function PropertyForm({ property, timeZones }: { property: EditorProperty; timeZones: string[] }) {
  const { busy, notice, setNotice, run } = useHostAction();
  const [sourceLocale, setSourceLocale] = useState(property.sourceLocale);
  const [enabledLocales, setEnabledLocales] = useState<readonly string[]>(property.enabledLocales);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timeZoneOptions = timeZones.includes(property.timezone) ? timeZones : [property.timezone, ...timeZones];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const parsed = propertyFields
      .extend(essentialsFields.shape)
      .refine(answerHoursPaired, answerHoursPairedIssue)
      .safeParse({
        displayName: formData.get('displayName'),
        sourceLocale: formData.get('sourceLocale'),
        enabledLocales: formData.getAll('enabledLocales').map(String),
        ...Object.fromEntries(
          [...essentialInputs, ...contactInputs].map(({ name }) => [name, formData.get(name) ?? '']),
        ),
      });
    const timezone = String(formData.get('timezone') ?? property.timezone);
    const timezoneError = timeZoneOptions.includes(timezone) ? null : { timezone: 'Choose a time zone from the list' };
    const theme = String(formData.get('theme') ?? property.theme);
    if (!parsed.success || timezoneError) {
      setErrors({ ...(parsed.success ? {} : collectFieldErrors(parsed.error)), ...timezoneError });
      setNotice({ text: 'Check the highlighted fields.', failed: true });
      return;
    }
    setErrors({});
    await run(
      () =>
        saveProperty({
          data: {
            propertyId: property.id,
            ...parsed.data,
            ...(timezone === property.timezone ? {} : { timezone }),
            ...(theme === property.theme ? {} : { theme }),
          },
        }),
      () => 'Saved.',
    );
  }

  return (
    <form onSubmit={submit} noValidate className="stack" data-testid="property-form">
      <h2>Basics</h2>
      <div className={editorStyles.fieldGrid}>
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
        <Field
          label="Time zone"
          error={errors.timezone}
          errorId="property-timezone-error"
          errorTestId="property-timezone-error"
        >
          <select
            name="timezone"
            defaultValue={property.timezone}
            aria-invalid={Boolean(errors.timezone)}
            aria-describedby={errors.timezone ? 'property-timezone-error' : undefined}
            data-testid="property-timezone"
          >
            {timeZoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset data-testid="property-locales">
        <legend>Guest languages</legend>
        <p className="small muted">
          Guests always read the guide in {languageNames[sourceLocale as GuestLocaleOption]} (the source language). Tick
          any other languages you want stored translations for; nothing is sent to a translation provider until you
          press Generate translations.
        </p>
        <div className={editorStyles.localeChoices}>
          {guestLocales
            .filter((code) => code !== sourceLocale)
            .map((code) => (
              <label key={code}>
                <input
                  type="checkbox"
                  name="enabledLocales"
                  value={code}
                  checked={enabledLocales.includes(code)}
                  onChange={(event) =>
                    setEnabledLocales((current) =>
                      event.target.checked ? [...current, code] : current.filter((entry) => entry !== code),
                    )
                  }
                  data-testid={`property-enabled-${code}`}
                />
                {languageNames[code]}
              </label>
            ))}
        </div>
      </fieldset>
      <fieldset className="stack" data-testid="property-essentials">
        <legend>Essentials</legend>
        <p className="small muted">Guests see these after opening their link; they are never sent for translation.</p>
        <div className={editorStyles.fieldGrid}>
          {essentialInputs.map(({ name, label, type, maxLength, credential }) => {
            const errorId = `essentials-${name}-error`;
            const describedBy = [credential ? 'essentials-credential-warning' : '', errors[name] ? errorId : '']
              .filter(Boolean)
              .join(' ');
            return (
              <Field key={name} label={label} error={errors[name]} errorId={errorId} errorTestId={errorId}>
                <input
                  name={name}
                  type={type}
                  defaultValue={property[name] ?? ''}
                  maxLength={maxLength}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors[name])}
                  aria-describedby={describedBy || undefined}
                  id={`essentials-${name}`}
                  data-testid={`essentials-${name}`}
                />
              </Field>
            );
          })}
        </div>
        <p className="small" id="essentials-credential-warning" data-testid="essentials-credential-warning">
          Guests who already saw a Wi-Fi password or key-box code keep it. Changing the code is the only way to revoke
          it.
        </p>
      </fieldset>
      <fieldset className="stack" data-testid="property-contact">
        <legend>Contact</legend>
        <p className="small muted">
          Guests see your phone and hours after opening their link, never on error pages; they are never sent for
          translation. Hours use the property time zone.
        </p>
        <div className={editorStyles.fieldGrid}>
          {contactInputs.map(({ name, label, type, maxLength, credential }) => {
            const errorId = `essentials-${name}-error`;
            const describedBy = [credential ? 'essentials-credential-warning' : '', errors[name] ? errorId : '']
              .filter(Boolean)
              .join(' ');
            return (
              <Field key={name} label={label} error={errors[name]} errorId={errorId} errorTestId={errorId}>
                <input
                  name={name}
                  type={type}
                  defaultValue={property[name] ?? ''}
                  maxLength={maxLength}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors[name])}
                  aria-describedby={describedBy || undefined}
                  id={`essentials-${name}`}
                  data-testid={`essentials-${name}`}
                />
              </Field>
            );
          })}
        </div>
      </fieldset>
      <ThemePicker defaultValue={property.theme} />
      <div className="actions">
        <Button type="submit" variant="primary" disabled={busy} data-testid="property-save">
          Save property
        </Button>
        <Toast testId="property-save-status" tone={notice.failed ? 'error' : undefined}>
          {notice.text}
        </Toast>
      </div>
    </form>
  );
}

function AlertPanel({ property }: { property: EditorProperty }) {
  const [alertEmail, setAlertEmail] = useState(property.alertEmail);
  const { busy, notice, run } = useHostAction();

  function resyncEmail() {
    return run(
      () => resyncAlertEmail({ data: { propertyId: property.id } }),
      (result) => {
        setAlertEmail(result.alertEmail);
        return 'Alert address updated to your current sign-in address.';
      },
    );
  }

  return (
    <section className={`${styles.panel} stack`} aria-labelledby="alert-email-heading">
      <h2 id="alert-email-heading">Message alerts</h2>
      <p data-testid="alert-email">
        {alertEmail ? (
          <>
            New guest messages are emailed to <strong>{alertEmail}</strong>.
          </>
        ) : (
          'No alert address is stored for this property.'
        )}
      </p>
      <div className="actions">
        <Button type="button" onClick={() => void resyncEmail()} disabled={busy} data-testid="alert-email-resync">
          Use my current sign-in address
        </Button>
      </div>
      <p className="small muted">Only the alert goes there. Messages stay in your inbox.</p>
      <Toast testId="alert-email-message" tone={notice.failed ? 'error' : undefined}>
        {notice.text}
      </Toast>
    </section>
  );
}

function PropertyDangerZone({ propertyId }: { propertyId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageFailed, setMessageFailed] = useState(false);
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
    setMessageFailed(false);
    try {
      const result = await deleteProperty({ data: { propertyId } });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        setMessageFailed(true);
        return;
      }
      await navigate({ to: '/host' });
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="property-delete-heading"
      className={`${styles.danger} ${editorStyles.dangerZone} stack`}
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
          <Icon icon={Trash} />
          Delete property
        </Button>
        <Toast testId="property-delete-message" tone={messageFailed ? 'error' : undefined}>
          {message}
        </Toast>
      </div>
      {dialog}
    </section>
  );
}

function translationTone(translation: EditorTranslation) {
  return translation.state === 'approved' && !translation.stale ? styles.reviewed : styles.review;
}

function SectionForm({
  propertyId,
  sourceLocale,
  section,
}: {
  propertyId: string;
  sourceLocale: string;
  section: EditorSection;
}) {
  const router = useRouter();
  const [tab, setTab] = useState(sourceLocale);
  const [visibility, setVisibility] = useState<SectionVisibility>(section.visibility);
  // The fields are uncontrolled, so they still show this revision after a refresh brings a newer one.
  const [loadedRevision, setLoadedRevision] = useState(section.sourceRevision);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [messageFailed, setMessageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function revert(revisionId: string) {
    setBusy(true);
    setMessage('');
    setMessageFailed(false);
    try {
      const result = await revertAgentChange({ data: { propertyId, revisionId } });
      if ('error' in result) {
        setMessage('Could not revert: this section changed since. Edit it by hand.');
        setMessageFailed(true);
        return;
      }
      setLoadedRevision(result.sourceRevision);
      // The fields are uncontrolled, so they take the restored text directly.
      const fields = formRef.current?.elements;
      if (fields) {
        (fields.namedItem('title') as HTMLInputElement).value = result.title;
        (fields.namedItem('body') as HTMLTextAreaElement).value = result.body;
      }
      setMessage('Reverted.');
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

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
      setMessageFailed(true);
      return;
    }
    setErrors({});
    setBusy(true);
    setMessage('');
    setMessageFailed(false);
    try {
      const result = await saveSection({
        data: { propertyId, sectionId: section.id, expectedRevision: loadedRevision, ...parsed.data },
      });
      if ('error' in result) {
        setMessage('Could not save; if this section changed in another tab, reload the page and try again.');
        setMessageFailed(true);
        return;
      }
      setLoadedRevision(result.sourceRevision);
      setMessage('Saved.');
      setMessageFailed(false);
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
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
    <section className="stack" aria-label={`Edit ${sectionName(section)}`}>
      <div className={editorStyles.sectionHead}>
        {section.translations.length ? (
          <div className={editorStyles.tabs} role="tablist" aria-label="Language">
            {[sourceLocale, ...section.translations.map((translation) => translation.locale)].map((locale) => {
              const translation = section.translations.find((entry) => entry.locale === locale);
              return (
                <button
                  key={locale}
                  type="button"
                  role="tab"
                  aria-selected={tab === locale}
                  onClick={() => setTab(locale)}
                  lang={locale}
                  aria-label={localeName(locale)}
                  data-testid={`section-tab-${locale}`}
                >
                  <span className={`${styles.lang} ${translation ? translationTone(translation) : styles.original}`}>
                    {locale.toUpperCase()}
                  </span>
                  <span className={editorStyles.tabName}>{localeName(locale)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>
      <div hidden={tab !== sourceLocale}>
        {section.agentChange ? (
          <div className={editorStyles.gap} data-testid="agent-change">
            <span>
              {section.agentChange.revertible ? 'Changed' : 'Added'} via {section.agentChange.grantName} on{' '}
              {section.agentChange.changedAt.slice(0, 10)}
            </span>
            {section.agentChange.revertible ? (
              <Button
                type="button"
                size="sm"
                onClick={() => void revert(section.agentChange!.revisionId)}
                disabled={busy}
                data-testid="agent-revert"
              >
                Revert
              </Button>
            ) : null}
          </div>
        ) : null}
        <form ref={formRef} onSubmit={submit} noValidate className="stack" data-testid="section-form">
          <div className={editorStyles.fieldRow}>
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
            label="Section title"
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
              id={`section-title-${section.id}`}
              data-testid="section-title"
            />
          </Field>
          <Field
            label="Text guests read"
            error={errors.body}
            errorId={`section-body-error-${section.id}`}
            errorTestId="section-body-error"
          >
            <textarea name="body" defaultValue={section.body} maxLength={8000} rows={14} data-testid="section-body" />
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
            <Toast testId="section-status" tone={messageFailed ? 'error' : undefined}>
              {message}
            </Toast>
          </div>
        </form>
      </div>
      {section.translations.map((translation) => (
        <div key={`${translation.id}:${translation.sourceRevision}`} hidden={tab !== translation.locale}>
          <TranslationBlock propertyId={propertyId} translation={translation} />
        </div>
      ))}
    </section>
  );
}

// Drafts are edited and approved here, approved rows are shown as guests would read them, and a
// revision mismatch is labelled stale and cannot be approved (the canonical write re-checks it).
function TranslationBlock({ propertyId, translation }: { propertyId: string; translation: EditorTranslation }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [messageFailed, setMessageFailed] = useState(false);
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
      setMessageFailed(true);
      return;
    }
    setErrors({});
    setBusy(true);
    setMessage('');
    setMessageFailed(false);
    try {
      const result = await approveGuideTranslation({ data: parsed.data });
      if ('error' in result) {
        setMessage('Could not approve; if the source text changed meanwhile, generate the translation again.');
        setMessageFailed(true);
        return;
      }
      setMessage('Translation approved.');
      setMessageFailed(false);
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
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
    setMessageFailed(false);
    try {
      const result = await rejectGuideTranslation({ data: { propertyId, translationId: translation.id } });
      if ('error' in result) {
        setMessage(
          approved ? 'Could not withdraw the translation. Try again.' : 'Could not remove the draft. Try again.',
        );
        setMessageFailed(true);
        return;
      }
      setMessage(approved ? 'Translation withdrawn.' : 'Draft removed.');
      setMessageFailed(false);
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className={`${editorStyles.translation} stack`} data-testid={`translation-${locale}`}>
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
            <p className={editorStyles.translationText} data-testid={`translation-approved-body-${locale}`}>
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
      <Toast testId={`translation-status-${locale}`} tone={messageFailed ? 'error' : undefined}>
        {message}
      </Toast>
      {dialog}
    </fieldset>
  );
}

function languageStatus(locale: string, sections: EditorSection[]) {
  const guest = sections.filter((section) => section.visibility === 'guest' && section.published);
  const rows = guest.map((section) => section.translations.find((entry) => entry.locale === locale));
  if (rows.length && rows.every((row) => row?.state === 'approved' && !row.stale)) {
    return { label: 'Reviewed', tone: 'accent' as const, chip: styles.reviewed };
  }
  if (rows.some(Boolean)) return { label: 'Needs review', tone: 'attention' as const, chip: styles.review };
  return { label: 'Not translated', tone: 'neutral' as const, chip: styles.off };
}

// One explicit host action asks the provider for drafts of every changed eligible section; the
// guest pages never call a provider and only ever read approved current rows.
function TranslationPanel({ property, sections }: { property: EditorProperty; sections: EditorSection[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageFailed, setMessageFailed] = useState(false);
  const targets = property.enabledLocales.filter((code) => code !== property.sourceLocale);

  async function generate() {
    setBusy(true);
    setMessage('');
    setMessageFailed(false);
    try {
      const result = await generateGuideTranslations({ data: { propertyId: property.id } });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        setMessageFailed(true);
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
        setMessageFailed(true);
        return;
      }
      if (result.state === 'provider_unavailable') {
        setMessage('Translation is not available right now, and nothing was sent.');
        setMessageFailed(true);
        return;
      }
      if (result.state === 'generated') {
        setMessage(
          result.generated === 0
            ? 'Every enabled language is already translated for the current source text.'
            : `Generated ${result.generated} draft translation${result.generated === 1 ? '' : 's'}. Review each one under its section.`,
        );
        setMessageFailed(false);
        await router.invalidate();
        return;
      }
      setMessage('Enable a guest language first, then generate.');
      setMessageFailed(true);
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${styles.panel} stack`} aria-labelledby="translation-heading" data-testid="translation-panel">
      <h2 id="translation-heading">Languages</h2>
      <ul className={editorStyles.languages} data-testid="translation-status">
        <li>
          <span className={`${styles.lang} ${styles.original}`}>{property.sourceLocale.toUpperCase()}</span>
          <strong lang={property.sourceLocale}>{localeName(property.sourceLocale)}</strong>
          <span className="small muted">Original</span>
        </li>
        {targets.map((code) => {
          const status = languageStatus(code, sections);
          return (
            <li key={code}>
              <span className={`${styles.lang} ${status.chip}`}>{code.toUpperCase()}</span>
              <strong lang={code}>{localeName(code)}</strong>
              <Pill tone={status.tone}>{status.label}</Pill>
            </li>
          );
        })}
      </ul>
      {targets.length === 0 ? (
        <p className="small muted">No guest languages enabled yet. Add them on the Property tab.</p>
      ) : null}
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
      <Toast testId="translation-message" tone={messageFailed ? 'error' : undefined}>
        {message}
      </Toast>
    </section>
  );
}

const heroLongEdge = 1600;

// Re-encoding through a canvas drops Exif/GPS and normalizes HEIC or PNG sources to JPEG (ADR 0005).
async function encodeHero(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, heroLongEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  } catch {
    return null;
  }
}

const heroUploadErrors: Record<string, string> = {
  too_large: 'This photo is still over 1 MB after resizing. Try a smaller photo.',
  invalid: 'This photo could not be used. Export it as JPEG and try again.',
  unavailable: 'Cover photos are not available on this server.',
};

function CoverPhotoPanel({
  propertyId,
  hero,
  available,
}: {
  propertyId: string;
  hero: HeroImage | null;
  available: boolean;
}) {
  const router = useRouter();
  const { busy, notice, setNotice, run } = useHostAction();
  const { confirm, dialog } = useConfirmDialog();
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null);
  const [alt, setAlt] = useState(hero?.alt ?? '');
  const [altError, setAltError] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => () => (pending ? URL.revokeObjectURL(pending.url) : undefined), [pending]);

  async function choose(file: File | undefined) {
    setNotice({ text: '', failed: false });
    if (!file) return;
    const blob = await encodeHero(file);
    if (!blob) {
      setNotice({ text: 'This photo could not be read. Export it as JPEG and try again.', failed: true });
      return;
    }
    if (blob.size > HERO_MAX_BYTES) {
      setNotice({ text: heroUploadErrors.too_large!, failed: true });
      return;
    }
    setPending({ blob, url: URL.createObjectURL(blob) });
  }

  function checkedAlt(): string | null {
    const parsed = heroAltSchema.safeParse(alt);
    setAltError(parsed.success ? '' : (parsed.error.issues[0]?.message ?? 'Describe the photo'));
    return parsed.success ? parsed.data : null;
  }

  async function upload() {
    const text = checkedAlt();
    if (!pending || text === null) return;
    setUploading(true);
    setNotice({ text: '', failed: false });
    try {
      const response = await fetch(`/host/properties/${propertyId}/hero`, {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', 'x-hero-alt': encodeURIComponent(text) },
        body: pending.blob,
      });
      const result = (await response.json().catch(() => ({}))) as { state?: string };
      if (result.state !== 'ok') {
        setNotice({ text: heroUploadErrors[result.state ?? ''] ?? 'Something went wrong. Try again.', failed: true });
        return;
      }
      setPending(null);
      await router.invalidate();
      setNotice({ text: 'Cover photo saved.', failed: false });
    } catch {
      setNotice({ text: 'Something went wrong. Try again.', failed: true });
    } finally {
      setUploading(false);
    }
  }

  function saveAlt() {
    const text = checkedAlt();
    if (text === null) return;
    void run(
      () => saveHeroAlt({ data: { propertyId, alt: text } }),
      () => 'Photo description saved.',
    );
  }

  async function remove() {
    const confirmed = await confirm({
      title: 'Remove the cover photo?',
      body: 'Guests stop seeing it right away and the stored photo is deleted.',
      confirmLabel: 'Remove photo',
    });
    if (!confirmed) return;
    await run(
      () => removeHero({ data: { propertyId } }),
      () => {
        setAlt('');
        return 'Cover photo removed.';
      },
    );
  }

  const shown = pending?.url ?? (hero ? `/host/properties/${propertyId}/hero?v=${hero.version}` : null);
  const working = busy || uploading;
  return (
    <section className={`${styles.panel} stack`} aria-labelledby="cover-photo-heading" data-testid="cover-photo">
      <h2 id="cover-photo-heading" tabIndex={-1}>
        Cover photo
      </h2>
      {!available ? (
        <p className="small muted" data-testid="cover-photo-unavailable">
          Cover photos are not available on this server. Set SUPABASE_SECRET_KEY to turn them on.
        </p>
      ) : (
        <div className={editorStyles.cover}>
          {shown ? (
            <img
              className={editorStyles.coverPreview}
              src={shown}
              alt={alt || hero?.alt || ''}
              width={hero && !pending ? hero.width : undefined}
              height={hero && !pending ? hero.height : undefined}
              data-testid="cover-photo-preview"
            />
          ) : (
            <p className="small muted">Guests see this photo at the top of the guide&apos;s Home page.</p>
          )}
          <div className="stack">
            <Field label="Choose a photo">
              <input
                type="file"
                accept="image/*"
                disabled={working}
                onChange={(event) => void choose(event.currentTarget.files?.[0])}
                data-testid="cover-photo-file"
              />
            </Field>
            <Field
              label="Photo description for guests who cannot see it"
              error={altError}
              errorId="cover-photo-alt-error"
              errorTestId="cover-photo-alt-error"
            >
              <input
                value={alt}
                maxLength={200}
                onChange={(event) => setAlt(event.currentTarget.value)}
                aria-invalid={Boolean(altError)}
                aria-describedby={altError ? 'cover-photo-alt-error' : undefined}
                data-testid="cover-photo-alt"
              />
            </Field>
            <div className="actions">
              {pending ? (
                <Button type="button" onClick={() => void upload()} disabled={working} data-testid="cover-photo-upload">
                  <Icon icon={ImageUp} />
                  {uploading ? 'Uploading…' : hero ? 'Replace photo' : 'Upload photo'}
                </Button>
              ) : null}
              {hero && !pending ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={saveAlt}
                    disabled={working}
                    data-testid="cover-photo-alt-save"
                  >
                    Save description
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => void remove()}
                    disabled={working}
                    data-testid="cover-photo-remove"
                  >
                    <Icon icon={Trash} />
                    Remove photo
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
      <Toast testId="cover-photo-message" tone={notice.failed ? 'error' : undefined}>
        {notice.text}
      </Toast>
      {dialog}
    </section>
  );
}

function ReadinessPanel({ items, onJump }: { items: ReadinessItem[]; onJump: (item: ReadinessItem) => void }) {
  const pending = items.filter((item) => !item.done);
  if (!pending.length) return null;
  const required = items.filter((item) => !item.optional);
  const left = required.filter((item) => !item.done).length;
  return (
    <details open className={`${styles.panel} stack`} data-testid="readiness">
      <summary>
        <h2 className={editorStyles.inlineHeading}>
          {left ? `Before guests arrive: ${left} of ${required.length} left` : 'Ready for guests'}
        </h2>
      </summary>
      <ul className="stack">
        {pending.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className={editorStyles.linkButton}
              onClick={() => onJump(item)}
              data-testid={`readiness-${item.key}`}
            >
              <Icon icon={Circle} />
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function GapPanel({
  propertyId,
  gaps,
  onCreated,
}: {
  propertyId: string;
  gaps: GuideGap[];
  onCreated: (sectionId: string) => void;
}) {
  const { busy, notice, run } = useHostAction();
  if (!gaps.length) return null;

  function add(category: SectionCategory) {
    void run(
      () => createSection({ data: { propertyId, category, fromGap: true } }),
      (result) => onCreated(result.sectionId),
    );
  }

  return (
    <section className={`${styles.panel} stack`} aria-labelledby="gaps-heading" data-testid="guide-gaps">
      <h2 id="gaps-heading">Guests asked about things the guide misses</h2>
      <ul className="stack">
        {gaps.map((gap) => (
          <li key={gap.category ?? 'other'} className={editorStyles.gap}>
            <span>
              {gap.category ? (
                <>
                  Guests asked about <strong>{sectionCategoryLabels[gap.category]}</strong>{' '}
                  {gap.asked === 1 ? 'once' : `${gap.asked} times`} and you marked it as not in the guide.
                </>
              ) : (
                `Guests asked ${gap.asked === 1 ? '1 question' : `${gap.asked} questions`} that fit no section and you marked as not in the guide.`
              )}
            </span>
            {gap.category ? (
              <Button
                type="button"
                size="sm"
                onClick={() => add(gap.category as SectionCategory)}
                disabled={busy}
                data-testid={`gap-add-${gap.category}`}
              >
                Add a {sectionCategoryLabels[gap.category]} section
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="small muted">
        Counts cover the last {messageRetentionDays} days of messages. Read the questions in the{' '}
        <a href="#inbox-heading">inbox</a>.
      </p>
      <Toast testId="guide-gaps-status" tone="error">
        {notice.text}
      </Toast>
    </section>
  );
}

function AddSectionForm({ propertyId, onCreated }: { propertyId: string; onCreated: (sectionId: string) => void }) {
  const { busy, notice, run } = useHostAction();

  async function add(category: SectionCategory) {
    const parsed = createSectionInput.safeParse({ propertyId, category });
    if (!parsed.success) return;
    await run(
      () => createSection({ data: parsed.data }),
      (result) => onCreated(result.sectionId),
    );
  }

  return (
    <section className="stack" aria-labelledby="section-new-heading" data-testid="section-new-form">
      <h2 id="section-new-heading" tabIndex={-1}>
        Add a section
      </h2>
      <p className="small muted">Pick what it covers. You can rename it and change the text next.</p>
      <div className={editorStyles.chips}>
        {sectionCategories.map((category: SectionCategory) => (
          <button
            key={category}
            type="button"
            onClick={() => void add(category)}
            disabled={busy}
            data-testid={`section-new-${category}`}
          >
            + {sectionCategoryLabels[category]}
          </button>
        ))}
      </div>
      <Toast testId="section-new-status" tone="error">
        {notice.text}
      </Toast>
    </section>
  );
}
