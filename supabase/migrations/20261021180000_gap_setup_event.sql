-- Guide gaps: a section added from the editor's gap panel is a setup funnel event.
set role app_migrator;

alter table app.setup_events drop constraint setup_events_event_type_check;
alter table app.setup_events add constraint setup_events_event_type_check
  check (
    event_type in (
      'sign_in',
      'property_created',
      'section_saved',
      'preview_opened',
      'publish_clicked',
      'support_requested',
      'gap_section_added'
    )
  );

reset role;
