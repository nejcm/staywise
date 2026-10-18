# Staywise — Integration and Ingestion Research

*Primary-source scan checked 18 October 2026. Companion to [`smart_guest_portal_plan.md`](smart_guest_portal_plan.md) and [`../plans/implementation_plan.md`](../plans/implementation_plan.md).*

This document answers three questions the pilot spec defers: how property content gets **in**, how reservation/guest data gets **in**, and what an AI Q&A feature would actually need as its answer corpus. Claims are marked **[verified]** when they come from a vendor's own developer docs, help center, terms, or a standard; **[reported]** when a vendor doc states something about a third party (usually an OTA) that the OTA does not confirm publicly; and **[inference]** when it is my reading of the evidence. Login-gated or partner-only material is called out explicitly.

---

## Summary

- **No OTA gives this product direct reservation access.** Airbnb, Booking.com, and Expedia/Vrbo all gate reservation data behind partner programs aimed at PMS/channel-manager vendors. Airbnb's API Terms are public and explicitly make API access program-based with NDA, data-security review, and mandatory feature adoption. **[verified]** [Airbnb API Terms](https://www.airbnb.com/help/article/3418)
- **Airbnb's API documentation is half-public.** The index at [developer.airbnb.com](https://developer.airbnb.com/) lists Homes API (listing management, availability checks, reservations) and Activities API (including Messages), plus public changelog/sandbox stubs; the actual reference pages redirect to an Airbnb login. **[verified]** — the reference pages are partner-gated; nothing about reservation payload fields could be confirmed first-hand.
- **Booking.com's Connectivity APIs are fully documented in public**, including the fact that guest phone numbers were removed from all reservation payloads on 28 September 2026 and that the booker email field is an alias. **[verified]** [Migrating to new versions](https://developers.booking.com/connectivity/docs/migration-guides/migrating-to-new-versions)
- **iCal carries date blocks only.** RFC 5545's `VEVENT` has no property for guest name, party size, contact details, or messages. **[verified]** Airbnb strips guest names and reservation codes from its exported feed; Booking.com's export labels bookings and manual closures identically. **[reported]**
- **The realistic paths in for a 1–10 property product are:** (a) manual/template content entry, (b) host-initiated import from a listing URL (already done by Touch Stay) or a pasted/pasted-PDF guide, (c) iCal for dates, (d) email parsing as a pragmatic but fragile route, and (e) PMS APIs for the subset of owners who already run a PMS — several of which are self-serve and publicly documented.
- **None of the small-operator PMS APIs is free of a gate**, but the gates differ: some are self-serve API keys (Beds24, Lodgify, Hosthub, Hospitable for own-account use), some need a one-time email to the vendor (Smoobu, Uplisting OAuth, Hospitable Marketplace), and some require partnership agreements for multi-account use (OwnerRez, Hostaway partner selection, Guesty Marketplace).
- **AI Q&A does not need reservation data to work.** Touch Stay's chatbot answers only from guidebook content and declines anything else; StayNote answers only from host-confirmed property fields and escalates decisions. Both use the host's own content as the corpus. **[verified]**
- **Airbnb's ToS prohibits scraping**, including "bots, crawlers, scrapers, or other automated means to access or collect data". **[verified]** That makes server-side "paste your Airbnb URL, we pull the listing" a legally grey feature even though a competitor ships it.

---

## 1. Property-content ingestion paths

| Path | What it yields | Who does it today | Effort / risk |
|---|---|---|---|
| Manual structured form / template | Whatever the host types | Staywise MVP, NestGuide, StayNote | Low effort, no legal exposure; the friction to measure in the pilot |
| Clone/copy an existing guide | Full content set | Touch Stay ("clone existing guidebook"), Hostfully (guidebook templates) | Low; also gives hosts a migration path from a competitor |
| Import from a listing URL | Name, address/location, photos, description, amenities, house rules | [Touch Stay](https://help.touchstay.com/en/articles/15873428-how-to-import-a-guidebook-from-airbnb-or-booking-com) **[verified]**, [Hostfully](https://help.hostfully.com/en/articles/4280760-import-properties-from-airbnb) (properties only) **[verified]** | Medium; requires fetching an OTA page or an authorised account, and Airbnb's ToS forbids automated collection **[verified]** |
| PDF / Word guide upload | Unstructured text to be mapped into fields | Touch Stay shows a **"Start with PDF file"** card marked **"Coming soon"** for non-STR account types **[verified]**; Hostfully can embed a PDF but not parse it **[verified]** | High; parsing fidelity, but no ToS problem if the host supplies the file |
| PMS listing sync | Property/listing content already in the owner's PMS | Every guidebook vendor with PMS integrations | Medium; only helps the minority of 1–10 unit owners who run a PMS |

**Practical read.** Listing-URL import is the highest-value convenience feature in this category and Touch Stay already ships it, but it is the one ingestion path with a documented terms problem on Airbnb's side. A safer variant is host-uploaded content (PDF/Word/paste) plus a copy-from-competitor route; measure whether hosts actually convert those into usable fields before investing in parsing.

---

## 2. Reservation and guest data paths

### 2.1 OTA partner APIs

#### Airbnb

**What access exists.** Airbnb runs program-based API access, not a self-serve developer platform. The index page lists a **Homes API** (Manage Listings, Sync Availability Checks, Reservations) and an **Activities API** (content/media, availability checks, Messages including ticket QR codes). **[verified]** [developer.airbnb.com](https://developer.airbnb.com/)

**What the terms require.** Program Requirements always include: signing Airbnb's standard mutual NDA, agreeing to the API Terms, signing any Partner Specific Terms, successfully completing a **data security review**, and implementing **all mandatory API features within 6 months** of release. Which scopes a partner gets is "determined by Airbnb … at Airbnb's sole and absolute discretion". **[verified]** [API Terms §1.3](https://www.airbnb.com/help/article/3418)

Other binding constraints from the same document **[verified]**:

- Prohibited uses include using the API to "scrape, collect, or use … Content … for purposes of retaining static copies or building databases", to derive income from API content, to compete with Airbnb's products, or to expose non-public Member Content without the member's explicit written opt-in.
- The licence is "revocable, non-transferable, non-sublicensable"; Airbnb may limit or suspend access at will and set call/volume/rate limits unilaterally.
- Personal data obtained through the API may be used only for the permitted use, must not be sold/shared under CCPA, and must be destroyed or returned within 30 days of termination.
- Security minimums include MFA, quarterly vulnerability scanning, OWASP Top 10 practice, and breach notification to Airbnb within **one hour** for credential/content incidents.

**Partner directory.** [airbnb.com/software-partners](https://www.airbnb.com/software-partners) is public and has three views: an overview naming a handful of Preferred+ partners (Hostfully, OwnerRez, and others), a **Preferred Partners** view (listed as 21 pages) and an **All Partners** view (~350 entries). The All Partners list includes the small-operator tools relevant here — **Smoobu, Beds24, Uplisting, Hostaway, Hospitable, Hostfully, OwnerRez, Lodgify, Guesty, Hosthub, Hostify, Hostex, Tokeet, Lodgix, Booking Automation, Channex, Rentals United** and many more. **[verified]** [All partners](https://www.airbnb.com/software-partners/all-partners)

- Airbnb states Preferred partners "provide the requisite functionality and software connections that meet or exceed all our technical and performance benchmarks". **[verified]** [Preferred Partners](https://www.airbnb.com/software-partners/preferred-partners)
- Airbnb's reservation reference pages are **login-gated**; the field-level payload could not be verified in this pass. **[verified: the gate]**
- One third-party integration vendor claims Airbnb grants the property-management scope exclusively to one app per host account, so a guest-comms product must request messaging or read-only scope to coexist with an incumbent PMS. **[inference / vendor-reported]** — [Repull](https://repull.dev/airbnb-api). This is consistent with the scopes concept in the API Terms but is **not** confirmed by any Airbnb page I could reach.

**What hosts themselves receive.** After a confirmed reservation, the host can see the guest's phone number in reservation details (removed if the reservation is cancelled). In some US/Canada cases Airbnb assigns a **temporary phone number**, active from booking until two days after checkout, and exposes only the **last four digits** of the guest's real number for door-code suggestions. Before confirmation, Airbnb does not share either party's email or phone. **[verified]** [Guest phone number](https://www.airbnb.com/help/article/4155), [Temporary phone numbers](https://www.airbnb.com/help/article/3764), [Contacting a host](https://www.airbnb.com/help/article/1428)

The Off-Platform and Fee Transparency Policy prohibits soliciting a guest's email/address/other channels through the Airbnb messaging system **or the email alias** after a booking, and prohibits using guest contact information for marketing or list sign-ups. **[verified]** [Off-Platform policy](https://www.airbnb.com/help/article/2799). That policy wording is the clearest Airbnb statement that an *alias* exists, but no Airbnb help page I found states what a host or an integration actually receives as the guest email address — treat "alias only, no real address" as **[reported]**, not verified. Third-party vendor documentation asserts Airbnb does not pass guest email addresses to PMS integrations at all ([Cloudbeds Airbnb API FAQ](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360060044453-Airbnb-API-FAQ), page currently bot-gated).

**Scraping and automation.** Airbnb's Terms of Service state: "Do not use bots, crawlers, scrapers, or other automated means to access or collect data or other content from or otherwise interact with the Airbnb Platform." The same section forbids circumventing technical measures. **[verified]** [Airbnb Terms of Service](https://www.airbnb.com/terms). `robots.txt` additionally disallows `/calendar/` (while allowing `/calendar/ical/` for Googlebot), and the API Terms make accessing "disallowed" pages an act of disallowed crawling. **[verified]** [robots.txt](https://www.airbnb.com/robots.txt)

#### Booking.com

**Program shape.** Booking.com exposes a documented **Connectivity APIs** suite to certified connectivity partners: content, photos, rooms, rates & availability, reservations, messaging, guest reviews, reporting, promotions, payments onboarding, performance data, and property settings. Properties grant a provider permission through a **connection request** in the extranet; each connection type is a granular permission. Providers operate through a Provider Portal. **[verified]** [Connectivity APIs](https://developers.booking.com/connectivity/docs), [Connections API](https://developers.booking.com/connectivity/docs/connections-api/connections-overview)

**What a certified partner receives in a reservation** (Booking.com's own list of details a provider must show the property) **[verified]** [Reservations testing FAQ](https://developers.booking.com/connectivity/docs/con-faq-reservations-testing-res-api):

- Booking.com reservation ID, reservation status, creation and change timestamps
- Booker details: **name, alias email address, phone number, Genius status**
- Guest names; number of guests with an adults/children breakdown
- Room type/rate, meal plan, cancellation policy, promotions, add-ons
- Check-in/check-out dates, price per room night, taxes/fees, total price
- Smoking preference, special requests, credit card data in a PCI-compliant form

Two important 2026 changes **[verified]** [Migration guide](https://developers.booking.com/connectivity/docs/migration-guides/migrating-to-new-versions):

- **From 28 September 2026, all new reservation payloads omit guest phone numbers** for every property ID (past-dated, modified, and cancelled reservations included). Numbers already shared are not removed retroactively. Booking.com's own instruction is to "retrieve the guest phone number from the Booking.com Extranet, when needed."
- The booker email field is an alias; Booking.com's API reference shows `noreply@booking.com` as the `Customer/Email` example. **[verified]** [Customer](https://developers.booking.com/connectivity/docs/api-reference/customer)
- Booking.com's partner help refers to anonymous alias addresses ending in `@guest.booking.com` in its security guidance. **[verified]** [Partner security article](https://partner.booking.com/en-us/help/account-and-log/security/online-security-awareness-phishing-and-email-spoofing)

**Two retrieval modes and their limits.** OTA XML (`OTA_HotelResNotif` / `OTA_HotelResModifyNotif`) supports acknowledgement; B.XML (`/reservations`) does not. Providers are expected to poll — Booking.com recommends every 30 seconds — because there are no webhooks; unacknowledged or unretrieved reservations **fall back to email to the property after 30 minutes** (extendable to 24 hours on request). The `/reservationssummary` endpoint returns only basic details and "doesn't include guest details, other than the guest's name". **[verified]** [Reservations overview](https://developers.booking.com/connectivity/docs/reservations-api/reservations-overview), [Missing reservation messages](https://developers.booking.com/connectivity/docs/con-faq-reservations-missing-res-messages), [Retrieving reservations summary](https://developers.booking.com/connectivity/docs/reservations-api/retrieving-reservations-summary)

**Certification and compliance per API.** Going live requires either a **certification** (test requests evaluated by Connectivity Support), a **self-assessment**, or both, depending on the API. The **Reservations API requires PCI and PII compliance plus certification**; Messaging, Content, Contacts, Guest Review, Property Details, Opportunities, and Reporting carry PII compliance requirements. **[verified]** [Going live](https://developers.booking.com/connectivity/docs/going_live). The **2019 third-party summary** of partner onboarding requirements — PCI/PII compliance, cloud-based or central-server software, real-time reservation updates, and bringing a "minimum number of properties" — matches the shape of what Booking.com still gates, but the canonical requirements page (`connectivity.booking.com`) is **login-gated** and could not be read in this pass; treat specifics as **[unverified]**. Booking.com ranks providers into Standard/Advanced/Premier/Premier Plus tiers, per Hospitable's public summary **[reported]**.

**iCal is a separate, host-level feature with strict eligibility.** Booking.com's partner help documents an extranet **calendar sync** that imports/exports iCal links to exchange "booked or closed dates", refreshing automatically **every two hours**, and explicitly "not in real time". Eligibility requires properties with **≤20 room types, at most one unit per room type, and no connectivity provider**. **[verified]** [How to synchronise your calendars](https://partner.booking.com/en-gb/help/rates-availability/extranet-calendar/how-synchronise-your-calendars-across-channels)

#### Vrbo / Expedia Group

**Supply-side integration is a partner program, not a product.** Expedia Group's Connectivity Partner Program defines minimum requirements to participate: the partner must be **Property Distribution Software**, must implement an **Availability/Rates API with Expedia Traveler Preference**, a **Booking Retrieval/Notification API with virtual cards and Value Add Promotions**, hold **PCI compliance where applicable**, and **accept the Expedia Group API License Agreement**. Program metrics, qualifying tiers (Elite/Preferred), and an annual qualification timeline through 2027 are published. **[verified]** [CPP Overview](https://developers.expediagroup.com/supply/lodging/cpp/overview)

**Connectivity Hub** lists the mandatory lodging APIs: Availability & Rates, Reservation Management, Product Management — plus optional Messaging, Reviews, Deposit, and Image APIs. **[verified]** [Documentation](https://connectivityportal.expediagroup.com/documentation/expedia)

**Integration Central** (`integration-central.vrbo.com`) is **login-gated**; its public landing page shows modules for Listings, Online Booking, Reviews, and Inquiries, and routes: PMS companies contact `vrboconnectivity@expediagroup.com`; a property manager using its **own internally built PMS** contacts `pmsalesinquiry@expediagroup.com`; it is explicitly "not intended for use by Vrbo Platform Property Managers or Integrated Property Managers using software". **[verified: the routing and the gate]** [Integration Central](https://integration-central.vrbo.com/t)

**Rapid API is the distribution direction, not ingestion.** The Rapid "Vrbo integration guide" describes partners **selling** Vrbo inventory, and requires the partner to supply guest contact details (name, phone, email) on booking. Rapid is not a route to read a host's own reservations. **[verified]** [Vrbo on Rapid integration guide](https://developers.expediagroup.com/rapid/lodging/vacation-rentals/vrbo-integration-guide), [Vrbo launch requirements](https://developers.expediagroup.com/rapid/setup/launch-requirements/vrbo-launch-requirements)

**Read for Staywise:** none of the three OTA paths is available to a product of this size without becoming a channel manager or PMS. Any OTA integration at this scale is realistically *through* a PMS/channel manager that already holds partner status.

### 2.2 PMS and channel-manager APIs

All rows below were read from the vendor's own documentation on 18 October 2026 unless marked otherwise. "Self-serve" means a host or developer can obtain credentials from the vendor's UI without a commercial conversation.

| Vendor | Docs public? | Auth model | Reservations + guest data | Gate for a multi-user product |
|---|---|---|---|---|
| **Smoobu** | Yes — [docs.smoobu.com](https://docs.smoobu.com/) | **HMAC** (recommended, per-request signature) or legacy `Api-Key` header **sunset 31 Oct 2026**; **OAuth 2 for partners only** | `GET /api/reservations`: guest-name, email, phone, adults, children, check-in/out times, notice, language, channel, channel reference-id, `guest-app-url`, `guestId`; webhooks `newReservation` / `updateReservation` / `cancelReservation`; guest messaging endpoints | Docs open with "Please contact us before you start coding"; separate [Third Party Providers](https://docs.smoobu.com/) programme for solutions serving more than one Smoobu user |
| **Beds24** | Yes — Swagger at [beds24.com/api/v2](https://beds24.com/api/v2/) + [wiki](https://wiki.beds24.com/index.php/Category:API_V2) | **Invite code → refresh token → 24h access token**, sent as a `token` header; scopes (bookings, bookings-personal, bookings-financial, inventory, properties, accounts, channels); optional IP allowlist | Bookings, prices, invoices, channels, guest management; webhooks for new bookings/messages; docs warn API access may need enabling by support; V1 deprecated | API V2 is available on every account; scopes include `bookings-personal` for guest data; no app-partner programme found |
| **Lodgify** | Yes — [docs.lodgify.com](https://docs.lodgify.com/) | **Public API key** from Settings → Public API; key carries read+write | v1/v2 bookings and enquiries, messages, availability, properties; includes an endpoint to **update a booking's room access key codes** | Docs are open; Touch Stay's guide shows the flow is a pasted API key, and warns guest email/phone "are dependent on the platform the guest used" |
| **OwnerRez** | Yes — [api.ownerrez.com/help/v2](https://api.ownerrez.com/help/v2) | **Personal Access Token** (HTTP Basic, own account only, IP-limited to two accounts/24h) or **OAuth app** (authorization-code + device flow, PKCE, 30-day tokens) | Property, booking, guest, message, review endpoints; listings endpoints gated | PAT explicitly "not designed for partner use"; **partnership agreement required for apps accessing other users' accounts**; Messaging needs an OAuth app and "third-party messaging apps still require messaging agreements" (`partnerhelp@ownerrez.com`) |
| **Hostaway** | Yes — [api.hostaway.com/documentation](https://api.hostaway.com/documentation) | **OAuth 2 client-credentials**, `POST /v1/accessTokens`; bearer token valid up to **24 months** | Reservations list/get/create/update with `guestName`, `guestEmail`, `numberOfGuests`, `adults`, `children`, `channelId`/`channelName`; `?includeResources=1` for custom fields, fees, units, hostProxyEmail | API key generation in the dashboard **requires choosing a Partner**, with a generic "Hostaway Public API" option for non-partners; Marketplace has official partner listings |
| **Guesty** | Yes — [open-api-docs.guesty.com](https://open-api-docs.guesty.com/) | **OAuth 2 client-credentials** (`clientId`/`clientSecret` created in the dashboard), 24h tokens, max 5 token requests/24h per client | Listings, reservations, guests, messages; Open API has a single admin scope | Docs state: "If you are a Guesty Marketplace or Channel (OTA) Partner, please refrain from using the Open API and contact partnerships@guesty.com" — i.e. multi-tenant access is a commercial conversation |
| **Hospitable** | Help center + developer portal — [PAT article](https://help.hospitable.com/en/articles/8609392-accessing-the-public-api-with-a-personal-access-token-pat), partner article | **Personal Access Token** (own account only; read and/or write permissions; 1-year expiry; optional IP allowlist) or **OAuth** for marketplace integrations | Public API v2 at `public.api.hospitable.com/v2`; reservations list/get with `include=guest,financials,listings`; platform + platform_id (channel confirmation code); webhooks for reservations, properties, messages, reviews | Own-account PAT requires a **paid plan** (Essentials excluded); "Integrations must use OAuth … to qualify for our Marketplace", with a partner application, Partner Resources page, and Partner Portal managing OAuth clients and webhooks |
| **Uplisting** | Yes — Postman docs + support articles | **Legacy API key** (HTTP Basic) or **V3 OAuth** (authorization code + PKCE, scoped, 1h tokens, `offline_access` for refresh) | Bookings with guest_name, guest_email, guest_phone, number_of_guests, channel, **lock_code**; messaging, reviews, custom booking attributes; webhooks for booking_created/updated/removed and messages | Single-account use is self-serve; "Offering your integration to other Uplisting customers … needs a partner agreement" (`partner@uplisting.io`); creating bookings on the legacy route also needs a client ID |
| **Hosthub** | Yes — ReDoc/Swagger at [hosthub.com/docs/api](https://www.hosthub.com/docs/api/) | **API key** in the `Authorization` header (from Settings); base `https://app.hosthub.com/api/2019-03-01` | Calendar events of type Booking carry `guest_name`, `guest_adults`, `guest_children`, `guest_email`, channel reservation id, rates/availability | Public YAML spec; no documented partner programme; support "will guide you through the integration development process" |
| **Channex** (aggregator, not a PMS) | Yes — [docs.channex.io](https://docs.channex.io/about-channex-and-faq) | API platform for PMS vendors | White-label channel manager API: "77 OTA booking channels and 470+ PMS integrations" per vendor marketing | Relevant as a **"ride on someone else's partner status"** option if OTA distribution ever becomes a requirement |

Notes and caveats:

- **Airbnb's API Terms apply on top of every one of these.** A PMS API key lets you read data the PMS legitimately holds; it does not grant you an Airbnb partner relationship, and the API Terms' restrictions (no database building, no competing products, no exposing non-public Member Content) still bind whoever touches Airbnb data.
- **Guest email availability is inconsistent across the whole chain.** Touch Stay's own Lodgify guide says guest email and phone "are dependent on the platform the guest used to complete their booking" **[verified]** [Lodgify Integration](https://help.touchstay.com/en/articles/13715382-lodgify-integration) — the practical statement that OTA-sourced bookings often arrive without usable contact details.
- **Access codes are a real API surface**, not just free text: Uplisting exposes a per-booking `lock_code`, Hosthub carries booking-level guest fields, and Lodgify has a "rooms' access key codes" endpoint. **[verified from each vendor's docs]** Any Staywise feature that shows guests an access code must decide whether the code lives in Staywise or is passed through at request time.

### 2.3 iCal (RFC 5545): what it carries and what it cannot

**The standard.** iCalendar's `VEVENT` component defines, among others, `DTSTAMP`, `UID`, `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `URL`, `STATUS`, `CLASS`, and `ATTENDEE`. **[verified]** [RFC 5545 §3.6.1](https://www.rfc-editor.org/rfc/rfc5545.html) There is **no** standard property for guest name, party size, contact details, price, or messages. `DTEND` is the non-inclusive end of the event, and `UID` is the only join key an importer can rely on for reconciliation.

**What an OTA feed actually contains.**

- **Airbnb.** Export produces a per-listing `.ics` URL refreshed on a schedule (Airbnb documents its own calendar updates as roughly **every 3 hours**, and imports up to 2 years of data). **[verified]** [Sync your calendar](https://www.airbnb.com/help/article/99) Since **1 December 2019** Airbnb strips guest name and reservation code from exported events; the summary reads "Reserved" and the description carries a link to the reservation page plus the **last four digits of the guest's phone number**. **[reported]** — the announcement text is quoted in Airbnb's community forum ([Airbnb modifying iCal syncing](https://community.withairbnb.com/t5/Help/Airbnb-modifying-iCal-syncing-WTH/m-p/1191834)) and is corroborated by a channel manager's documentation: "Airbnb only sends blocked dates and the last four digits of the guests phone number. Personal information like guests name and Email address and the price are not provided." **[verified as Beds24's statement]** [Beds24 Airbnb iCal](https://manual.hostsync.io/index.php?title=Airbnb_iCal). I could not confirm on an Airbnb-owned page what the current 2026 export body contains.
- **Booking.com.** Calendar sync exchanges "booked or closed dates" only, and vendor guides report that Booking.com exports both real bookings and manually closed dates under the same label ("CLOSED - Not available") with no guest name. **[verified for the Booking.com page; reported for the label]** [Booking.com calendar sync](https://partner.booking.com/en-gb/help/rates-availability/extranet-calendar/how-synchronise-your-calendars-across-channels)

**Structural conclusion.** iCal can tell Staywise that a property is occupied and for which nights. It cannot reliably tell you who the guest is, how many are coming, their language, or anything they wrote. Any product feature that assumes iCal gives you guest identity will be wrong. iCal is also **one-way, polled, and site-specific** — Airbnb's eligibility and Booking.com's eligibility rules differ, and Booking.com excludes properties that already use a connectivity provider.

### 2.4 Email parsing as an ingestion path

**Does anyone ship it?** Yes, as a general-purpose document/AI parsing category rather than as an OTA-blessed feature:

- **Parseur** defines a predefined "property bookings" mailbox: forward confirmation emails, get structured rows. It claims to read Airbnb (English, French, German, Italian, Spanish), Booking.com, Vrbo, Beds24, Duve, Eviivo, Guesty, MyAllocator, Priceline and TripAdvisor Rentals; extracts guest name, check-in/out, number of guests, property, confirmation ID, payout/fees/taxes, status, and "guest contact details where the platform shares them"; dedupes alterations on the reservation code; is GDPR and SOC 2 Type II compliant; free tier is 20 pages/month. **[verified]** [Parseur property bookings](https://parseur.com/use-case/extract-data-from-property-bookings)
- Comparable general tools exist (mailparser.io, Airparser) with the same shape. **[reported]**

**Viability and fragility.**

- The mechanism is host-side and opt-in: the host creates a forwarding rule from their own mailbox. That is materially different from scraping Airbnb, and Airbnb's ToS prohibition is about automated access to the *platform*, not about a host forwarding their own mail. **[inference]** The Off-Platform policy is the relevant constraint instead: it forbids using guest contact information for marketing or list sign-ups, and forbids soliciting guests' email/other channels. **[verified]** [Off-Platform policy](https://www.airbnb.com/help/article/2799)
- What the emails actually contain is limited. Booking.com's own fallback email exists precisely for providers that failed to retrieve via API; Airbnb's host confirmation email is the host's first notification but Airbnb's templating details expose guest **first name**, dates, house rules, wifi details, address and confirmation code — not a guest email address. **[verified for the detail list]** [Scheduled quick replies](https://www.airbnb.com/help/article/2897)
- Real fragility: OTA email layout changes, PDF vouchers that need OCR, changes/cancellations arriving as separate emails, and non-deterministic AI extraction on money fields (payouts). Parseur's own page concedes the need for a human validation step and pitches dedupe keys for exactly this reason. **[verified]**
- ToS exposure is low for host-forwarded mail; commercial exposure is higher — a product whose reservation ingestion depends on parsing OTA emails is one OTA redesign away from degraded data, and OTA terms may change.

**Suggested posture if adopted:** treat email parsing as **host-provided data entry with assistance**, not as an authoritative reservation sync. Show the parsed values for host confirmation, store the reservation code as the dedupe key, and never drive automated guest-facing actions from it.

---

## 3. Partner-program gates & requirements at a glance

| Programme | Public requirements | What you would actually need to do | Verdict for a 1–10 property product |
|---|---|---|---|
| Airbnb API / Preferred Software Partner | NDA, API Terms, Partner Specific Terms, data security review, 6-month mandatory-feature commitment, Airbnb's sole discretion on scopes **[verified]** | Be a software company with a support org and live host customers; pass security review; accept ongoing engineering obligations | Not realistic for a pilot; approach only if OTA-sourced reservation data becomes the product's core value |
| Booking.com Connectivity Partner | Certification and/or self-assessment per API; PCI compliance for Payments, PII compliance + certification for Reservations; cloud-based software and minimum property volume **[verified for the API matrix; unverified for the volume threshold — requirements page login-gated]** | Apply as a channel manager/PMS; run certification tests on test properties; accept ongoing feature parity expectations | Not realistic; the product would have to *be* a channel manager |
| Expedia Group / Vrbo Connectivity | Distribution-software system type; Availability/Rates + Booking Retrieval/Notification APIs; PCI; API License Agreement acceptance **[verified]** | Apply via `vrboconnectivity@expediagroup.com`; certification and quarterly programme metrics | Not realistic |
| PMS vendor APIs | Publicly documented for Smoobu, Beds24, Lodgify, OwnerRez, Hostaway, Guesty, Hospitable, Uplisting, Hosthub **[verified]** | Per-vendor: paste an API key (Lodgify, Hosthub, Beds24 invite code, Hospitable PAT), or email for OAuth/partner credentials (Smoobu, Uplisting, Hospitable Marketplace, Hostaway partner selection), or sign a partnership agreement (OwnerRez multi-account, Guesty Marketplace) | **This is the supported path.** Start with the self-serve ones |
| iCal | Public per-OTA help pages; Airbnb import/export, Booking.com calendar sync eligibility rules **[verified]** | Host pastes URLs into Staywise (and into their OTA) | Available today, but dates only |
| Email parsing | No OTA programme; general tools exist **[verified]** | Host forwards booking mail to an address | Viable supplement, not authoritative |

---

## 4. Competitor mapping: how the peers ingest content and reservations

**Touch Stay** ([integrations list](https://touchstay.com/integrations), checked 18 October 2026)

- **Content in:** "Start with Online listing" pulls from an **Airbnb or Booking.com listing URL** — property name, address/location with map pin, photos, description mapped to template categories, amenities, house rules; unmapped content creates new categories. The FAQ is explicit that the import is a **one-time pull**, that re-import into an existing guidebook is not possible, and that only Airbnb and Booking.com URLs are supported. A **"Start with PDF file"** card exists but is marked **"Coming soon"** for non-STR account types. **[verified]** [Import a guidebook](https://help.touchstay.com/en/articles/15873428-how-to-import-a-guidebook-from-airbnb-or-booking-com)
- **Reservations in:** ~29 named PMS/channel integrations including Airbnb, Beds24, Hosthub, Uplisting, Lodgify, OwnerRez, Hostaway, Hospitable, Guesty, Tokeet, Cloudbeds. The Lodgify guide shows the pattern: paste the PMS's own **API key** into Touch Stay, match units, choose which fields to map (booking source, number of guests, booking ID, guest first/last name, arrival/departure, guest phone/email), then sync future reservations. **[verified]** [Lodgify Integration](https://help.touchstay.com/en/articles/13715382-lodgify-integration)
- **Airbnb specifically:** Touch Stay markets a direct Airbnb connection ("Import listings & sync bookings in a few clicks", "no tricky APIs"). **[verified as marketing claim]** [Touch Stay & Airbnb](https://touchstay.com/integrations/airbnb). Touch Stay does **not** appear in Airbnb's All Partners directory as read on 18 October 2026. **[verified by absence in the list I retrieved]**

**Hostfully**

- **Content/pms in:** "Import properties from Airbnb" and "Import properties from Booking.com" exist as property-import flows that require connecting the account that owns the listing. **[verified]** [Import properties from Airbnb](https://help.hostfully.com/en/articles/4280760-import-properties-from-airbnb), [Import properties from Booking.com](https://help.hostfully.com/en/articles/10145918-import-properties-from-booking-com)
- **Guide content:** PDFs can be **uploaded and embedded** into guidebook cards, not parsed into fields. **[verified]** [Embed a PDF](https://help.hostfully.com/en/articles/5314156-embedding-a-pdf-in-your-guidebook). Recommendations can be auto-generated with a Guidebook Wizard. **[verified]** [Guidebook Wizard](https://help.hostfully.com/en/articles/3622602-tips-for-using-the-recommendation-wizard)
- **Notable for the AI section:** HostBuddy (a third party) advertises a dedicated Hostfully Digital Guidebook integration that "automatically imports all content from your guidebooks into our AI's knowledge base", plus Hostfully exports a downloadable PDF of a guidebook. **[reported — vendor FAQ]** [Hostfully FAQ](https://www.hostfully.com/faq/how-can-a-digital-guidebook-benefit-me-2/)

**StayNote** ([staynote.app](https://www.staynote.app/), checked 18 October 2026)

- Ingestion is **manual by design**: "Add the information guests normally ask you for" — no listing-URL import, no PDF parsing, no PMS integration is advertised on the public site. **[verified by absence]**
- Positioning matches what the pilot already assumes: host-confirmed property info, answers that "escalate when unsure", guest decisions returned to the host, OTA-safe vs direct guest modes, 12 languages, optional YouTube/Vimeo how-to links, free tier plus $4.99 (1 property) and $9 (up to 3 properties). **[verified]** [Pricing page](https://www.staynote.app/)

**NestGuide** — I could not retrieve substantive page content on 18 October 2026 (the site returned a JavaScript shell with only its title). Treat its ingestion features as **[unverified]**; the earlier product scan in the plan remains the only description on file.

---

## 5. AI answer corpus: what the competitors actually use

**Touch Stay's AI chatbot** **[verified]** [The AI Chatbot Explained](https://help.touchstay.com/en/articles/13715596-the-ai-chatbot-explained):

- **Corpus:** the host's existing guidebook content plus included points of interest. Nothing else. "Not yet" is the answer to customising responses — "it relies entirely on your guide content."
- **Scope control:** "Focuses only on property-specific queries" and "politely declines unrelated questions."
- **Refresh latency:** after a content edit, re-indexing takes **up to around 8 hours**.
- **Abstention/fallback:** guests can still view the full guidebook and contact the host directly; a thumbs-down prompts a feedback form (didn't answer / not detailed enough / misleading or incorrect).
- **Identity:** conversation records show the **guest's full name and stay dates only if the chatbot was opened from a personal invitation link** (created manually or by a PMS integration); Quick-Share-Link sessions show "Anonymous User". This is a direct consequence of the PMS-integration path — identity comes from the reservation, not from the guide.
- **Usage economics:** conversation limits are per guidebook per billing cycle on some plans; free trials get a shared credit pool; when a guidebook exceeds its limit the chatbot pauses and guests are pointed at host contact details.
- **Privacy:** the Touch Stay privacy policy names **OpenAI** among third-party processors operating outside the UK/EEA, and states data is kept only as long as necessary (subscription/contract data up to seven years). **[verified]** [Privacy policy](https://touchstay.com/privacy-policy)

**StayNote's Guest Care** **[verified]** [staynote.app](https://www.staynote.app/), [Privacy policy](https://www.staynote.app/privacy):

- **Corpus:** "the property information you confirm" — explicitly "not guesses from the internet". Uncertain, missing, or decision-requiring questions are escalated to the host rather than answered.
- **Privacy/retention:** relevant property information, the guest question, and "limited context needed for the task" may be sent to an AI model provider; StayNote stores Guest Care activity (answered/blocked/escalated/approved/resolved) so the host can operate the stay and the product can improve reliability; retention is "as long as reasonably necessary"; guests do not need an account.

**Implication for Staywise.** The answer corpus an AI Q&A feature needs is **the guide content Staywise already stores** — plus, optionally, property metadata and reservation context (dates, guest first name, party size, language) when a PMS/iCal path supplies it. Neither leading competitor requires reservation data for the chatbot to work; Touch Stay explicitly treats guest identity as an enhancement that arrives through the PMS integration and degrades to "Anonymous User" otherwise.

---

## 6. What this means for a small guest portal

1. **Keep property content as the product's spine.** It is the only data Staywise can obtain without a partner relationship, and it is also the AI corpus. Everything else (reservation context, guest identity) is an enhancement on top.
2. **Do not build an Airbnb/Booking/Vrbo API integration into the roadmap as a near-term item.** The terms, security review, and mandatory-feature commitments make this a company-level decision, not a sprint. If OTA-sourced reservation data becomes essential, the cheapest route is integrating *one* small-operator PMS with public docs (Beds24, Lodgify, Hosthub, Uplisting, Hospitable PAT, Smoobu with a contact email) and treating that PMS as the customer's system of record, rather than integrating every channel.
3. **iCal is a worth-it convenience, not a reservation system.** It gives occupied nights (useful for showing the right guide at the right time, or for a "your stay" panel) and nothing about the guest. Anything depending on guest name must get it elsewhere — host invitation, PMS, or the guest themselves at first visit.
4. **Listing-URL import is a real competitive feature with a real ToS problem.** Touch Stay ships it for Airbnb and Booking.com. Airbnb's ToS forbids automated collection from its platform. If Staywise builds it, prefer host-supplied material (paste, upload, or a browser-assisted copy) over server-side fetching, and record the decision and its reasoning before shipping. Options and tradeoffs are worth a one-paragraph note in the plan rather than a silent implementation choice.
5. **Email parsing should be framed as an assistant, not a sync.** If pilot hosts ask for it, the safe framing is "forward your booking mail and we'll pre-fill the stay details for you to confirm", with the reservation code as the key and host confirmation required before anything guest-facing is generated.
6. **AI stays deferred and, when it returns, it ships with the safeguards the competitors already established:** answers only from host-entered content, explicit abstention, host escalation always available, feedback capture, and a visible re-index delay so hosts are not surprised by stale answers.
7. **Pilot-relevant data model implication:** keep guest/reservation identity optional and detachable. Touch Stay's "Anonymous User vs named guest" split is the natural fallback state, and designing for it now avoids a rewrite when a PMS connection arrives.

---

## 7. Open questions and unverified items

- **Airbnb Homes API reservation payload** — login-gated. Unknown first-hand: whether guest names, phone numbers (real or temporary), email aliases, party size, or messages appear in API responses, and at which scope tiers. Resolvable only by applying or by asking an existing partner.
- **Airbnb Preferred/Preferred+ counts** — the directory paginates ("1 of 21 pages", "1 of 7 pages"); the underlying counts (a third-party blog claims 40 partners as of 24 August 2026) are **[reported]**, not verified from Airbnb. [MagicBNB](https://magicbnb.io/blog/airbnb-certified-channel-manager)
- **Airbnb iCal export body in 2026** — the "Reserved" summary and last-4-phone-digits description come from an Airbnb community announcement quoted in a forum thread plus channel-manager docs, not from a current Airbnb help page. Verify against a real host export before depending on either field.
- **Airbnb guest email** — no primary Airbnb page states what hosts or integrations receive. The Off-Platform policy references an "email alias"; PMS vendors state Airbnb does not pass guest email addresses at all. Treat as unresolved.
- **Booking.com Connectivity Partner thresholds** — the "minimum number of properties/units" language is visible in search snippets of the login-gated `connectivity.booking.com` article; the article itself could not be read. The public 2026 sources are Booking.com's own `going_live` matrix and third-party summaries.
- **Booking.com iCal content** — that bookings and manual closures both appear as "CLOSED - Not available" is **[reported]** by channel managers, not stated by Booking.com.
- **Airbnb property-management scope exclusivity** (one app per host account) — **[reported]** by an integration vendor only; would materially change any future Airbnb strategy if true, and is worth confirming with a partner before relying on it either way.
- **Commercial terms for PMS marketplaces** — Hostaway partner selection, Guesty Marketplace, Uplisting partner agreements, and Hospitable's partner programme all exist, but none publishes revenue share, review timelines, or listing requirements. All require a conversation.
- **NestGuide ingestion features** — site content not retrievable on 18 October 2026; the plan's earlier description stands unverified.
- **Hostaway documented rate limits** (15 req/10s per IP, 20 req/10s per account) — taken from a third-party API index, not confirmed on Hostaway's own documentation page.
- **Email parsing legality per OTA** — no OTA terms page was found that addresses host-forwarded booking mail. The absence of a prohibition is not permission; the Off-Platform policy's restrictions on contact use still apply.
