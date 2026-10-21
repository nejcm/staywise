# Agent instructions

Staywise: guest portal for independent vacation-rental owners. TanStack Start (React 19, SSR, server functions), CSS Modules, Bun, Supabase (Postgres with RLS, Auth magic link + TOTP, pg_cron), Netlify. Node 24+, Bun pinned in `package.json`.

## Start here

- Read [README.md](README.md) (setup, env table, retention, kill switch) and [CONTEXT.md](CONTEXT.md) before changing domain behavior.
- `plans/` (local, gitignored) holds the product and implementation plans; `docs/adr/` holds durable decisions.
- Layout: `src/features/<area>` (server code in `*.server.ts`, server functions in `*-fns.ts`), `src/routes` (file routes), `src/lib` (env, db, mail, logging), `supabase/migrations` and `supabase/tests` (pgTAP), `e2e/` (Playwright).
- Generated: `src/routeTree.gen.ts` (from `bun run routes:generate`). Do not edit by hand.

## Constraints

- Privacy-by-default: never log or echo guest message bodies, reply addresses, or link secrets; counters stay free of guest identity. Translation egress is off unless configured.
- Guest access is a bearer link in the URL fragment; every guest entry point honors `GUEST_ACCESS_DISABLED`.
- Runtime DB access goes through the `app_runtime` role under RLS. Never widen it to bypass a policy.
- Keep runtime dependencies small; justify new ones against a platform or existing option.
- Follow the existing package manager, formatter, linter, and test runner. Do not migrate them as incidental cleanup.
- Never commit secrets, local env files, generated credentials, or real user data. Use synthetic data only.
- Oxlint rules turned off in `.oxlintrc.json` are deliberate (JSX runtime, hydration effects, CSS side-effect imports, noisy test style rules); re-enable rather than add suppressions.
- `bun run audit` ignores GHSA-vfj7-8cjw-p6xm (braces) and GHSA-86w9-cpqp-85rv (node-forge): dev-only transitive deps of the Netlify Vite plugin with no published fix. Drop the flags once one exists.

## Commands

| Purpose | Command |
| --- | --- |
| Install | `bun install --frozen-lockfile` |
| Format | `bun run format` |
| Format check | `bun run format:check` |
| Lint | `bun run lint` |
| Typecheck | `bun run typecheck` |
| Test | `bun run test` (integration suites skip without the local stack) |
| Coverage | `bun run test:coverage` |
| Integration | `bun run db:start`, dev server, `bun run test:local` (not run in CI; CI runs pgTAP only) |
| Dev seed data | `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/test_seed.sql` (synthetic, idempotent) |
| Database tests | `bun run db:test` (needs the local stack) |
| E2E | `bun run test:e2e` |
| Unused code | `bun run knip` |
| Audit | `bun run audit` |
| Verify | `bun run verify` |

Enable the commit template once per clone: `git config --local commit.template .gitmessage`.

## Change workflow

- Trace the relevant code path and callers before editing shared behavior.
- Add or update tests for behavior changes and keep docs accurate.
- Run the narrowest relevant checks, then `bun run verify` when practical.
- Do not weaken checks to make a change pass; explain intentional exceptions beside the config and here.
- Do not run deployment, release, `db:reset`, or other destructive commands as a test.
