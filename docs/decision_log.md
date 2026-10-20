# Staywise — Decision Log

*All decisions taken, dated. Design-review decisions (D1–D23) were made 18 October 2026 and traced to the review questions Q1–Q23; platform decisions were recorded 17 October 2026. Details, acceptance criteria, and verification live in [`plans/implementation_plan.md`](../plans/implementation_plan.md); product context in [`smart_guest_portal_plan.md`](smart_guest_portal_plan.md).*

## Product and pilot (D1–D11, D16, D17, D21)

1. **D1 — Integration posture.** No booking-system integration ships in the pilot build. The schema is reservation-aware from the first migration; the first integration is chosen after the pilot from what pilot hosts actually use. (Q1)
2. **D2 — Generic link baseline.** One generic property link stays the default; per-stay personalization is an optional enhancement layered on when reservation data exists. (Q2)
3. **D3 — Self-serve setup.** No concierge onboarding in the pilot; hosts complete setup alone so real friction is measured, not assisted away. (Q3)
4. **D4 — AI corpus rule.** Future AI answers only from host-approved guide content; PMS/listing data supplies optional context, never property facts; access codes stay structured lookups. Every guest question is tagged "was it in the guide?" — if ≥50% are, findability work comes before any AI. (Q4)
5. **D5 — Recruitment mix.** Five hosts, deliberately mixing channel-manager/PMS users with OTA-only owners. (Q5)
6. **D6 — Ease-of-use bars.** Median ≤60 min to first published guide; second property ≤15 min via copy; ≤5 min median host effort per report; price test $5–9/property/month. (Q6)
7. **D7 — Support on request only.** Human help only when a host explicitly asks; every request is logged as a stall finding tied to its step. No proactive outreach. (Q7)
8. **D8 — Setup instrumentation.** First-party `setup_events` (sign-in, property created, section saved, preview opened, publish clicked, support requested) in Postgres; host-scoped, 90-day retention, never shown to hosts. (Q8)
9. **D9 — Combined continue/stop gate.** Continue only if both: ≥2/5 hosts make paid commitments AND ≥3/5 publish unassisted within 60 min. Setup failure ⇒ content-ingestion becomes the next build; payment failure ⇒ revisit buyer/problem first. (Q9)
10. **D10 — Reservation-aware schema scope.** Nullable `reservations` table plus optional stay-binding on share links/guest sessions; empty in the pilot, no UI, no logic. (Q10)
11. **D11 — Recruitment screening.** Willingness screen ("~1 hour, no onboarding call"); the screening bias toward host-who-try is noted in the write-up. (Q11)
12. **D16 — Host alert.** Minimal "you have a new guest message" email (no guest content, no reply-by-email) ships in the pilot through the reviewed SMTP path; guest-side email stays out. (Q16)
13. **D17 — Guest-side counting.** Per-property daily aggregates only (link exchanges, guide opens, submissions); no guest identifiers, no third-party analytics, no section tracking. (Q17)
14. **D21 — Anonymous by design.** No guest-facing feature requires identity; "Guest" is the default label; reservation context degrades cleanly when missing. (Q21)

## Ingestion and integrations (D12–D15, D19, D20, D22, D23)

15. **D12 — Ingestion API is the canonical mechanism.** One validated server-side write layer serves the host editor now and scoped tokens, PMS workers, and webhook recipes later. (Q12)
16. **D13 — API v1 scope.** Content and reservation upserts with separate scopes (`content:write`, `reservations:write`); reservations inert/synthetic during the pilot and gated behind privacy/DPA terms before any real row exists. (Q13)
17. **D14 — Exposure timing.** The API-shaped write path is built now; tokens are exposed only when a real consumer exists, and the API is never offered to pilot hosts. (Q14)
18. **D15 — Reservation payload contract.** Fields: `external_id`, `source`, stay start/end, optional guest first name, locale, and party size. Idempotent upsert on `(source, external_id)`; no raw payload stored; rows deleted ~90 days after stay end. Tokens: 256-bit, hashed at rest like share secrets, property-bound, rotatable, last-used-timestamped, never logged. (Q15, party size added under D20)
19. **D19 — No server-side listing fetching.** Listing-URL import is rejected outright (Airbnb's terms forbid automated collection). Content-in means host-supplied material — paste, upload, clone, templates — with drafting assistance arriving only with AI. (Q19)
20. **D20 — First PMS sync by host tooling.** Post-pilot, selected from pilot hosts' actual tools among self-serve API vendors (Beds24, Lodgify, Hosthub, Hospitable) or Smoobu via its contact gate; built as a competitor-parity key-paste sync. PMS webhooks (Smoobu, Beds24, Uplisting, Hospitable) can push into the token API as the interim path. Partner-gated vendors (OwnerRez multi-account, Hostaway, Guesty) only if pilot hosts use them. (Q20)
21. **D22 — iCal deferred.** Dates without guest identity cannot distribute per-stay links; revisit only if stay-date awareness is explicitly demanded. (Q22)
22. **D23 — Email-forward assist as fallback.** Post-pilot and demand-triggered: host forwards booking mail → pre-filled stay details await host confirmation → saved as a reservation row; reservation code is the dedupe key; never automated guest-facing actions. For OTA-only hosts. (Q23)

## Process (D18)

23. **D18 — Documentation consolidated in a single pass** after the integration research landed, rather than incrementally. Executed 18 October 2026. (Q18)

## Platform (recorded 17 October 2026)

- **P1 — Stack.** TanStack Start (React, TypeScript, Vite), Bun with exact `packageManager` pin and frozen lockfile, single package. Netlify Pro, official TanStack plugin, Frankfurt functions, Node.js 24 runtime.
- **P2 — Data.** Supabase Pro production + isolated synthetic staging, both `eu-central-1` (Frankfurt); Supavisor transaction pooler with `sslmode=verify-full`; private schema, limited runtime role, forced RLS, Data API disabled.
- **P3 — Host auth.** Invite-only; Supabase Auth magic links with PKCE and one-use codes; TOTP MFA required (AAL2 for the workspace); 30-day session time-box, 14-day inactivity timeout.
- **P4 — Translation.** Stored, host-reviewed per source revision via Google Cloud Translation Advanced EU endpoint; host-triggered only; never at guest view time; secrets/contact data excluded by egress allowlist.
- **P5 — Guest access.** 256-bit secret in URL fragment → same-origin exchange → HttpOnly guest session; HMAC storage; rotation/disable invalidates sessions; uniform denial.
- **P6 — AI off for the first pilot.** Revisit only after pilot evidence and a privacy/retention review (see D4 for the corpus rule).
- **P7 — Retention.** 90 days for guest messages, audit events, and setup events; 30 days for disabled-link metadata; property deletion removes everything.
- **P8 — Commercial.** Price experiment $5–9/property/month; "Staywise" stays provisional until name/domain clearance.

## Guest features (G1–G6, recorded 20 October 2026)

Decision IDs D1–D6 in [`guest_features_plan.md`](guest_features_plan.md) map to G1–G6 here.

- **G1 — Host contact.** Store an E.164 phone and answering hours per property; shown only on authorised guest pages, never on denied/opening/error pages; disclosed on the privacy page.
- **G2 — Remembered language.** `sw_lang` cookie (`Path=/g`, HttpOnly, Secure, SameSite=Lax, 180 days), shared across properties, falls back to source when not enabled; disclosed on the privacy page.
- **G3 — Translations stay host-reviewed.** Draft machine translations never reach guests (default; plan phase 5b not scheduled).
- **G6 — Structured access credentials.** Host-entered static Wi-Fi password and key-box code shown to guests after exchange only; never translated, never in metadata or error pages; the editor warns that changing a code is the only way to revoke it from past guests. No reveal window. Narrows O2 for the pre-integration build.
- **Guide layout.** One native `<details>` block per section on the guide page; no per-section routes.
- G4 (privacy/retention copy) and G5 (no-JS help form) remain open.

## Open decisions

- **O1 — First PMS integration target.** Selected post-pilot from pilot hosts' tooling (candidates in D20).
- **O2 — Access codes at first integration.** Store verdict open: dynamic per-stay lock codes pass-through vs host-entered static; either way never stored past retention and never in translation/AI egress.
- **O3 — Token API exposure timing.** When a real consumer exists (D14).

Remaining operational gates (locale selection, SMTP provider review, staging compute, name clearance, AI reassessment) are tracked in [`plans/implementation_plan.md`](../plans/implementation_plan.md) §9.
