# Staywise — Guest Features from Design Boards (Plan)

_Planned 20 Oct 2026 against master 82e145e; revised the same day after an external review checked against the code. Spec: the Guest-Home, Guest-Guide, Guest-Help, Guest-Unavailable and Main (accessibility and language contract) design boards. Product decisions go in [decision_log.md](decision_log.md)._

## Current state

- **Data:** `app.properties` has `display_name`, `timezone` (defaults to `'UTC'`; host-editable since 7b), `address` (nullable, since 6), `source_locale`, `published`, `enabled_locales`. `app.guide_sections` has `category` (9 fixed values), `title`, free-text `body`, `visibility` guest/host, `secret_value` (host-only; nulled for guest sections, `guide.server.ts:380`), `display_order`, `published`, `source_revision`. `app.guide_translations` holds per-locale title/body with `state` draft/approved and `provider`.
- **Guest DTO:** `GuestGuideDto {displayName, sourceLocale, locale, locales, sections[{category, title, body, fallback}]}`. Only published, guest-visible rows. A translation is used only if approved: both the guest-read policy (`phase5_translations.sql:116`) and the guide query (`guide.server.ts:247`) check this. Each section falls back to source on its own (`fallback: true`).
- **Access:** the bearer secret travels in the URL fragment; JS posts it to `/g/$shareId/exchange`, which sets an HttpOnly `Path=/g` session cookie for up to 12 hours (rate-limited via `app.rate_limits`). **Share links have no stay or validity expiry** — usable until disabled, so a former guest can open one again. With the cookie, guest pages are SSR in `beforeLoad`; nav and language links are full-document `<a>` loads that work without JS. The first exchange needs JS.
- **Errors:** `beforeLoad` maps every `{error}`, including server failures, to `denied` (`g.$shareId.tsx:16`).
- **Help form:** JS-only. Same-origin JSON to `/g/$shareId_/message`, which checks exact Origin, requires JSON, reads a bounded body, validates the session, applies quotas and deduplication. Controls: kind radios, category select, body textarea, reply checkbox, email field.
- **Language links:** `guestLink` drops `?lang` for the source language (`guest-ui.ts:258`).
- **Headers:** CSP with nonce scripts, `img-src 'self' data:`, `connect-src 'self'`, `form-action 'self'`. Private/no-store for `/g` is central in `src/start.ts:25`. Outbound map and `tel:` links need no CSP change and send no referrer.
- **Retention:** `app.retention_cleanup()` deletes messages older than 90 days, nightly (03:17) via pg_cron — only where pg_cron is set up; elsewhere it only warns (`phase7d_auth_limits.sql:80`).
- **SSR cost:** each guest page load awaits the guide read and a counter write (`share.server.ts:218`), so a slow server delays the whole document.

## Product decisions

| ID | Decision | Blocks | Recommendation / notes |
|---|---|---|---|
| D1 | Store host phone + answering hours per property; shown only after exchange; on the privacy page | 7c | E.164; never on denied, opening or error pages |
| D2 | Remembered language: preference cookie, `localStorage`, or none | 3b | `sw_lang` cookie, `Path=/g`, `SameSite=Lax`, `Secure`, `HttpOnly`, Max-Age 180 days; shared across properties, falls back to source if not enabled; disclosed in 3b |
| D3 | May unreviewed machine translations reach guests? | 5b only | **Default no** — reviewed-only. 5a needs no decision |
| D4 | Final copy: privacy panel, no-reply line, retention sentence | 2 (line), 8a | "Deleted by nightly cleanup after 90 days", only once deployment confirms the job is scheduled |
| D5 | Help form without JS (first opening still needs JS) | optional 2b | Only if wanted; keep all endpoint checks and add a form-encoded parser with an Origin check |
| D6 | Show Wi-Fi password and key-box code to guests | 4b | Needs host rotation flow, editor warning "changing the code is the only way to revoke it from past guests", optional reveal window (needs stay dates). Not translated |

## Sequencing

Shared files: `guest-ui.ts`, `guest.module.css`, `g.$shareId.tsx`, `guide.server.ts`, `privacy.tsx`. Phases touching the same files run in order, each on top of the previous one.

- **Track A (guest shell / DTO):** 1a → 1b → 3a → 3b → 5a → 7a → 8b
- **Track B (help form):** 2 → 8a. Only `guest-message-form.tsx`, its strings and the privacy panel; trivial `guest-ui.ts` overlap with A.
- **Track C (schema/editor):** 4a → 4b (D6) → 6 → 7b → 7c (D1). 4b, 6 and 7c touch guest routes; start them after the Track A phase editing the same route.
- B can run alongside A. 4a (schema and editor only) can run alongside both.

## Phase 1a — Guide contents and per-section navigation

- **Scope:** choose one. **(Recommended) Native `<details>`:** one per section on `/g/$shareId/guide`, summary row = category, title, first body line. No new route, no JS, no prev/next needed. **(Board-faithful) One section per page:** current list → `g.$shareId.guide.index.tsx`, add `g.$shareId.guide.$index.tsx`; `guide.tsx` has no `<Outlet>`, so make it a layout or use a non-nested route (`g.$shareId.guide_.$index.tsx`). Prev/next and contents stay full-document `<a>` loads for the `/g` cookie.
- **Files:** guide route(s), `guest-ui.ts`, `guest.module.css`. DTO unchanged; summary computed in the UI.
- **Tests:** out-of-range index → contents; prev/next at both ends; `lang` on fallback text.
- **Success:** works without JS; h1 > h2 > h3.

## Phase 1b — Jump links from host sub-headings (optional; skip with `<details>`)

- **Scope:** one sub-heading convention (e.g. `## ` line prefix), checked against seed data, hinted in the editor. Server parses `headings[]` into the DTO. Jump links keep plain `href="#id"` plus the skip-link `preventDefault` + focus handler, since native hash navigation re-runs the loader via `/_serverFn`.
- **Tests:** no headings, duplicates, fallback rows.

## Phase 2 — Help form states (Track B)

- **Scope:** error summary (`role=alert`, `tabIndex=-1`, focused) linking to field ids. While sending, `<fieldset disabled>` and "Sending…" with `aria-busy`. Snapshot the submitted values; recap from the snapshot (kind, category, first ~120 chars, reply yes/no). "Send another" resets and focuses the first field. No-reply line from D4, placeholder behind one key until then.
- **Files:** `guest-message-form.tsx`, `guest-ui.ts`, `guest.module.css`, `field`, `button`.
- **Tests:** summary focus and links; fieldset disabled while busy; recap shows the snapshot even if fields change; reset.
- **2b (only if D5):** form-encoded POST fallback with every D5 check.

## Phase 3a — Language sheet + localized unavailable page

- **Scope:** language switch → `<details>/<summary>` sheet; each language named in itself with its own `lang`, `aria-current` on the active one. Denied/opening strings move into `guestUiText`. Denied page lists only the fixed supported UI languages, never the property's; markup identical for every denial cause.
- **Files:** `g.$shareId.tsx`, `guest-ui.ts`, CSS.
- **Tests:** denied markup identical across states; `lang` on each language.

## Phase 3b — Remembered language (after D2)

- **Scope:** `guestLink` **always** adds `?lang=<code>` on language-switch links, including source, so an explicit choice beats the cookie; nav links keep the current `?lang`. Resolution: `?lang` → cookie → source. Explicit `?lang` sets the cookie (D2 attributes), validated against `languageNames`. Privacy-page bullet ships **in this phase** (`privacy.tsx` covers only the session cookie).
- **Files:** `guest-ui.ts`, `g.$shareId.tsx`, `share.server.ts`, `guest-fns.ts`, `privacy.tsx`.
- **Tests:** resolution order; source links carry `?lang`; invalid cookie ignored; non-enabled language falls back; privacy text mentions the cookie.

## Phase 4a — Essentials schema + host editor (Track C)

- **Migration:** `properties.checkin_time`, `checkout_time` (`time`); `wifi_name`, `wifi_password`, `keybox_code` (nullable, length checks) in owner-only `app.property_credentials`, because `properties_guest_read` exposes whole property rows. Copy keeps times and network name, never password or code. Not translated, not yet sent to guests; 4b adds a link-scoped guest policy.
- **Editor:** "Essentials" fieldset in `host_.properties.$propertyId.tsx`, zod in `guide-validation.ts` / `guide-fns.ts`. Warning beside credential fields: past guests keep a code they saw; rotating it is the only revocation.
- **Host preview:** shows essentials (host's own view). "Never" covers share/QR metadata, logs, and denied/opening/error pages.
- **Tests:** RLS (no anonymous or guest-role read), validation.

## Phase 4b — Guest exposure + Copy (after D6, 4a)

- **Scope:** DTO `essentials` object, only via the post-exchange read (`readGuestPage`; `property_credentials_guest_read` rechecks the live link row). Home `<dl>` of selectable text; Copy after hydration (`navigator.clipboard`, fallback "select the text") with toast feedback. Reveal window if D6 sets one.
- **Tests:** absent on denied path and metadata; no-JS shows text without Copy; reveal window edges.
- **Risk:** credential exposure. No-store already in place (`start.ts:25`); confirm request logging doesn't capture responses.

## Phase 5a — Per-section provenance, reviewed only (Track A)

- **Scope:** section `provenance: 'source' | 'reviewed' | 'fallback'`. If any is `reviewed`, banner "Translated, reviewed by host · Show {source language name}" linking `?lang=<source>` (3b rule). Fallback sections keep their notice. Real source-language name, not "English".
- **Tests:** DTO matrix approved / missing / stale; banner link carries `?lang`.

## Phase 5b — Serve machine drafts (only if D3; not recommended)

- **Migration:** guest-read policy `state in ('approved','draft')`, keeping revision, locale, visibility, published and same-property checks; match the query at `guide.server.ts:247`. Provenance `machine`, banner "Auto-translated".

## Phase 6 — Address + "Open in maps"; host avatar initial (Track C)

- **Migration:** `properties.address text` (nullable, 1–200 chars); editor field in Essentials, omitted = unchanged, copied by Copy. Guest-readable via `properties_guest_read` (not a credential); never in the translation payload.
- **Guest:** address text + outbound `https://www.openstreetmap.org/search?query=<encoded>`, nothing embedded. Avatar initial from `display_name`. Privacy page: the provider sees the address only on click.
- **Tests:** link encoding; block hidden without address.

## Phase 7a — Retryable errors separate from denied (Track A)

- **Scope:** `getGuestPage` returns `{state:'error'}` for server/DB failures; only invalid link or session → `denied`. Error page: generic "Try again" (reload link), **no contact details**. Denied markup unchanged.
- **Files:** `share.server.ts`, `guest-fns.ts`, `g.$shareId.tsx`.
- **Tests:** state mapping; denied identical; no property data on the error page.

## Phase 7b — Property timezone editing (Track C)

- **Scope:** `timezone` in `propertyFields` (optional = unchanged), validated with `Intl.supportedValuesOf('timeZone')` plus `UTC`, editor select fed from the server's list (avoids SSR/browser ICU mismatch). Required before local times are shown.
- **Tests:** validation; existing rows default to UTC.

## Phase 7c — Answering hours + Call (after D1, 7a, 7b)

- **Migration:** `properties.contact_phone`, `answer_from time`, `answer_to time`; E.164 validation in the editor.
- **Guest:** Help shows hours in the property timezone and a `tel:` link, only on authorised pages; on the 7a error page only if the session was confirmed before the failure.
- **Tests:** phone absent from denied, opening and unconfirmed error pages; hours spanning midnight.

## Phase 8a — Privacy bullet panel (Track B, after D4)

- **Scope:** static bullets on Help: what is sent, who sees it, retention per D4; 90 days as one constant shared with `/privacy`. Before release check the deployed DB schedules cleanup (`select * from cron.job`); otherwise the text can't promise deletion.

## Phase 8b — Text-first loading states (Track A)

- **Scope:** (1) "Opening your guide…" on `GuestOpen` becomes the skeleton, CSS-only shimmer respecting `prefers-reduced-motion`, retry link after ~8 s. (2) Measure the guide read and counter write (`share.server.ts:218`); make the counter fire-and-forget only if it measurably delays the page. No new dependencies.
- **Tests:** timeout link renders; shimmer off under reduced motion.

## Review dispositions

All external-review findings were confirmed against the code:

- **Credential model:** `share_links` has `enabled`/`disabled_at`, no expiry (`phase2_auth_database_security.sql:69-76`) → D6, 4a.
- **Draft exposure:** `state = 'approved'` in RLS (`phase5_translations.sql:116`) and query (`guide.server.ts:247`) → reviewed-only 5a, opt-in 5b.
- **Source link vs cookie:** `guest-ui.ts:258` drops `?lang` → 3b.
- **Route nesting:** `g.$shareId.guide.tsx` has no `<Outlet>` → 1a options.
- **Per-section provenance:** fallback per row (`guide.server.ts:109`) → 5a.
- **`readOnly` vs select/radio:** → disabled fieldset + snapshot (2).
- **No-JS help form is conditional:** first exchange needs JS → D5.
- **Errors mapped to denied:** `g.$shareId.tsx:16` → 7a; SSR also slow (`share.server.ts:218`) → 8b.
- **Retention wording:** schedule conditional (`phase7a_retention.sql:3-12`, `phase7d_auth_limits.sql:80`) → D4, 8a.
- **Independence overstated:** → tracks.
- **Cookie disclosure:** `privacy.tsx:41` covers only the session cookie → D2, 3b.
- **Oversized phases, timezone gap:** `guide-validation.ts:40` → split phases, 7b.

Unverified: whether the deployed DB schedules cleanup (8a), and the sub-heading convention in seed data (1b).
