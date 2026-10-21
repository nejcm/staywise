# Staywise

Guest portal for independent vacation-rental owners (1–10 properties): a mobile guest guide served by link/QR, plus one host inbox for guest questions and issue reports. No app, no guest account, no booking-system integration at launch.

**Status:** the local pilot feature set is implemented through implementation plan Phase 7c, plus the guest features plan (phases 1–8: essentials, call actions, address/maps, answering hours, privacy panel, loading states), with synthetic-data verification: host onboarding and guide authoring, link/QR sharing, the guest guide in English/German/Slovenian/French/Spanish, inbox and alerts, retention cleanup, and security/accessibility hardening. Deployment, real SMTP, provider backup/PITR, hosted Auth session policy, physical-device checks, and the five-host pilot remain external gates.

**Name:** "Staywise" is provisional; existing hospitality products use it (see the product plan).

## Stack

TanStack Start (React 19, SSR, server functions) with CSS Modules, Bun, Supabase (Postgres with RLS, Auth with magic link + TOTP, pg_cron), Netlify. Tests: Vitest unit and local-stack integration suites, pgTAP for the database.

## Host workspace

`/host` lists each property with its address, published state, guide categories, unpublished sections, guest link state, which guest languages are fully reviewed, and the latest waiting messages. The property editor has a guest preview in phone and tablet device frames at `/host/preview/<propertyId>`. Each property picks one of five preset guest page themes ([ADR 0003](docs/adr/0003-guest-themes-are-presets.md)).

`/host/settings` holds account settings: two-step sign-in (set up or remove the authenticator), security activity (the 20 most recent sign-ins, two-step changes, and agent access grants and revocations from the 90-day audit log; agent tool calls are not listed), sign out, and the defaults for new properties (theme, guide and guest languages, time zone, check-in/out times, contact phone, answering hours). Defaults are copied into a property when it is created and never applied to existing properties; a copy keeps the values of its source property. Until a host saves, built-in defaults apply (`staywise` theme, English, `UTC`); the form only suggests the browser's time zone.

## Development

Prerequisites: Bun (pinned in `package.json`), Docker (local Supabase), Node.js 24+.

```sh
bun install --frozen-lockfile  # install dependencies
bun run dev                    # dev server on http://localhost:3000
bun run verify                 # typecheck, lint, format check, tests, unused-code check
bun run test:coverage          # unit tests with coverage thresholds
bun run test:e2e               # Playwright + axe on public pages (builds, serves on :3100)
bun run db:start               # local Supabase stack (Docker)
bun run db:reset               # apply supabase/migrations to a clean local database
```

Optional synthetic data for local development (not loaded by `db:reset`; idempotent):

```sh
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/test_seed.sql
```

It creates three hosts (`maria-host@example.test`, `tomaz-host@example.test`, `jana-host@example.test`, sign in through Mailpit), four properties, and guest links (`/g/<id>#<secret>`, listed in the file header). The Bled lakeside apartment is fully filled in: essentials, address, contact and answering hours, Wi-Fi/key box credentials, sections in every category, de/sl translations, inbox messages, and reservations.

Environment: copy `.env.example` to `.env.local`; never commit real values. `APP_ENV` defaults to `local` and must be set explicitly (`preview`/`production`) when `NODE_ENV=production`. Set `GUEST_ACCESS_DISABLED=true` to stop all guest exchange, reads, and message intake (see the kill switch below); omit it or set `false` for normal operation.

| Variable | Required | Purpose |
|---|---|---|
| `APP_ENV` | when `NODE_ENV=production` | `local` \| `preview` \| `production`; outside `local` every variable marked "outside local" must be set |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | outside local | Supabase API URL and publishable key |
| `SUPABASE_SECRET_KEY` | outside local | Server-only service-role key; lets Auth rate-limit magic links per end-user IP, deletes host accounts, and reads and writes cover photos. Unset locally, account deletion and cover photos are unavailable; the local value is the `sb_secret_` key printed by `bunx supabase@2.121.0 status` |
| `APP_DB_URL` | outside local | `app_runtime` Postgres URL; must use `sslmode=verify-full` and `sslrootcert` outside local |
| `SMTP_URL`, `SMTP_FROM` | outside local | Reviewed SMTP provider and sender for Auth and host alerts; TLS required outside local |
| `APP_ORIGIN` | outside local | Public origin, used for same-origin checks and links |
| `SHARE_HMAC_KEY` | outside local | At least 32 characters; keys guest link hashes and rate-limit windows |
| `GUEST_ACCESS_DISABLED` | no | Operator kill switch (below) |
| `AGENT_ACCESS_DISABLED` | no | Agent kill switch: `true` denies every token at `/mcp`, turns off the OAuth endpoints (`/oauth/*` and the `/.well-known` metadata) and hides the settings tokens section; defaults to `true` outside `local` |
| `MFA_REQUIRED` | no | `true` forces every host to enroll TOTP; default lets hosts opt in from `/host/settings` |
| `GOOGLE_TRANSLATE_SERVICE_ACCOUNT` | no | Enables guide translation egress; unset means nothing is sent |

### Guest kill switch

`GUEST_ACCESS_DISABLED=true` is the operator kill switch. It denies old and new guest sessions at every guest entry point — link exchange, Home/Guide/Help reads, the cover photo, and message intake — with the existing generic denial. It does not disable the host workspace, and it is deliberately not a substitute for link revocation. Each property has one long-lived property link plus optional per-stay links ([ADR 0004](docs/adr/0004-per-stay-guest-links.md)): rotating or disabling the property link revokes it and deletes its sessions; revoking a stay link does the same for that stay only, and a stay link expires on its own at noon the day after check-out in the property's timezone, with guest sessions clamped to that expiry. Both kinds pass the same kill-switch gates. A malformed value fails server startup rather than silently leaving guest access enabled. Apply it by changing the server environment and restarting/redeploying the app; verify `GET /g/<id>` and a message POST return the generic denial before treating the switch as active.

### Host alerts

Each property stores an `alert_email` snapshot of the host's sign-in address when created or copied. If the Auth email changes, the host updates it in the property editor with **Use my current sign-in address**. New guest messages send one fixed-content alert through the reviewed SMTP path; the message body, category, property name, and reply address are never included. A send failure is logged as `mail_send_failed`; the stored inbox item remains the source of truth. Locally, Mailpit at `http://127.0.0.1:54324` is the alert sink. Real SMTP acceptance and provider monitoring remain deployment gates.

### Cover photos

Each property can have one cover photo ([ADR 0005](docs/adr/0005-property-hero-image.md)), stored in the private Supabase Storage bucket `guide-images` (1 MiB, `image/jpeg` only, no object policies). The browser re-encodes the upload to JPEG (long edge 1600 px), which drops Exif/GPS; the server rejects anything that is not a complete JPEG or that still carries Exif/XMP/IPTC. Only the server touches the bucket, with `SUPABASE_SECRET_KEY`, after reading the photo's row under the owner or a live guest session; guest and owner responses are `private, no-store`, so the kill switch, link rotation, stay revocation, and stay expiry apply on the next view. Replacing or removing a photo, deleting a property, and deleting an account queue the old object paths in `app.storage_deletions` from a database trigger; the app drains the queue after each of those commits, best effort. An upload first reserves its new path in the same queue, not due for 10 minutes; the row write claims it in its own transaction, so bytes from a failed or abandoned upload are drained once due. The drain deletes due rows and removes their objects in one transaction, so it and a claim on the same path serialize on the row lock; a claim refuses a reservation that is already due. Drain anything left over, and always after a restore, with `bun run storage:drain` (needs `SUPABASE_SECRET_KEY` and `APP_DB_URL`; exits non-zero while due paths stay queued).

### Agent access

A host can connect their own AI agent to `https://<host>/mcp`. The design and its limits are in [ADR 0006](docs/adr/0006-agent-access.md). Agents never see guest message bodies, link secrets, property credentials or the alert email. They cannot delete properties, sections or reservations, or change the account; the only removal they can make is revoking a stay link.

- **Claude Code:** in **Settings → Agent access**, create a personal token, then run:
  ```
  claude mcp add --transport http staywise https://<host>/mcp --header "Authorization: Bearer sw_pat_…"
  ```
- **Cursor:** add `{"mcpServers": {"staywise": {"url": "https://<host>/mcp", "headers": {"Authorization": "Bearer ${env:STAYWISE_TOKEN}"}}}}` to `.cursor/mcp.json`.
- **VS Code:** in `.vscode/mcp.json`, add a server with `"type": "http"`, the same `url`, and `"headers": {"Authorization": "Bearer ${input:staywise-token}"}`, backed by a `promptString` input with `"password": true`.
- **claude.ai and ChatGPT** (developer mode): add a custom connector with the URL `https://<host>/mcp` and no token. The app signs in through OAuth, and the host approves the scopes and an optional property on the Staywise consent page. Only client IDs under `https://claude.ai/` and `https://chatgpt.com/` are accepted, and the deploy must be public HTTPS.
- **Revoking:** both kinds are listed under **Settings → Agent access** and revoked there. Revoke all also covers both kinds, and so does removing TOTP or deleting the account. A new consent from the same app replaces that app's earlier grant.

`AGENT_ACCESS_DISABLED=true` is the agent kill switch. It defaults to `true` outside `local`, and it covers `/mcp`, `/oauth/*` and the `/.well-known` metadata. Apply it by changing the environment and redeploying. To verify it took effect, check that `POST /mcp` with a valid token is denied and `/.well-known/oauth-authorization-server` returns 404.

### Privacy and data handling

The local app serves a synthetic-data notice at `/privacy`, linked from the home page, sign-in, host workspace, and guest Help. It describes stored fields, 90-day message/audit/setup retention with earlier host deletion, the property-deletion cascade, cover photos, the bearer-link capability, log/counter minimization, conditional translation egress, and immediate host account deletion from `/host/settings` (ADR 0002) with what it does not erase. The guest Help page also shows a localized summary in English, German, Slovenian, French, or Spanish. This is implemented local behavior, not a completed legal policy: a named controller/contact, processor/DPA and transfer review, production regions, and real-data approval remain unexecuted external gates.

### Pilot measurement

The raw, privacy-bounded pilot tables are `app.setup_events` (host funnel, 90-day retention), `app.guest_counters` (per-property UTC-day aggregate opens/exchanges/submissions, 400-day retention; the `/host` dashboard shows the last 30 days), and `app.guest_messages` (question/report volume and handled timestamps). Run these as an owner-privileged role; no guest identifiers exist in the counters:

```sql
-- Per-step setup timing, by host and property. The step separates blank and copy creation.
select owner_id, event_type, step, property_id,
       min(created_at) as first_at, count(*) as events
from app.setup_events
group by owner_id, event_type, step, property_id
order by owner_id, first_at;

-- Host setup time: first sign-in to first publish.
select owner_id,
       min(created_at) filter (where event_type = 'sign_in') as first_sign_in,
       min(created_at) filter (where event_type = 'publish_clicked') as first_publish,
       min(created_at) filter (where event_type = 'publish_clicked')
         - min(created_at) filter (where event_type = 'sign_in') as sign_in_to_first_publish
from app.setup_events
group by owner_id
order by owner_id;

-- Second-property time: first copy-created property per host to its first following publish.
with copied as (
  select owner_id, property_id, min(created_at) as copied_at
  from app.setup_events
  where event_type = 'property_created'
    and step = 'copy'
    and property_id is not null
  group by owner_id, property_id
),
first_copy as (
  select distinct on (owner_id) owner_id, property_id, copied_at
  from copied
  order by owner_id, copied_at, property_id
)
select c.owner_id, c.property_id, c.copied_at,
       min(p.created_at) as published_at,
       min(p.created_at) - c.copied_at as copy_to_publish
from first_copy c
left join app.setup_events p
  on p.owner_id = c.owner_id
 and p.property_id = c.property_id
 and p.event_type = 'publish_clicked'
 and p.created_at >= c.copied_at
group by c.owner_id, c.property_id, c.copied_at
order by c.owner_id, c.copied_at;

-- Exportable per-property usage; counters have no guest identity or content.
select property_id, sum(link_exchanges) as exchanges, sum(guide_opens) as opens, sum(submissions) as submissions
from app.guest_counters group by property_id order by property_id;

-- Inbox volume, "already in the guide" share, and handled latency.
select property_id, count(*) as messages,
       count(*) filter (where answer_in_guide) as answered_in_guide,
       avg(handled_at - created_at) filter (where handled_at is not null) as avg_handled_latency
from app.guest_messages group by property_id order by property_id;

-- Revocation/deletion audit volume. Audit rows store actor, action, and time, not property IDs.
select actor_id, action, count(*) as events, min(created_at) as first_at, max(created_at) as last_at
from app.audit_events
where action in ('delete', 'link_disabled', 'link_rotated')
group by actor_id, action
order by actor_id, action;
```

Setup time is the interval between a host's first `sign_in` and first `publish_clicked`; second-property time is the first `property_created` row with `step = 'copy'` for that host to the property's following `publish_clicked`. `step` and `property_id` therefore stay in the grouping: blank and copy creation are different events, and a host can have more than one property. Audit rows do not carry a property ID, so the revocation/deletion query reports counts by host and action, not a property-level deletion report. These are readiness measurements, not a dashboard or a claim that the five-host pilot has run; price validation starts only after actual use.

### Retention cleanup

`supabase/migrations/20261018000000_initial_schema.sql` defines `app.retention_cleanup()` and, when the migration runs in the database named by `cron.database_name` (default `postgres`), creates `pg_cron` and schedules the job `staywise-retention-cleanup` at 03:17 UTC. Only `scratch_`-prefixed databases (migration or restore scratch databases) skip the schedule; any other database fails the migration. Run it by hand with an owner-privileged connection — `app_runtime` deliberately cannot execute it:

```sh
psql "postgresql://<owner role>:<password>@<host>:5432/postgres" -c "select app.retention_cleanup();"
```

Production must either enable `pg_cron` in the Supabase project (the guarded migration block then creates the job) or run that statement nightly as the database owner. Provider backup/PITR retention is separate from these windows and must be confirmed in the provider console before real data; after any restore, run the overdue cleanup and `bun run storage:drain` before reopening guest traffic. The same cleanup covers `app.guest_counters`: UTC-day rows older than 400 days are deleted, and the rest cascade on property deletion. Agent access tables (`app.agent_grants`, `app.agent_grant_tokens`, `app.guide_section_revisions`) back `/mcp` and the OAuth endpoints: the cleanup deletes grants 90 days after revoke or expiry, token digests at expiry, and revisions after 90 days; property-bound rows cascade with the property and owner-level rows with account deletion. OAuth refresh tokens rotate strictly: replaying a spent one, including a client retry after a timed-out token response, revokes the whole grant and the host reconnects the app. Details and rehearsal evidence: `plans/implementation_plan.md`, Phase 7a progress.

`app.auth_rate_limits` holds HMAC-keyed magic-link windows (5 per client IP and 3 per address per 15 minutes, IP read from Netlify's `x-nf-client-connection-ip`) and is purged in the same cleanup.

## Documentation

Product, implementation, and research plans live in `plans/` (local only, not in git). Terms with a project-specific meaning are in [CONTEXT.md](CONTEXT.md); durable architecture decisions go in [docs/adr/](docs/adr/). Agent instructions: [AGENTS.md](AGENTS.md).

## License

Proprietary. Copyright (c) 2026 nejcm. All rights reserved; see [LICENSE](LICENSE).
