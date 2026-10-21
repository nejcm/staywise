# 0005: Property hero image in a private Supabase Storage bucket

**Status:** accepted, 2026-10-21

## Context

Guests see a text-only guide. One cover photo per property makes the link recognisable, but every guest-facing byte so far is gated by a live bearer link (ADR 0004), the kill switch, and RLS under `app_runtime`. An image has to keep those properties: revoking, rotating, or expiring a link, or turning guest access off, must stop serving the photo at once.

## Decision

- **Storage:** a private Supabase Storage bucket `guide-images` (1 MiB, `image/jpeg` only) with no `storage.objects` policies. Only the server touches it, with `SUPABASE_SECRET_KEY`, and only after it has read the image row under owner context (`withOwnerContext`) or a live guest link (`withActiveGuestLink`). The key performs I/O; it never decides access.
- **Metadata:** `app.property_images`, one row per property (`property_id` primary key, cascades with the property). `property_images_owner` follows `guide_sections_owner`; `property_images_guest_read` follows `property_credentials_guest_read`: the link's property, the link row rechecked through `share_links_guest_read` (so expiry applies), and the property published. Object paths are `<property_id>/<uuid>.jpg`, a new key per upload, and never leave the server.
- **Serving:** same-origin routes stream the object, so CSP `img-src` gains only `blob:` (editor preview of the re-encoded file) and the kill switch, link rotate/disable, stay revoke, and stay expiry apply on the next request. Owner and guest responses are `private, no-store` (the baseline for `/host` and `/g`), so revocation applies on the next view; the URL still carries `?v=<version>` so a replaced hero is never confused with the old one.
- **Deletion:** direct `delete from storage.objects` is blocked by Supabase (`storage.protect_delete`, verified on the local stack), so a `security definer` trigger on `property_images` (update of `object_path`, delete) queues the old path in `app.storage_deletions`. Cascades from `app.properties` and `auth.users` pass through it. The server drains the queue through the Storage API after commit; `app_runtime` may only read and delete queue rows.
- **Images are re-encoded in the browser** (JPEG, long edge 1600 px), which drops EXIF/GPS; the server still rejects APP1 segments and anything that is not a JPEG.

## Rejected

- **Sanity:** free datasets and Content Lake asset URLs are public, so revoking a link could not revoke the image.
- **Public bucket:** same problem; anyone with the URL keeps access.
- **Signed URLs:** cannot be revoked before they expire.
- **`bytea` in Postgres:** database size and pooler bandwidth.
- **Hero columns on `app.properties`:** the object path would leak into every select and into `insertCopy`.

## Consequences

- `SUPABASE_SECRET_KEY` is effectively required in production; without it the upload UI is hidden behind a notice.
- A failed drain leaves the object in the bucket and the path in the queue until the next drain; nothing references it, so it is unreachable.
- Account deletion and property deletion purge images through the same queue (ADR 0002).

Code: `supabase/migrations/20261021210000_property_images.sql`, `supabase/tests/property_images.sql`, `src/lib/storage.server.ts`, `src/features/guide/image-validation.ts`, `src/features/guide/guide.server.ts`.
