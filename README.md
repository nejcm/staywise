# Staywise

Guest portal for independent vacation-rental owners (1–10 properties): a mobile guest guide served by link/QR, plus one host inbox for guest questions and issue reports. No app, no guest account, no booking-system integration at launch.

**Status:** the local pilot feature set is implemented through implementation plan Phase 7c, plus the guest features plan (phases 1–8: essentials, call actions, address/maps, answering hours, privacy panel, loading states), with synthetic-data verification: host onboarding and guide authoring, link/QR sharing, the guest guide in English/German/Slovenian, inbox and alerts, retention cleanup, and security/accessibility hardening. Deployment, real SMTP, provider backup/PITR, hosted Auth session policy, physical-device checks, and the five-host pilot remain external gates.

**Name:** "Staywise" is provisional; existing hospitality products use it (see the product plan).

## Stack

TanStack Start (React 19, SSR, server functions) with CSS Modules, Bun, Supabase (Postgres with RLS, Auth with magic link + TOTP, pg_cron), Netlify. Tests: Vitest unit and local-stack integration suites, pgTAP for the database.

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
| `SUPABASE_SECRET_KEY` | no | Server-only; lets Auth rate-limit magic links per end-user IP |
| `APP_DB_URL` | outside local | `app_runtime` Postgres URL; must use `sslmode=verify-full` and `sslrootcert` outside local |
| `SMTP_URL`, `SMTP_FROM` | outside local | Reviewed SMTP provider and sender for Auth and host alerts; TLS required outside local |
| `APP_ORIGIN` | outside local | Public origin, used for same-origin checks and links |
| `SHARE_HMAC_KEY` | outside local | At least 32 characters; keys guest link hashes and rate-limit windows |
| `GUEST_ACCESS_DISABLED` | no | Operator kill switch (below) |
| `MFA_REQUIRED` | no | `true` forces every host to enroll TOTP; default lets hosts opt in |
| `GOOGLE_TRANSLATE_SERVICE_ACCOUNT` | no | Enables guide translation egress; unset means nothing is sent |

### Guest kill switch

`GUEST_ACCESS_DISABLED=true` is the operator kill switch. It denies old and new guest sessions at every guest entry point — link exchange, Home/Guide/Help reads, and message intake — with the existing generic denial. It does not disable the host workspace, and it is deliberately not a substitute for link rotation: rotating or disabling a link remains the per-property revocation path and deletes that link's sessions. A malformed value fails server startup rather than silently leaving guest access enabled. Apply it by changing the server environment and restarting/redeploying the app; verify `GET /g/<id>` and a message POST return the generic denial before treating the switch as active.

### Host alerts

Each property stores an `alert_email` snapshot of the host's sign-in address when created or copied. If the Auth email changes, the host updates it in the property editor with **Use my current sign-in address**. New guest messages send one fixed-content alert through the reviewed SMTP path; the message body, category, property name, and reply address are never included. A send failure is logged as `mail_send_failed`; the stored inbox item remains the source of truth. Locally, Mailpit at `http://127.0.0.1:54324` is the alert sink. Real SMTP acceptance and provider monitoring remain deployment gates.

### Privacy and data handling

The local app serves a synthetic-data notice at `/privacy`, linked from the home page, sign-in, host workspace, and guest Help. It describes stored fields, 90-day message/audit/setup retention with earlier host deletion, the property-deletion cascade, the bearer-link capability, log/counter minimization, conditional translation egress, and the missing host account-deletion screen. The guest Help page also shows a localized summary in English, German, or Slovenian. This is implemented local behavior, not a completed legal policy: a named controller/contact, processor/DPA and transfer review, production regions, and real-data approval remain unexecuted external gates.

### Pilot measurement

The raw, privacy-bounded pilot tables are `app.setup_events` (host funnel, 90-day retention), `app.guest_counters` (per-property UTC-day aggregate opens/exchanges/submissions), and `app.guest_messages` (question/report volume and handled timestamps). Run these as an owner-privileged role; no guest identifiers exist in the counters:

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

`supabase/migrations/20261019150000_phase7a_retention.sql` adds `app.retention_cleanup()` and, when the migration runs in the database named by `cron.database_name` and `pg_cron` is available and preloaded, schedules the job `staywise-retention-cleanup` at 03:17 UTC. Other databases (migration or restore scratch databases) skip the schedule. Run it by hand with an owner-privileged connection — `app_runtime` deliberately cannot execute it:

```sh
psql "postgresql://<owner role>:<password>@<host>:5432/postgres" -c "select app.retention_cleanup();"
```

Production must either enable `pg_cron` in the Supabase project (the guarded migration block then creates the job) or run that statement nightly as the database owner. Provider backup/PITR retention is separate from these windows and must be confirmed in the provider console before real data; after any restore, run the overdue cleanup before reopening guest traffic. `app.guest_counters` has no age-based window: it remains while the property exists and cascades on property deletion. API-token tables are schema-only in this tree; property-bound rows cascade with the property, owner-level rows remain until account deletion, and there is no token-management UI. Details and rehearsal evidence: `plans/implementation_plan.md`, Phase 7a progress.

`supabase/migrations/20261019170000_phase7d_auth_limits.sql` adds `app.auth_rate_limits` (HMAC-keyed magic-link windows: 5 per client IP and 3 per address per 15 minutes, IP read from Netlify's `x-nf-client-connection-ip`), purges it in the same cleanup, and raises a migration warning when the retention job is not scheduled in that database.

## Documentation

Product, implementation, and research plans live in `plans/` (local only, not in git). Terms with a project-specific meaning are in [CONTEXT.md](CONTEXT.md); durable architecture decisions go in [docs/adr/](docs/adr/). Agent instructions: [AGENTS.md](AGENTS.md).

## License

Proprietary. Copyright (c) 2026 nejcm. All rights reserved; see [LICENSE](LICENSE).
