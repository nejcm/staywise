-- Guest themes: a preset per property; keys are permanent because stored rows reference them.
set role app_migrator;

alter table app.properties add column theme text not null default 'staywise'
  check (theme in ('staywise', 'coast', 'alpine', 'terracotta', 'classic'));

reset role;
