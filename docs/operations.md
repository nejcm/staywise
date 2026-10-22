# Operations

Runbook for deploying and operating Staywise. Setup and the environment table are in the [README](../README.md).

## Host settings and security activity

`/host/settings` holds account settings: two-step sign-in (set up or remove the authenticator), security activity (the 20 most recent sign-ins, two-step verifications and changes, and agent access grants and revocations from the 90-day audit log; agent tool calls are not listed). Email-link sign-ins (`sign_in`) and authenticator-code sign-ins (`mfa_verified`) carry a device label parsed from the User-Agent ("Firefox on Linux"), the country and city from Netlify's `x-nf-geo` header, and a new-device flag for a device and country not seen for that host in the last 90 days. The geo header is read only on a deployed Netlify runtime (`SITE_ID` set, `APP_ENV` not `local`, no `NETLIFY_DEV`); elsewhere place stays empty. Deployment gate: confirm on a deploy that Netlify replaces a client-sent `x-nf-geo` before relying on the place; the raw User-Agent and the IP address are never stored, and account deletion clears the context with the actor, sign out, and the defaults for new properties (theme, guide and guest languages, time zone, check-in/out times, contact phone, answering hours). Defaults are copied into a property when it is created and never applied to existing properties; a copy keeps the values of its source property. Until a host saves, built-in defaults apply (`staywise` theme, English, `UTC`); the form only suggests the browser's time zone.

## Guest kill switch

`GUEST_ACCESS_DISABLED=true` is the operator kill switch. It denies old and new guest sessions at every guest entry point — link exchange, Home/Guide/Help reads, the cover photo, and message intake — with the existing generic denial. It does not disable the host workspace, and it is deliberately not a substitute for link revocation. Each property has one long-lived property link plus optional per-stay links ([ADR 0004](adr/0004-per-stay-guest-links.md)): rotating or disabling the property link revokes it and deletes its sessions; revoking a stay link does the same for that stay only, and a stay link expires on its own at noon the day after check-out in the property's timezone, with guest sessions clamped to that expiry. Both kinds pass the same kill-switch gates. A malformed value fails server startup rather than silently leaving guest access enabled. Apply it by changing the server environment and restarting/redeploying the app; verify `GET /g/<id>` and a message POST return the generic denial before treating the switch as active.

## Host alerts

Each property stores an `alert_email` snapshot of the host's sign-in address when created or copied. If the Auth email changes, the host updates it in the property editor with **Use my current sign-in address**. New guest messages send one fixed-content alert through the reviewed SMTP path; the message body, category, property name, and reply address are never included. A send failure is logged as `mail_send_failed`; the stored inbox item remains the source of truth. Locally, Mailpit at `http://127.0.0.1:54324` is the alert sink. Real SMTP acceptance and provider monitoring remain deployment gates.

## Cover photos

Each property can have one cover photo ([ADR 0005](adr/0005-property-hero-image.md)), stored in the private Supabase Storage bucket `guide-images` (1 MiB, `image/jpeg` only, no object policies). The browser re-encodes the upload to JPEG (long edge 1600 px), which drops Exif/GPS; the server rejects anything that is not a complete JPEG or that still carries Exif/XMP/IPTC. Only the server touches the bucket, with `SUPABASE_SECRET_KEY`, after reading the photo's row under the owner or a live guest session; guest and owner responses are `private, no-store`, so the kill switch, link rotation, stay revocation, and stay expiry apply on the next view. Replacing or removing a photo, deleting a property, and deleting an account queue the old object paths in `app.storage_deletions` from a database trigger; the app drains the queue after each of those commits, best effort. An upload first reserves its new path in the same queue, not due for 10 minutes; the row write claims it in its own transaction, so bytes from a failed or abandoned upload are drained once due. The drain deletes due rows and removes their objects in one transaction, so it and a claim on the same path serialize on the row lock; a claim refuses a reservation that is already due. Drain anything left over, and always after a restore, with `bun run storage:drain` (needs `SUPABASE_SECRET_KEY` and `APP_DB_URL`; exits non-zero while due paths stay queued).

## Agent access

A host can connect their own AI agent to `https://<host>/mcp`. The design and its limits are in [ADR 0006](adr/0006-agent-access.md). Agents never see guest message bodies, link secrets, property credentials or the alert email. They cannot delete properties, sections or reservations, or change the account; the only removal they can make is revoking a stay link.

- **Claude Code:** in **Settings → Agent access**, create a personal token, then run:
  ```
  claude mcp add --transport http staywise https://<host>/mcp --header "Authorization: Bearer sw_pat_…"
  ```
- **Cursor:** add `{"mcpServers": {"staywise": {"url": "https://<host>/mcp", "headers": {"Authorization": "Bearer ${env:STAYWISE_TOKEN}"}}}}` to `.cursor/mcp.json`.
- **VS Code:** in `.vscode/mcp.json`, add a server with `"type": "http"`, the same `url`, and `"headers": {"Authorization": "Bearer ${input:staywise-token}"}`, backed by a `promptString` input with `"password": true`.
- **claude.ai and ChatGPT** (developer mode): add a custom connector with the URL `https://<host>/mcp` and no token. The app signs in through OAuth, and the host approves the scopes and an optional property on the Staywise consent page. Only client IDs under `https://claude.ai/` and `https://chatgpt.com/`, without a query string, are accepted, and the deploy must be public HTTPS. Exact client ID pinning is pending the vendors' published client metadata URLs ([ADR 0006](adr/0006-agent-access.md)).
- **Revoking:** both kinds are listed under **Settings → Agent access** and revoked there. Revoke all also covers both kinds, and so does removing TOTP or deleting the account. A new consent from the same app replaces that app's earlier grant.

`AGENT_ACCESS_DISABLED=true` is the agent kill switch. It defaults to `true` outside `local`, and it covers `/mcp`, `/oauth/*` and the `/.well-known` metadata. Apply it by changing the environment and redeploying. To verify it took effect, check that `POST /mcp` with a valid token is denied and `/.well-known/oauth-authorization-server` returns 404.

## Privacy and data handling

The local app serves a synthetic-data notice at `/privacy`, linked from the home page, sign-in, host workspace, and guest Help. It describes stored fields, the sign-in device and place kept on audit rows (no IP or raw User-Agent), 90-day message/audit/setup retention with earlier host deletion, the property-deletion cascade, cover photos, the bearer-link capability, log/counter minimization, conditional translation egress, and immediate host account deletion from `/host/settings` (ADR 0002) with what it does not erase. The guest Help page also shows a localized summary in English, German, Slovenian, French, or Spanish. This is implemented local behavior, not a completed legal policy: a named controller/contact, processor/DPA and transfer review, production regions, and real-data approval remain unexecuted external gates.
## Retention cleanup

`supabase/migrations/20261018000000_initial_schema.sql` defines `app.retention_cleanup()` and, when the migration runs in the database named by `cron.database_name` (default `postgres`), creates `pg_cron` and schedules the job `staywise-retention-cleanup` at 03:17 UTC. Only `scratch_`-prefixed databases (migration or restore scratch databases) skip the schedule; any other database fails the migration. Run it by hand with an owner-privileged connection — `app_runtime` deliberately cannot execute it:

```sh
psql "postgresql://<owner role>:<password>@<host>:5432/postgres" -c "select app.retention_cleanup();"
```

Production must either enable `pg_cron` in the Supabase project (the guarded migration block then creates the job) or run that statement nightly as the database owner. Provider backup/PITR retention is separate from these windows and must be confirmed in the provider console before real data; after any restore, run the overdue cleanup and `bun run storage:drain` before reopening guest traffic. The same cleanup covers `app.guest_counters`: UTC-day rows older than 400 days are deleted, and the rest cascade on property deletion. Agent access tables (`app.agent_grants`, `app.agent_grant_tokens`, `app.guide_section_revisions`) back `/mcp` and the OAuth endpoints: the cleanup deletes grants 90 days after revoke or expiry, token digests at expiry, and revisions after 90 days; property-bound rows cascade with the property and owner-level rows with account deletion. OAuth refresh tokens rotate strictly: replaying a spent one, including a client retry after a timed-out token response, revokes the whole grant and the host reconnects the app. Details and rehearsal evidence: `plans/implementation_plan.md`, Phase 7a progress.

`app.auth_rate_limits` holds HMAC-keyed magic-link windows (5 per client IP and 3 per address per 15 minutes, IP read from Netlify's `x-nf-client-connection-ip`) and is purged in the same cleanup.
