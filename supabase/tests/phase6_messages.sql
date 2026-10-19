-- Phase 6 guest messages: intake policies, guest counter policies, message invariants, and the
-- inbox audit vocabulary.
begin;

create extension if not exists pgtap;

select plan(33);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

-- Fixtures; the runner inserts bypass forced RLS and the whole file rolls back.
insert into auth.users (id, email) values
  ('7c000000-0000-4000-8000-0000000000a1', 'pgtap-msg-a@example.test'),
  ('7c000000-0000-4000-8000-0000000000b1', 'pgtap-msg-b@example.test');
insert into app.properties (id, owner_id, display_name, published, alert_email) values
  ('7c000000-0000-4000-8000-0000000000a2', '7c000000-0000-4000-8000-0000000000a1', 'Inbox A', true, 'pgtap-msg-a@example.test'),
  ('7c000000-0000-4000-8000-0000000000a7', '7c000000-0000-4000-8000-0000000000a1', 'Offline A', false, null),
  ('7c000000-0000-4000-8000-0000000000b2', '7c000000-0000-4000-8000-0000000000b1', 'Inbox B', true, 'pgtap-msg-b@example.test');
insert into app.share_links (id, secret_hmac, property_id) values
  ('pgtapLinkP600000001', '\x0102', '7c000000-0000-4000-8000-0000000000a2'),
  ('pgtapLinkP600000002', '\x0102', '7c000000-0000-4000-8000-0000000000b2'),
  ('pgtapLinkP600000003', '\x0102', '7c000000-0000-4000-8000-0000000000a7');

-- One stored message for the owner read/update/delete probes.
insert into app.guest_messages (id, property_id, kind, category, locale, body, follow_up_email, state, handled_at) values
  ('7c000000-0000-4000-8000-0000000000c1', '7c000000-0000-4000-8000-0000000000a2', 'question', 'wifi', 'de',
   'Wo ist das WLAN?', 'guest@example.test', 'handled', now());

-- Inbox actions, including the answer tag, join the audit vocabulary; unknown names stay rejected.
create temp table probe_audit_message on commit drop as
  with ins as (
    insert into app.audit_events (actor_id, action)
      values
        ('7c000000-0000-4000-8000-0000000000a1', 'message_handled'),
        ('7c000000-0000-4000-8000-0000000000a1', 'message_tagged'),
        ('7c000000-0000-4000-8000-0000000000a1', 'message_deleted')
      returning 1 as n
  )
  select count(*)::bigint as n from ins;
create temp table probe_audit_bogus_message (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.audit_events (actor_id, action) values ('7c000000-0000-4000-8000-0000000000a1', 'message_read');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_audit_bogus_message (blocked, err_state) values (blocked, err_state);
end $$;

-- Message invariants: approved guest locales, bounded body/email, handled timestamp pairing, and
-- the question-only answer tag.
create temp table probe_msg_locale (blocked boolean not null, err_state text) on commit drop;
create temp table probe_msg_body_empty (blocked boolean not null, err_state text) on commit drop;
create temp table probe_msg_body_long (blocked boolean not null, err_state text) on commit drop;
create temp table probe_msg_email_long (blocked boolean not null, err_state text) on commit drop;
create temp table probe_msg_handled_pair (blocked boolean not null, err_state text) on commit drop;
create temp table probe_msg_answer_kind (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_messages (property_id, kind, locale, body)
      values ('7c000000-0000-4000-8000-0000000000a2', 'issue', 'fr', 'Bonjour');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_msg_locale (blocked, err_state) values (blocked, err_state);
end $$;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_messages (property_id, kind, body) values ('7c000000-0000-4000-8000-0000000000a2', 'issue', '');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_msg_body_empty (blocked, err_state) values (blocked, err_state);
end $$;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_messages (property_id, kind, body)
      values ('7c000000-0000-4000-8000-0000000000a2', 'issue', repeat('x', 2001));
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_msg_body_long (blocked, err_state) values (blocked, err_state);
end $$;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_messages (property_id, kind, body, follow_up_email)
      values ('7c000000-0000-4000-8000-0000000000a2', 'issue', 'Kaputt', repeat('a', 250) || '@example.test');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_msg_email_long (blocked, err_state) values (blocked, err_state);
end $$;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_messages (property_id, kind, body, state)
      values ('7c000000-0000-4000-8000-0000000000a2', 'issue', 'Kaputt', 'handled');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_msg_handled_pair (blocked, err_state) values (blocked, err_state);
end $$;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_messages (property_id, kind, body, answer_in_guide)
      values ('7c000000-0000-4000-8000-0000000000a2', 'issue', 'Kaputt', true);
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_msg_answer_kind (blocked, err_state) values (blocked, err_state);
end $$;

-- Link context A: intake only for the link's own published property, no read/update/delete, and
-- counters only for the link's own property.
set local role app_runtime;
select set_config('app.link_id', 'pgtapLinkP600000001', true);
create temp table probe_msg_no_property (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_messages (property_id, kind, body)
      values ('7c000000-0000-4000-8000-0000000000a2', 'issue', 'Ohne Eigentum');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_msg_no_property (blocked, err_state) values (blocked, err_state);
end $$;
select set_config('app.link_property_id', '7c000000-0000-4000-8000-0000000000a2', true);
create temp table probe_msg_insert_own on commit drop as
  with ins as (
    insert into app.guest_messages (property_id, kind, category, locale, body)
      values ('7c000000-0000-4000-8000-0000000000a2', 'issue', 'wifi', 'sl', 'Internet ne dela')
      returning 1 as n
  )
  select count(*)::bigint as n from ins;
create temp table probe_msg_insert_foreign (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_messages (property_id, kind, body)
      values ('7c000000-0000-4000-8000-0000000000b2', 'issue', 'Fremd');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_msg_insert_foreign (blocked, err_state) values (blocked, err_state);
end $$;
create temp table probe_msg_insert_unpublished (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_messages (property_id, kind, body)
      values ('7c000000-0000-4000-8000-0000000000a7', 'issue', 'Offline');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_msg_insert_unpublished (blocked, err_state) values (blocked, err_state);
end $$;
create temp table probe_msg_guest_read on commit drop as select count(*)::bigint as n from app.guest_messages;
create temp table probe_msg_guest_update on commit drop as
  with updated as (update app.guest_messages set state = 'handled', handled_at = now() returning 1)
  select count(*)::bigint as n from updated;
create temp table probe_msg_guest_delete on commit drop as
  with deleted as (delete from app.guest_messages returning 1)
  select count(*)::bigint as n from deleted;

create temp table probe_counter_insert_own on commit drop as
  with ins as (
    insert into app.guest_counters (property_id, day, link_exchanges) values ('7c000000-0000-4000-8000-0000000000a2', current_date, 1)
    returning 1 as n
  )
  select count(*)::bigint as n from ins;
create temp table probe_counter_upsert on commit drop as
  with up as (
    insert into app.guest_counters (property_id, day, guide_opens) values ('7c000000-0000-4000-8000-0000000000a2', current_date, 1)
    on conflict (property_id, day) do update set guide_opens = app.guest_counters.guide_opens + 1
    returning 1 as n
  )
  select count(*)::bigint as n from up;
create temp table probe_counter_row on commit drop as
  select link_exchanges, guide_opens, submissions from app.guest_counters where property_id = '7c000000-0000-4000-8000-0000000000a2';
create temp table probe_counter_foreign (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_counters (property_id, day) values ('7c000000-0000-4000-8000-0000000000b2', current_date);
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_counter_foreign (blocked, err_state) values (blocked, err_state);
end $$;
reset role;
select set_config('app.link_id', '', true);
select set_config('app.link_property_id', '', true);

set local role app_runtime;
create temp table probe_counter_no_context (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_counters (property_id, day) values ('7c000000-0000-4000-8000-0000000000a2', current_date);
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_counter_no_context (blocked, err_state) values (blocked, err_state);
end $$;
reset role;

-- Owner context: own messages including handled ones, never another host's.
set local role app_runtime;
select set_config('app.owner_id', '7c000000-0000-4000-8000-0000000000a1', true);
create temp table probe_msg_owner_read on commit drop as select count(*)::bigint as n from app.guest_messages;
create temp table probe_msg_owner_foreign on commit drop as
  select count(*)::bigint as n from app.guest_messages where property_id = '7c000000-0000-4000-8000-0000000000b2';
create temp table probe_msg_owner_tag on commit drop as
  with updated as (
    update app.guest_messages set answer_in_guide = true
    where id = '7c000000-0000-4000-8000-0000000000c1' returning 1
  )
  select count(*)::bigint as n from updated;
create temp table probe_msg_owner_handled_orphan (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    update app.guest_messages set state = 'new' where id = '7c000000-0000-4000-8000-0000000000c1';
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_msg_owner_handled_orphan (blocked, err_state) values (blocked, err_state);
end $$;
create temp table probe_msg_owner_delete_foreign on commit drop as
  with deleted as (
    delete from app.guest_messages where property_id = '7c000000-0000-4000-8000-0000000000b2' returning 1
  )
  select count(*)::bigint as n from deleted;
create temp table probe_msg_owner_delete_own on commit drop as
  with deleted as (
    delete from app.guest_messages where id = '7c000000-0000-4000-8000-0000000000c1' returning 1
  )
  select count(*)::bigint as n from deleted;
reset role;
select set_config('app.owner_id', '', true);

select is((select n from probe_audit_message), 3::bigint, 'inbox actions including the tag are valid audit actions');
select is((select blocked from probe_audit_bogus_message), true, 'unknown inbox audit actions stay rejected');
select is((select blocked from probe_msg_locale), true, 'a message locale without guest resources is rejected');
select is((select err_state from probe_msg_locale), '23514', 'an unapproved message locale fails the check constraint');
select is((select blocked from probe_msg_body_empty), true, 'an empty message body is rejected');
select is((select blocked from probe_msg_body_long), true, 'a message body beyond the bound is rejected');
select is((select blocked from probe_msg_email_long), true, 'a reply address beyond the bound is rejected');
select is((select blocked from probe_msg_handled_pair), true, 'handled state without a handled timestamp is rejected');
select is((select err_state from probe_msg_handled_pair), '23514', 'the handled pairing fails the check constraint');
select is((select blocked from probe_msg_answer_kind), true, 'the answer tag is rejected on issues');
select is((select blocked from probe_msg_no_property), true, 'link context without a validated property cannot insert');
select is((select err_state from probe_msg_no_property), '42501', 'the unscoped message insert fails with an RLS violation');
select is((select n from probe_msg_insert_own), 1::bigint, 'link context stores one message for its own published property');
select is((select blocked from probe_msg_insert_foreign), true, 'link context cannot store a message for another property');
select is((select err_state from probe_msg_insert_foreign), '42501', 'the cross-property message insert fails with an RLS violation');
select is((select blocked from probe_msg_insert_unpublished), true, 'link context cannot store a message for an unpublished property');
select is((select n from probe_msg_guest_read), 0::bigint, 'guests cannot read stored messages');
select is((select n from probe_msg_guest_update), 0::bigint, 'guests cannot update stored messages');
select is((select n from probe_msg_guest_delete), 0::bigint, 'guests cannot delete stored messages');
select is((select n from probe_counter_insert_own), 1::bigint, 'link context opens the daily counter for its own property');
select is((select n from probe_counter_upsert), 1::bigint, 'a second bump upserts the same daily row');
select is((select guide_opens from probe_counter_row), 1, 'the upsert increments only its own column');
select is((select link_exchanges from probe_counter_row), 1, 'the earlier column survives the upsert');
select is((select blocked from probe_counter_foreign), true, 'link context cannot bump another property counter');
select is((select blocked from probe_counter_no_context), true, 'without link context no counter row can be written');
select is((select n from probe_msg_owner_read), 2::bigint, 'owner context reads only its own messages');
select is((select n from probe_msg_owner_foreign), 0::bigint, 'owner context never reads another host message');
select is((select n from probe_msg_owner_tag), 1::bigint, 'owner context tags the answer as found in the guide');
select is((select blocked from probe_msg_owner_handled_orphan), true, 'owner context cannot unhandle without clearing the timestamp');
select is((select err_state from probe_msg_owner_handled_orphan), '23514', 'the handled pairing stays enforced for owner updates');
select is((select n from probe_msg_owner_delete_foreign), 0::bigint, 'owner context cannot delete another host message');
select is((select n from probe_msg_owner_delete_own), 1::bigint, 'owner context deletes its own message before retention expiry');
select is((select alert_email from app.properties where id = '7c000000-0000-4000-8000-0000000000b2'), 'pgtap-msg-b@example.test', 'the property stores its host alert address');

select * from finish();
rollback;
