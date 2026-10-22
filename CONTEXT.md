# Project context

Terms with a specific meaning in this project.

| Term | Meaning | Source |
| --- | --- | --- |
| Host | The property owner who signs in (magic link, optional TOTP) and authors guides. | [README.md](README.md) |
| Guest | Anyone opening a guide via link or QR; has no account. | [README.md](README.md) |
| Property | One rental unit with a guide, enabled locales, and an alert email snapshot. | `src/features/guide/` |
| Guide | The sections of a property shown to guests, in English, German, Slovenian, French, or Spanish. | `src/features/guide/` |
| Share link | Bearer link whose secret lives in the URL fragment and is exchanged for a guest session. One long-lived property link per property (rotating or disabling it revokes sessions) plus optional stay links, one per reservation, that expire the day after check-out or on revoke ([ADR 0004](docs/adr/0004-per-stay-guest-links.md)). | `src/features/share/` |
| Reservation | One stay's dates at a property, from a source (`manual` or an import) with that source's external ID; carries no guest identity. Not called "booking". | [ADR 0004](docs/adr/0004-per-stay-guest-links.md) |
| Guest session | Short-lived `Path=/g` cookie issued by the link exchange, never outliving a stay link's expiry. | `src/features/share/` |
| Agent token | Host-created, scoped, expiring bearer credential that lets the host's own AI agent act on their properties. It never reveals guest message bodies, link secrets, or property credentials, and cannot delete or rotate. | — |
| Kill switch | `GUEST_ACCESS_DISABLED=true`; denies all guest entry points, including old sessions. | [docs/operations.md](docs/operations.md) |
| Inbox | Host view of guest questions and issue reports, with handled state. | `src/features/messages/` |
| Setup events | Privacy-bounded host funnel rows used to measure pilot setup time. | [docs/pilot-measurement.md](docs/pilot-measurement.md) |
| Theme | Preset look of a property's guest page and preview (`staywise`, `coast`, `alpine`, `terracotta`, `classic`); keys are permanent and copies keep the theme. | [ADR 0003](docs/adr/0003-guest-themes-are-presets.md) |
| Hero image | One optional cover photo per property, re-encoded to JPEG and served only to the owner or a live guest session ([ADR 0005](docs/adr/0005-property-hero-image.md)). | `src/features/guide/` |
| Host settings | Per-host defaults for new properties at `/host/settings` (`app.host_settings`), copied into each property at creation; later changes and copies never pick them up. | [docs/operations.md](docs/operations.md) |

## Important boundaries

- `*.server.ts` code never ships to the browser; browser code reaches it only through server functions or route handlers.
- Guest-visible text goes through `guest-ui.ts` so all five locales stay in parity.
- Synthetic data only until the external deployment and privacy gates in the [README](README.md) are executed.
