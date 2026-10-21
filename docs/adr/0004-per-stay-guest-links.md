# 0004: Per-stay guest links

**Status:** accepted, 2026-10-21

## Context

Each property had exactly one enabled bearer link (`share_links_one_enabled_idx`). The only way to cut off a past guest was to rotate it, which also breaks every printed QR card and the link current guests hold. `app.reservations` existed with retention but nothing used it.

## Decision

A share link has a `kind`: `property` (the existing long-lived link, still one enabled per property) or `stay` (one per reservation, created by the host from dates alone):

- A stay link references its reservation through the composite key `(reservation_id, property_id)`, so it cannot point at another property's stay, and it carries `expires_at`. The check `(kind = 'stay') = (reservation_id is not null and expires_at is not null)` keeps the two kinds apart.
- The property-link index is now `where enabled and kind = 'property'`; a second unique index allows one enabled link per reservation.
- Expiry is enforced in `share_links_guest_read`. The policies that recheck the link row (`property_credentials_guest_read`, `property_images_guest_read`, `guest_messages_guest_insert`, and the `guest_counters_guest_*` policies) read `app.share_links` in a subquery under that policy, so an expired link denies there; `supabase/tests/stay_links.sql` probes each one. `properties_guest_read`, `guide_sections_guest_read`, and `guide_translations_guest_read` only match `app.current_link_property_id()`, which `withActiveGuestLink` sets after reading the link row under `share_links_guest_read`; an expired link never gets that context.
- A link expires at 12:00 the day after check-out in the property's timezone (`app.properties.timezone`), computed in SQL when the link is created. The exchange clamps the guest session to the link expiry.
- Revoking a stay link disables it and deletes its sessions, the same as disabling the property link. The property-link functions filter `kind = 'property'`, so the property link card never sees stays.
- Manual stays use `source = 'manual'` and a random `external_id`. `guest_first_name` stays unused: there is no guest identity on a stay until there is a reason to show one.
- An expired link returns the existing generic denial. There is no "your stay ended" message, because it would confirm that the link was real.

## Consequences

- Hosts can hand each booking its own link and QR and leave the printed property card alone.
- Expired stay links stay in the table until their reservation is deleted, 90 days after the stay ends, and then cascade with their sessions. Their digests remain until then but cannot be used.
- The kill switch is unchanged: stay links use the same exchange and read entry points.
- Audit actions `stay_link_created` and `stay_link_revoked`.
- Not included: iCal import and the `api_tokens` ingestion API (now `agent_grants`). A later change to the property timezone does not move existing stay expiries.

Code: `supabase/migrations/20261018000000_initial_schema.sql`, `src/features/share/share.server.ts`, `src/features/share/share-fns.ts`, `StaysPanel` in `src/routes/host_.properties.$propertyId.tsx`.
