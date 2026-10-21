# TODO

- customer page customization (colors, fonts, styles...)
- ui animations
- make UI more rich
  - wifi qr code
  - property images, other images...
- add more languages (fr, es)

## Code review follow-up (2026-10-20)

### Before release (manual)

- [ ] Change every deployed `SMTP_URL` to `smtps://…` or `smtp://…?requireTLS=true`; the app refuses to boot otherwise outside `APP_ENV=local`.
- [ ] Apply migration `20261019170000_phase7d_auth_limits.sql` to the hosted DB and check its output for the unscheduled-retention-job warning.

### Deployment checks (manual)

- [ ] Confirm Netlify overwrites `x-nf-client-connection-ip` so a client cannot spoof it; the per-IP magic-link limit trusts it.
- [ ] Confirm `pg_cron` job `staywise-retention-cleanup` is scheduled on the hosted DB.
- [ ] Confirm HSTS is sent on the Netlify site.
- [ ] Turn on Auth > Rate Limits > IP Address Forwarding and set `SUPABASE_SECRET_KEY` (an `sb_secret_` key), so Auth rate-limits magic links per host IP instead of the server's IP.
- [ ] Decide `MFA_REQUIRED` for production: unset lets each host opt in to an authenticator; `true` forces it for everyone.
- [ ] Confirm whether the hosted `postgres` role has `BYPASSRLS` (the phase 6 backfill depends on it).
