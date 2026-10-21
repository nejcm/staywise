import type { GuideEditorData } from './guide.server';
import type { SectionCategory } from './guide-validation';

export type ReadinessItem = {
  key: string;
  label: string;
  done: boolean;
  // Editor pane to open ('basics', a section id, or 'new'), then the element id to focus.
  pane: string | null;
  anchor: string | null;
  // Suggestions are listed but never counted toward "ready for guests".
  optional?: boolean;
};

export function readiness(editor: GuideEditorData, linkIssued: boolean, heroAvailable = false): ReadinessItem[] {
  const { property, sections } = editor;
  const live = (category: SectionCategory) =>
    sections.some((section) => section.category === category && section.visibility === 'guest' && section.published);
  const sectionItem = (key: SectionCategory, label: string) => {
    const id = sections.find((section) => section.category === key)?.id;
    return id
      ? { key, label, done: live(key), pane: id, anchor: `section-title-${id}` }
      : { key, label, done: live(key), pane: 'new', anchor: 'section-new-heading' };
  };
  const field = (key: keyof GuideEditorData['property'], label: string, done: boolean) => ({
    key,
    label,
    done,
    pane: 'basics',
    anchor: `essentials-${key}`,
  });
  const hero: ReadinessItem = {
    key: 'hero',
    label: 'Add a cover photo (optional)',
    done: Boolean(editor.hero),
    pane: null,
    anchor: 'cover-photo-heading',
    optional: true,
  };
  return [
    field('checkinTime', 'Check-in time', Boolean(property.checkinTime)),
    field('checkoutTime', 'Checkout time', Boolean(property.checkoutTime)),
    field('address', 'Address', Boolean(property.address)),
    field('contactPhone', 'Contact phone', Boolean(property.contactPhone)),
    field(
      'wifiPassword',
      'Wi-Fi password or a published Wi-Fi section',
      Boolean(property.wifiPassword) || live('wifi'),
    ),
    sectionItem('arrival', 'Published Arrival section'),
    sectionItem('emergency', 'Published Emergency section'),
    { key: 'published', label: 'Guide published', done: property.published, pane: null, anchor: 'guide-publish' },
    { key: 'link', label: 'Guest link issued', done: linkIssued, pane: null, anchor: 'guest-link-heading' },
    ...(heroAvailable ? [hero] : []),
  ];
}
