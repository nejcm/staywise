# Project context

Terms with a specific meaning in this project.

| Term | Meaning | Source |
| --- | --- | --- |
| Host | The property owner who signs in (magic link, optional TOTP) and authors guides. | [README.md](README.md) |
| Guest | Anyone opening a guide via link or QR; has no account. | [README.md](README.md) |
| Property | One rental unit with a guide, enabled locales, and an alert email snapshot. | `src/features/guide/` |
| Guide | The sections of a property shown to guests, in English, German, Slovenian, French, or Spanish. | `src/features/guide/` |
| Share link | Per-property bearer link; its secret lives in the URL fragment and is exchanged for a guest session. Rotating or disabling it revokes sessions. | `src/features/share/` |
| Guest session | Short-lived `Path=/g` cookie issued by the link exchange. | `src/features/share/` |
| Kill switch | `GUEST_ACCESS_DISABLED=true`; denies all guest entry points, including old sessions. | [README.md](README.md) |
| Inbox | Host view of guest questions and issue reports, with handled state. | `src/features/messages/` |
| Setup events | Privacy-bounded host funnel rows used to measure pilot setup time. | [README.md](README.md) |
| Theme | Preset look of a property's guest page and preview (`staywise`, `coast`, `alpine`, `terracotta`, `classic`); keys are permanent and copies keep the theme. | [ADR 0003](docs/adr/0003-guest-themes-are-presets.md) |
| Host settings | Per-host defaults for new properties at `/host/settings` (`app.host_settings`), copied into each property at creation; later changes and copies never pick them up. | [README.md](README.md) |

## Important boundaries

- `*.server.ts` code never ships to the browser; browser code reaches it only through server functions or route handlers.
- Guest-visible text goes through `guest-ui.ts` so all three locales stay in parity.
- Synthetic data only until the external deployment and privacy gates in the README are executed.
