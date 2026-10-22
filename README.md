<div align="center">

<img src="public/favicon.svg" alt="" width="64" height="64">

# Staywise

**A guest portal for independent vacation-rental owners.**<br>
A mobile guide served by link or QR, and one inbox for guest questions and issue reports.<br>
No app, no guest account, no booking-system integration.

<sub>TanStack Start · React 19 · Supabase · Bun · Netlify</sub>

</div>

> [!NOTE]
> Pilot stage, synthetic data only. "Staywise" is a provisional name (existing hospitality products use it).

## What it does

- **Guest guide.** Essentials, call actions, address and maps, answering hours and a privacy panel, in English, German, Slovenian, French and Spanish. Five preset themes ([ADR 0003](docs/adr/0003-guest-themes-are-presets.md)).
- **Bearer-link access.** The secret lives in the URL fragment. One property link plus per-stay links that expire after check-out ([ADR 0004](docs/adr/0004-per-stay-guest-links.md)). An operator kill switch denies all guest access.
- **Host workspace.** In-app Host guide (`/host/help`) and inline tips, property list, guide editor with phone and tablet preview, link and QR sharing, cover photo ([ADR 0005](docs/adr/0005-property-hero-image.md)), inbox with one alert per message ([ADR 0001](docs/adr/0001-one-alert-per-message.md)).
- **Sign-in and security.** Magic link with optional TOTP, device-labelled security activity, immediate account deletion ([ADR 0002](docs/adr/0002-host-account-deletion.md)).
- **Agent access.** Hosts can connect their own AI agent over MCP with scoped tokens or OAuth ([ADR 0006](docs/adr/0006-agent-access.md)).
- **Privacy by default.** No message bodies, reply addresses or link secrets in logs; translation egress off unless configured; 90-day retention for messages and audit rows.

External gates still open: deployment, real SMTP, provider backup/PITR, hosted Auth session policy, Netlify overwriting a client-sent `x-nf-geo`, physical-device checks, the legal privacy policy, and the five-host pilot.

## Quick start

Prerequisites: Bun (pinned in `package.json`), Docker (local Supabase), Node.js 24+.

```sh
bun install --frozen-lockfile
cp .env.example .env.local     # never commit real values
bun run db:start               # local Supabase stack (Docker)
bun run dev                    # http://localhost:3000
```

Optional synthetic data (idempotent, not loaded by `db:reset`):

```sh
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/test_seed.sql
```

It creates three hosts (`maria-host@example.test`, `tomaz-host@example.test`, `jana-host@example.test`; sign in through Mailpit at `http://127.0.0.1:54324`), four properties and guest links (`/g/<id>#<secret>`, listed in the file header). The Bled lakeside apartment is fully filled in.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run verify` | typecheck, lint, format check, tests, unused-code check |
| `bun run test:coverage` | unit tests with coverage thresholds |
| `bun run test:local` | integration suites (needs `db:start` and the dev server) |
| `bun run db:test` | pgTAP database tests |
| `bun run test:e2e` | Playwright + axe on public pages (builds, serves on :3100) |
| `bun run db:reset` | apply `supabase/migrations` to a clean local database |
| `bun run storage:drain` | delete queued cover-photo objects |

## Configuration

`APP_ENV` defaults to `local` and must be set explicitly (`preview` or `production`) when `NODE_ENV=production` or on a Netlify runtime (`SITE_ID` set without `NETLIFY_DEV`). Outside `local`, every variable marked "outside local" must be set.

| Variable | Required | Purpose |
|---|---|---|
| `APP_ENV` | when `NODE_ENV=production` or on Netlify | `local` \| `preview` \| `production`; outside `local` every variable marked "outside local" must be set |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | outside local | Supabase API URL and publishable key |
| `SUPABASE_SECRET_KEY` | outside local | Server-only service-role key; lets Auth rate-limit magic links per end-user IP, deletes host accounts, and reads and writes cover photos. Unset locally, account deletion and cover photos are unavailable; the local value is the `sb_secret_` key printed by `bunx supabase@2.121.0 status` |
| `APP_DB_URL` | outside local | `app_runtime` Postgres URL; must use `sslmode=verify-full` and `sslrootcert` outside local |
| `SMTP_URL`, `SMTP_FROM` | outside local | Reviewed SMTP provider and sender for Auth and host alerts; TLS required outside local |
| `APP_ORIGIN` | outside local | Public origin, used for same-origin checks and links |
| `SHARE_HMAC_KEY` | outside local | At least 32 characters; keys guest link hashes and rate-limit windows |
| `GUEST_ACCESS_DISABLED` | no | Operator kill switch ([operations](docs/operations.md#guest-kill-switch)) |
| `AGENT_ACCESS_DISABLED` | no | Agent kill switch: `true` denies every token at `/mcp`, turns off the OAuth endpoints (`/oauth/*` and the `/.well-known` metadata) and hides the settings tokens section; defaults to `true` outside `local` |
| `MFA_REQUIRED` | no | `true` forces every host to enroll TOTP; default lets hosts opt in from `/host/settings` |
| `GOOGLE_TRANSLATE_SERVICE_ACCOUNT` | no | Enables guide translation egress; unset means nothing is sent |

## Documentation

| | |
| --- | --- |
| [docs/operations.md](docs/operations.md) | Kill switches, host alerts, cover photos, agent access, privacy, retention cleanup |
| [docs/pilot-measurement.md](docs/pilot-measurement.md) | Privacy-bounded pilot queries |
| [docs/adr/](docs/adr/README.md) | Architecture decisions |
| [CONTEXT.md](CONTEXT.md) | Project glossary and boundaries |
| [AGENTS.md](AGENTS.md) | Instructions for coding agents |

Product, implementation and research plans live in `plans/` (local only, not in git).

## License

Proprietary. Copyright (c) 2026 nejcm. All rights reserved; see [LICENSE](LICENSE).
