import {
  Compass,
  DoorOpen,
  LogOut,
  Recycle,
  ScrollText,
  Siren,
  SquareParking,
  WashingMachine,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import type { SectionCategory } from '../features/guide/guide-validation';
import styles from './icons.module.css';

const categoryIcons: Record<SectionCategory, LucideIcon> = {
  arrival: DoorOpen,
  wifi: Wifi,
  parking: SquareParking,
  rules: ScrollText,
  appliances: WashingMachine,
  waste: Recycle,
  checkout: LogOut,
  emergency: Siren,
  local_tips: Compass,
};

export function categoryIcon(category: SectionCategory): LucideIcon {
  return categoryIcons[category];
}

// Decorative only: always paired with visible text.
export function Icon({ icon: Glyph, className }: { icon: LucideIcon; className?: string }) {
  return (
    <Glyph aria-hidden="true" focusable="false" className={className ? `${styles.icon} ${className}` : styles.icon} />
  );
}
