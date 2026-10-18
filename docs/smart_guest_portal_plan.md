# Staywise — Product Plan

*Competitive scan and recommendations checked 17 October 2026; pilot-flow and integration decisions revised 18 October 2026 (see [booking_integration_research.md](booking_integration_research.md)). Staywise is a working product name; see naming risk below.*

## Recommendation

Build a focused guest portal for independent villa owners and small property managers. The pilot tests a mobile guide, QR/link access, a few host-reviewed stored translations, and a **direct issue-to-host workflow**: guests report a problem and the host handles it in one inbox. Property setup is **self-serve and instrumented** — no concierge onboarding — so the pilot measures real setup friction rather than assisted setup. No booking-system integration ships in the pilot: content and reservation data are shaped for a token-authenticated ingestion API and a PMS connection chosen from what pilot hosts already use. AI Q&A, report translation, and task automation are deferred.

This wedge is a hypothesis, not a proven market gap. Competitors offer extensive guidebook, messaging, automation, and upsell features; the pilot should establish whether a simpler issue-resolution workflow is valuable enough to pay for.

## Market and target

- **Market:** Digital guest guides and guest-care tools for short-term vacation rentals.
- **Initial segment:** Independent villa owners and small managers (roughly 1–10 properties), starting with English-speaking and international guests.
- **Buyer:** Owner/operator who handles guest questions and property issues directly.
- **Decision this research supports:** Which competitor capabilities to match, and what small product to test first.

## Competitive landscape

Direct competitors are products that give short-term-rental guests a digital guide or property-specific support. Broader PMS products are included where their guidebook is a standalone offering. This is a focused public-web scan, not a market census.

| Product | Publicly described capabilities | Strategic read |
|---|---|---|
| [Touch Stay](https://touchstay.com/) | No-app branded guidebooks, recommendations/maps, translations, AI guest chatbot, scheduled messaging, upsells, feedback/analytics, and PMS integrations. Its current site advertises a starting price of $8.25/property/month. | Broad direct competitor; feature breadth and integrations make it a poor MVP scope to copy. |
| [StayNote](https://staynote.app/) | One private guest link/QR, host-confirmed property data, AI answers that escalate unknowns or approval decisions, 12 guest languages, video links, and OTA-aware guest modes. Public pricing lists $4.99/month for one property and $9/month for up to three. | Closest product overlap. Its explicit “answer or escalate” behavior is a baseline expectation for trustworthy AI. |
| [Hostfully Digital Guidebooks](https://www.hostfully.com/pricing/digital-guidebooks/) | Free plan for one guidebook; paid tiers add branding, bulk editing, translations in 16+ languages, marketplace upsells, and PMS/device integration. | Strong ecosystem/substitute; pricing varies by tier and package. |
| [NestGuide](https://nestguide.co/) | QR-accessible property welcome guides with Wi-Fi, appliance instructions, check-in/out, local tips, emergency contacts, secure access, and multi-property support. | Lightweight direct alternative; makes a basic QR guide easy to copy. |
| [Staywise](https://staywise.se/) / [StayWise Software](https://staywisesoftware.com/) | Existing hospitality products use the same name. Staywise.se describes property guides and an AI guest assistant; StayWise Software sells a hotel PMS and describes guest-facing and maintenance features. | Direct brand collision and possible customer confusion; resolve naming before public launch. |

### What is table stakes

- A useful mobile guest guide, available by link and QR without an app.
- Clear property essentials: arrival/access, Wi-Fi, rules, appliances, checkout, local recommendations, and host contact.
- Basic branding and a usable guest language option. For this pilot, translations are generated once per source revision, reviewed by the host, and stored; guest page views never trigger translation calls.
- Clear host escalation when a guest needs an answer the guide does not provide. Automated Q&A is deferred.

These features appear across multiple competitors and are not a defensible differentiator by themselves.

## Product hypothesis and positioning

**Hypothesis:** Small property operators will pay for a low-setup guest-care portal if it reduces repetitive questions and makes issue reports easier to resolve, without requiring a full property-management system.

**Positioning to test:** “A simple guest guide that turns guest questions and property problems into clear next steps for the host.”

Do not position the product as a full concierge or all-in-one PMS. Competing on the breadth of Touch Stay or Hostfully is outside the smallest useful first release.

## MVP

1. **Fast property setup:** Structured fields for access, Wi-Fi, parking, waste, appliances, rules, checkout, local tips, and emergency contacts. Let a host preview the guest view and reuse content across properties. Hosts complete setup without help; first-party events record each step so stalls, not just outcomes, are measured. Imports are host-supplied only (paste/upload/clone) and scheduled after the pilot decides.
2. **Guest guide:** Fast, mobile-first web page with one stable private link and printable QR code. No guest account or app.
3. **Question escalation:** Guests can ask a short property-specific question; store it in the host inbox with the original text and locale. Do not imply an automated answer or response SLA.
4. **Issue report:** Guests submit a short description and category, with no photo in the pilot. Keep the original message and do not translate or summarize it automatically. The host marks it new or handled; never automate safety or repair decisions.
5. **Simple host inbox:** One property-scoped list for questions and issue reports, with property context, optional unverified reply email, and a way to mark an item handled. A minimal "you have a new guest message" email alert (no guest content in the mail) keeps response-time measures honest.

### Defer

- PMS/channel integrations, reservation syncing, and scheduled email/SMS. The first PMS connection is selected by pilot hosts' tooling from vendors with public APIs; OTA-direct access is not pursued at this scale.
- Upsells, payment collection, review campaigns, guest CRM, and broad local-concierge recommendations.
- Automatic guide creation from listings, PDFs, or websites. Listing-URL fetching is rejected outright (Airbnb's terms forbid automated collection); content-in means host-supplied material — paste, upload, or clone — with drafting assistance only when AI ships.
- iCal feeds (dates only, never guest identity) and email-forward reservation parsing, except as a documented, host-confirmed fallback for OTA-only hosts.
- Native apps, smart-lock control, repair diagnosis, and autonomous AI actions.

Revisit an integration or deferred feature only when pilot evidence shows it blocks adoption or retention.

## Pilot plan (2–4 weeks)

1. Recruit five independent villa owners or small managers — mixing hosts who use a channel manager/PMS with OTA-only hosts — and screen on willingness to self-serve ("~1 hour, no onboarding call"). Ask what they use today and collect their existing guide and recurring guest questions.
2. Hosts set up their own properties; no concierge help. Support is available only on explicit request, and every request is recorded as a stall finding with its step.
3. Test the guest guide, question escalation, and issue form with real stays. Review reports with hosts and ask whether the inbox workflow saved effort. Tag every guest question with whether its answer was already in the guide.
4. Offer a paid continuation after the trial. Test around **$5–9 per property/month**; competitor prices vary by package, so this is a price experiment, not a market fact.

### Measures and decision rule

Track setup time per step (first-party events), support requests, guest opens, questions and issue reports, the "answer was in the guide" tag, host effort per report, translation corrections, and willingness to continue at the offered price.

Continue only if **both** hold after real guest use: at least **two of five** hosts make a concrete paid commitment, **and** at least **three of five** hosts publish a guide unassisted within 60 minutes (second property via copy: ≤15 minutes; median host effort per report: ≤5 minutes). If fewer than three publish unassisted, content-in (host-supplied import plus drafting assist) becomes the next build, not feature expansion. If guides are used but the inbox workflow is not, interview hosts before expanding scope.

## Risks and controls

- **Crowded category:** QR guide, translation, and AI Q&A are widely offered. Test the issue workflow as the wedge; do not assume it differentiates until pilots confirm.
- **AI errors if reconsidered later:** Answers come only from host-approved guide content; reservation data supplies optional context, never property facts. Show fallback behavior, keep host escalation, and do not generate door, safety, or repair instructions from guesses.
- **Guest privacy and access details:** Give hosts control over what the guest link exposes and how it can be disabled. Avoid collecting guest information without a clear need.
- **Setup burden:** The pilot is deliberately self-serve: support is on-request only and every request is a recorded stall. If fewer than three of five hosts publish unassisted, host-supplied content-in moves to the front of the backlog.
- **Booking-data access:** OTA APIs are closed to a product this size; PMS APIs are gated per vendor; iCal carries dates but no guest. The ingestion API, PMS webhooks, and a host-confirmed email fallback are the realistic paths, and guest identity stays optional so none of them is a prerequisite. See [booking_integration_research.md](booking_integration_research.md).
- **Price pressure:** StayNote publicly lists $4.99/month for one property; Touch Stay advertises $8.25/property/month as a starting price. A simpler product needs a clear time-saving story at its price.
- **Name conflict:** Public hospitality products already use Staywise/StayWise, including one describing a similar AI guest guide. Treat “Staywise” as provisional until trademark, domain, and relevant-market clearance is done.

## Technical direction

- One responsive web app in TanStack Start with React, TypeScript, and Vite; Bun for package management; Netlify for Frankfurt-hosted functions.
- Supabase/PostgreSQL for property content, stored translations, questions, and issue reports. Keep production and synthetic staging projects isolated.
- One validated write path, shaped as a token-authenticated ingestion API; property and reservation tables are reservation-aware from the first migration, with reservations empty in the pilot. Guest identity is always optional.
- Translate eligible guide text once per source revision through a server-only provider path, store drafts, and require host review. Do not call a translation service on guest views.
- Host email alerts reuse the auth SMTP path and carry no guest content; guest use is counted with per-property daily aggregates, never guest identifiers or third-party analytics.
- No object storage, LLM API, guest Q&A automation, or report translation in the first pilot.

Keep the first release to a small data model and one guest surface. No native app or integration ships before the pilot; the first PMS connection follows pilot hosts' tooling.

## Sources and confidence

Public product and pricing pages checked **17 October 2026**. Pricing and feature packaging can change; confirm before using these figures in customer-facing comparisons. Competitor capabilities above are vendor-described, not independently tested. StayNote's exact prices and language count were visible on its current public site; Touch Stay's displayed starting price and Hostfully's tier packaging were visible, but exact checkout totals may depend on property count, billing period, or region.

Integration and ingestion facts — OTA API gates, PMS/channel-manager APIs, iCal limits, competitor import behavior, and AI corpus sourcing — were checked **18 October 2026** in [booking_integration_research.md](booking_integration_research.md), which marks verified, reported, and inferred claims separately.

- [Touch Stay product](https://touchstay.com/) and [pricing](https://touchstay.com/pricing)
- [StayNote product and pricing](https://staynote.app/)
- [Hostfully Digital Guidebooks and pricing](https://www.hostfully.com/pricing/digital-guidebooks/)
- [NestGuide](https://nestguide.co/)
- [Staywise](https://staywise.se/) and [StayWise Software](https://staywisesoftware.com/)
