import { guestThemes, type GuestTheme } from './guide-validation';
import styles from './theme-picker.module.css';

const themeLabels: Record<GuestTheme, string> = {
  staywise: 'Staywise',
  coast: 'Coast',
  alpine: 'Alpine',
  terracotta: 'Terracotta',
  classic: 'Classic',
};

export function ThemePicker({ defaultValue }: { defaultValue: GuestTheme }) {
  return (
    <fieldset className="stack" data-testid="property-themes">
      <legend>Guest page theme</legend>
      <p className="small muted">
        Colors and type for the guest page and the preview. The printed QR code stays black on white.
      </p>
      <div className={styles.grid}>
        {guestThemes.map((key) => (
          <label key={key} className={styles.card} data-theme={key}>
            <span className={styles.name}>
              <input
                type="radio"
                name="theme"
                value={key}
                defaultChecked={key === defaultValue}
                data-testid={`property-theme-${key}`}
              />
              {themeLabels[key]}
            </span>
            <span className={styles.sample} aria-hidden="true">
              <span>Welcome</span>
              <span className={styles.bar} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
