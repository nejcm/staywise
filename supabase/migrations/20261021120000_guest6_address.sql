-- Guest features 6: property address, shown to guests with an outbound map link. Not a credential,
-- so it sits on properties (guest-readable through properties_guest_read) and is never translated.
set role app_migrator;

alter table app.properties add column address text
  check (address is null or char_length(address) between 1 and 200);

reset role;
