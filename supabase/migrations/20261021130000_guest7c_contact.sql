-- Guest features 7c (G1): host phone and answering hours, shown to guests after link exchange only.
set role app_migrator;

alter table app.properties add column contact_phone text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{6,14}$');
alter table app.properties add column answer_from time;
alter table app.properties add column answer_to time;
alter table app.properties add constraint properties_answer_hours_paired
  check ((answer_from is null) = (answer_to is null));

reset role;
