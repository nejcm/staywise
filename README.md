# Staywise

Guest portal for independent vacation-rental owners (1–10 properties): a mobile guest guide served by link/QR, plus one host inbox for guest questions and issue reports. No app, no guest account, no booking-system integration at launch.

**Status:** application foundation initialized (implementation plan Phase 1, local parts) — the repository now contains the TanStack Start app skeleton, tooling, and the local Supabase migration workflow; no guest or host features yet.

**Name:** "Staywise" is provisional; existing hospitality products use it (see the product plan).

## Development

Prerequisites: Bun (pinned in `package.json`), Docker (local Supabase), Node.js 24+.

```sh
bun install --frozen-lockfile  # install dependencies
bun run dev                    # dev server on http://localhost:3000
bun run verify                 # typecheck, lint, format check, tests, unused-code check
bun run db:start               # local Supabase stack (Docker)
bun run db:reset               # apply supabase/migrations to a clean local database
```

Environment: copy `.env.example` to `.env.local`; never commit real values. `APP_ENV` defaults to `local` and must be set explicitly (`preview`/`production`) when `NODE_ENV=production`.

### Retention cleanup

`supabase/migrations/20261019150000_phase7a_retention.sql` adds `app.retention_cleanup()` and, when the migration runs in the database named by `cron.database_name` and `pg_cron` is available and preloaded, schedules the job `staywise-retention-cleanup` at 03:17 UTC. Other databases (migration or restore scratch databases) skip the schedule. Run it by hand with an owner-privileged connection — `app_runtime` deliberately cannot execute it:

```sh
psql "postgresql://<owner role>:<password>@<host>:5432/postgres" -c "select app.retention_cleanup();"
```

Production must either enable `pg_cron` in the Supabase project (the guarded migration block then creates the job) or run that statement nightly as the database owner. Provider backup/PITR retention is separate from these windows and must be confirmed in the provider console before real data; after any restore, run the overdue cleanup before reopening guest traffic. Details and rehearsal evidence: `plans/implementation_plan.md`, Phase 7a progress.

## Documentation

| Document | What it covers |
|---|---|
| [docs/smart_guest_portal_plan.md](docs/smart_guest_portal_plan.md) | Product plan: target segment, competitive scan, MVP, pilot plan and decision rule, risks, technical direction |
| [plans/implementation_plan.md](plans/implementation_plan.md) | Implementation plan: architecture, data model, security/privacy, phases 0–8 with acceptance criteria, verification, rollout |
| [docs/decision_log.md](docs/decision_log.md) | All decisions taken (D1–D23, platform decisions, open items), dated |
| [docs/booking_integration_research.md](docs/booking_integration_research.md) | Integration/ingestion research (18 Oct 2026): OTA API gates, PMS/channel-manager APIs, iCal limits, email parsing, competitor ingestion, AI corpus sourcing |
