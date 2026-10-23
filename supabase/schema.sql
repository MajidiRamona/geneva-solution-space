-- Geneva Solution Space bookings.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste this file → Run.
-- Only the Netlify functions talk to this table (with the service key); the browser never does.

create extension if not exists btree_gist;

create table if not exists bookings (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,                -- shown to people, e.g. GSS-7K3P9Q
  space          text not null,                       -- key from content/pages/reservations.json
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  full_day       boolean not null default false,
  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'declined', 'cancelled', 'blocked')),

  name           text,
  email          text,
  phone          text,
  organization   text,
  event          text,
  participants   integer,
  plan           text,
  first_time     boolean not null default false,

  price_estimate numeric(10, 2),
  price_final    numeric(10, 2),
  admin_note     text,                                -- message sent with approve/decline, or the label of a block
  cancel_token   text not null default encode(gen_random_bytes(18), 'hex'),

  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     text,

  check (ends_at > starts_at),

  -- No two live bookings (pending, approved or blocked) may overlap in the same space.
  -- This holds even when two people submit at the same moment.
  constraint bookings_no_overlap exclude using gist (
    space with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending', 'approved', 'blocked'))
);

create index if not exists bookings_space_time on bookings (space, starts_at, ends_at);
create index if not exists bookings_status on bookings (status, created_at);

-- Lock the table down: no access through the public (anon) API key.
alter table bookings enable row level security;
