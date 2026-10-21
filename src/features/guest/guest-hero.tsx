import type { HeroImage } from '../guide/guide.server';
import styles from './guest.module.css';

// Above the fold on purpose: no lazy loading, and width/height reserve the frame before the bytes arrive.
export function GuestHero({ hero, src, testId }: { hero: HeroImage | null; src: string; testId: string }) {
  if (!hero) return null;
  return (
    <img
      className={styles.hero}
      src={`${src}?v=${hero.version}`}
      alt={hero.alt}
      width={hero.width}
      height={hero.height}
      decoding="async"
      data-testid={testId}
    />
  );
}
