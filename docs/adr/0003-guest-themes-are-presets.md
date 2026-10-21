# 0003: Guest themes are presets

**Status:** accepted, 2026-10-21

## Context

Hosts want their guest page to look like their property rather than like Staywise. The options were free-form brand colors or custom CSS, or a short list of designed presets.

## Decision

A property stores one preset key in `app.properties.theme` (`staywise`, `coast`, `alpine`, `terracotta`, `classic`; default `staywise`). No free-form colors and no custom CSS:

- Production CSP is `style-src 'self'` without `unsafe-inline`, so per-host values cannot be injected as inline styles. A `data-theme` attribute selects token overrides in the static `src/features/guest/themes.css`.
- Every preset is checked for WCAG AA contrast by `src/features/guest/themes.test.ts`; arbitrary colors would need runtime contrast checks and still produce unreadable pages.
- A fixed set keeps support and visual QA bounded.

Keys are permanent: stored rows reference them and the database check lists them. A theme can be restyled but never renamed or removed. The theme is per property, and copying a property keeps it. Denied and error pages stay unthemed so they reveal nothing about the property, and the printable QR code stays black on white.

## Consequences

- Adding a theme needs a migration that widens the check, a block in `themes.css`, a key in `guestThemes` (`src/features/guide/guide-validation.ts`), and a passing contrast test.
- Planned host settings (`/host/settings`) will offer a default theme that is snapshot into each new property at creation; changing the default does not touch existing properties.
