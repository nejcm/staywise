import { createFileRoute } from '@tanstack/react-router';
import { MessageCircle, Phone } from 'lucide-react';
import { Icon } from '../components/icons';
import { avatarInitial, guestLink, guestUiText } from '../features/guest/guest-ui';
import styles from '../features/guest/guest.module.css';
import { buttonClass } from '../components/button';
import { AddressLine, AnswerHours, ArrivalCard, hasEssentials } from '../features/guest/guest-essentials';
import { GuestHero } from '../features/guest/guest-hero';
import { SectionRows } from '../features/guest/guest-sections';

export const Route = createFileRoute('/g/$shareId/')({
  component: GuestHome,
});

const mostNeededCount = 4;

function GuestHome() {
  const { guest, shareId, lang } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const { locale, sections, essentials } = guest.guest;
  const { address, contactPhone } = essentials;
  const home = `/g/${shareId}`;
  return (
    <>
      <GuestHero hero={guest.guest.hero} src={`${home}/hero`} testId="guest-home-hero" />
      <div className={styles.intro}>
        <h1>{guest.guest.displayName}</h1>
        {address ? <AddressLine address={address} locale={locale} testId="guest-home-address" /> : null}
      </div>
      <ArrivalCard essentials={essentials} locale={locale} testId="guest-home-essentials" />
      {sections.length === 0 && !hasEssentials(essentials) ? (
        <p data-testid="guest-home-empty">{guestUiText(locale, 'home.empty')}</p>
      ) : null}
      {sections.length > 0 ? (
        <SectionRows
          label={guestUiText(locale, 'home.mostNeeded')}
          guide={guest.guest}
          home={home}
          lang={lang}
          limit={mostNeededCount}
          extra={{
            href: guestLink(`${home}/guide`, lang),
            title: guestUiText(locale, 'home.wholeGuide'),
            hint: guestUiText(locale, 'home.wholeGuideHint'),
          }}
        />
      ) : null}
      <section className={styles.callout} aria-labelledby="guest-home-host" data-testid="guest-home-help">
        <div className={styles.host}>
          <span className={styles.avatar} aria-hidden="true" data-testid="guest-host-initial">
            {avatarInitial(guest.guest.displayName, locale)}
          </span>
          <div>
            <h2 id="guest-home-host">{guestUiText(locale, 'home.host')}</h2>
            <AnswerHours essentials={essentials} locale={locale} />
          </div>
        </div>
        <div className={styles.actions}>
          {contactPhone ? (
            <a className={buttonClass('primary')} href={`tel:${contactPhone}`} data-testid="guest-home-call">
              <Icon icon={Phone} />
              {guestUiText(locale, 'contact.call')}
            </a>
          ) : null}
          <a className={buttonClass('secondary')} href={guestLink(`${home}/help`, lang)}>
            <Icon icon={MessageCircle} />
            {guestUiText(locale, 'home.ask')}
          </a>
        </div>
      </section>
      <p className={styles.footer}>
        {guestUiText(locale, 'help.emergencyNumber')} <a href="tel:112">112</a> ·{' '}
        <a href="/privacy">{guestUiText(locale, 'footer.privacy')}</a>
      </p>
    </>
  );
}
