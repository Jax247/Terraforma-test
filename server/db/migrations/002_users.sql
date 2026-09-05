-- Accounts, guest-first.
--
-- Every visitor gets a row here on their first API call, with no email and no password. That
-- is what lets an invite link be playable with zero signup while still giving the player a
-- durable identity. Claiming an account attaches credentials to the SAME row, so nothing a
-- guest did is orphaned by signing up.

create table if not exists users (
  id            text        primary key,
  -- Null until claimed. Stored lowercased; the unique index is what makes claim/login safe
  -- against two people racing for the same address.
  email         text,
  password_hash text,
  display_name  text        not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create unique index if not exists users_email_key on users (email) where email is not null;

-- Which account holds each seat, as {id, name}. Nullable: rooms created before this
-- migration have none, and a seat is occupied by a connection before we know anything about
-- it. The name is denormalised so a rehydrated lobby can render without joining users.
alter table rooms add column if not exists seat0_user jsonb;
alter table rooms add column if not exists seat1_user jsonb;
