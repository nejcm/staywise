# TODO

## Code review follow-up (2026-10-20)

### Before release (manual)

- [ ] Change every deployed `SMTP_URL` to `smtps://…` or `smtp://…?requireTLS=true`; the app refuses to boot otherwise outside `APP_ENV=local`.
- [ ] Apply migration `20261019170000_phase7d_auth_limits.sql` to the hosted DB and check its output for the unscheduled-retention-job warning.
- [ ] Push `10ca290`, `b8d8689`, `f90a2e6`.
- [ ] Native-speaker review of the `de` and `sl` strings for `form.bodyInvalid`.

### Deployment checks (manual)

- [ ] Confirm Netlify overwrites `x-nf-client-connection-ip` so a client cannot spoof it; the per-IP magic-link limit trusts it.
- [ ] Confirm `pg_cron` job `staywise-retention-cleanup` is scheduled on the hosted DB.
- [ ] Confirm HSTS is sent on the Netlify site.
- [ ] Confirm whether the hosted `postgres` role has `BYPASSRLS` (the phase 6 backfill depends on it).

### Known limits / open decisions

- [ ] Supabase Auth applies its per-IP limits to the server's IP, so all hosts share one bucket; a distributed attacker can still drain it. Fix: enable `Sb-Forwarded-For` support.
- [ ] Decide whether to throttle new-message alert emails (product change; a test currently asserts one alert per message).
- [ ] Editor loader runs its auth checks sequentially; parallelising risks the near-expiry concurrent refresh issue.
- [ ] Unsaved locale selections are lost when the translation block remounts (low impact).
- [ ] Re-review the three fix commits; they were tested but not reviewed afterwards.
