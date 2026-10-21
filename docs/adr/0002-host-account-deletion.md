# 0002: Host account deletion through the Supabase Admin API

**Status:** accepted, 2026-10-21

## Context

Hosts need to delete their own account from `/host/settings` (`src/routes/host_.settings.tsx`). Runtime DB access is `app_runtime` (`nobypassrls`, no rights on `auth`), so it cannot delete `auth.users`, and widening it is ruled out. Every owner table already hangs off `auth.users`: `properties`, `api_tokens`, and `setup_events` cascade; everything property-scoped (sections, translations, share links, guest sessions, guest messages, reservations, counters, credentials, property tokens) cascades from `properties`; `audit_events.actor_id` is `on delete set null`. Deleting the `auth.users` row therefore removes all app data in one transaction.

## Decision

- **Path:** a server function calls `auth.admin.deleteUser(id)` with `SUPABASE_SECRET_KEY`. No security-definer function and no grant on the `auth` schema; `app_runtime` is unchanged. `SUPABASE_SECRET_KEY` becomes required outside `APP_ENV=local`; locally, when unset, the settings page shows deletion as unavailable.
- **Immediate, no grace period.** No pending state, scheduled purge, or undo.
- **Confirmation:** an inline form in the Delete account section where the host types their account email to enable the button. If a TOTP factor is verified, a fresh code is also required and verified server-side in the same request; an existing AAL2 session alone is not enough. No email confirmation loop.
- **Order:** same-origin check and `aal2Session` → typed email matches `getUser()` → fresh TOTP if enrolled → `deleteUser` → `recordAudit(null, 'account_deleted')` (failure is logged, never reported as a failed deletion) → clear auth cookies → redirect to sign-in with an "Account deleted" notice. "User not found" from `deleteUser` counts as success (double submit); the button is disabled while in flight.
- **Audit:** one `account_deleted` row with a null actor; earlier rows lose their actor via `set null`. All expire with the 90-day window. A migration adds `account_deleted` to the action check.
- **Guests:** links and sessions die with the cascade and guests get the existing generic denial. Unread messages are deleted without export; the dialog says so.
- **Setup events** cascade; the host leaves the pilot setup-time measurements.
- **No confirmation email** after deletion.

## Consequences

- Retained outside `app.*` and documented, not scrubbed: Supabase Auth's `auth.audit_log_entries` (payloads carry the email and there is no FK to `auth.users`; verified on the local stack), SMTP delivery logs, and provider backups/PITR. Their retention must be confirmed in the provider console before real data.
- The secret key is service-role. It stays server-only and is used only for the magic-link IP forward and this call.
- The audit insert is not atomic with the delete; a lost `account_deleted` row is acceptable because the data deletion itself is atomic inside Auth.
- Verification: an integration test (`test:local`) seeds a synthetic host across every owner/property table, deletes, and asserts zero remaining rows, nulled audit actors, one `account_deleted` row, and a failing `getUser`. Unit tests cover the guards (wrong email, missing/wrong TOTP, AAL1, missing key). A pgTAP test in CI asserts every FK to `auth.users` is `cascade` or `set null`, so new owner tables (e.g. `app.host_settings`) cannot silently survive deletion.
- The `/privacy` notice drops "No account-deletion screen" and describes immediate deletion, the null-actor audit row, and the retained items above; README (privacy paragraph, env table) changes in the same PR.
