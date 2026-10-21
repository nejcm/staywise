import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Icon, categoryIcon } from '../../components/icons';
import type { GuestGuideDto } from '../guide/guide.server';
import { firstLine, guestLink } from './guest-ui';
import styles from './guest.module.css';

export function sectionHref(home: string, index: number, lang: string | undefined): string {
  return guestLink(`${home}/guide/${index + 1}`, lang);
}

export function SectionRows({
  label,
  guide,
  home,
  lang,
  limit,
  extra,
}: {
  label: string;
  guide: GuestGuideDto;
  home: string;
  lang: string | undefined;
  limit?: number;
  extra?: { href: string; title: string; hint: string };
}) {
  return (
    <nav className={styles.rows} aria-label={label}>
      {guide.sections.slice(0, limit).map((section, index) => (
        <Row
          key={index}
          href={sectionHref(home, index, lang)}
          title={section.title}
          hint={firstLine(section.body)}
          lang={section.provenance === 'fallback' ? guide.sourceLocale : undefined}
          icon={categoryIcon(section.category)}
          testId="guest-section"
        />
      ))}
      {extra ? <Row {...extra} /> : null}
    </nav>
  );
}

function Row({
  href,
  title,
  hint,
  lang,
  icon,
  testId,
}: {
  href: string;
  title: string;
  hint: string;
  lang?: string;
  icon?: LucideIcon;
  testId?: string;
}) {
  return (
    <a href={href} data-testid={testId}>
      {icon ? <Icon icon={icon} className={styles.rowIcon} /> : null}
      <span lang={lang}>
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
      <Icon icon={ChevronRight} className={styles.chevron} />
    </a>
  );
}
