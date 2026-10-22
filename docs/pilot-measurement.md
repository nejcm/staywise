# Pilot measurement

The raw, privacy-bounded pilot tables are `app.setup_events` (host funnel, 90-day retention), `app.guest_counters` (per-property UTC-day aggregate opens/exchanges/submissions, 400-day retention; the `/host` dashboard shows the last 30 days), and `app.guest_messages` (question/report volume and handled timestamps). Run these as an owner-privileged role; no guest identifiers exist in the counters:

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

-- Revocation/deletion audit volume. Audit rows store actor, action, and time (sign-in rows also a device label and place), not property IDs.
select actor_id, action, count(*) as events, min(created_at) as first_at, max(created_at) as last_at
from app.audit_events
where action in ('delete', 'link_disabled', 'link_rotated')
group by actor_id, action
order by actor_id, action;
```

Setup time is the interval between a host's first `sign_in` and first `publish_clicked`; second-property time is the first `property_created` row with `step = 'copy'` for that host to the property's following `publish_clicked`. `step` and `property_id` therefore stay in the grouping: blank and copy creation are different events, and a host can have more than one property. Audit rows do not carry a property ID, so the revocation/deletion query reports counts by host and action, not a property-level deletion report. These are readiness measurements, not a dashboard or a claim that the five-host pilot has run; price validation starts only after actual use.
