-- Custom decks and boards, per account.
--
-- One row per user holding both collections whole, rather than a row per deck. That is not a
-- shortcut: the client reads and writes entire collections (`saveDecks(list)` replaces the
-- array), so per-item tables would buy normalisation nothing would use while adding CRUD the
-- UI never issues. Decks are opaque jsonb here exactly as they are on the wire — the server
-- still knows nothing about cards.
--
-- The version columns exist because a whole-collection write is a destructive write. Two
-- devices editing the same account would otherwise silently lose whichever save landed first:
-- a stale client that never saw deck B would happily PUT a list without it. Callers send the
-- version they read, and a mismatch is refused rather than applied.

create table if not exists user_content (
  user_id       text        primary key references users(id) on delete cascade,
  decks         jsonb       not null default '[]'::jsonb,
  decks_version integer     not null default 0,
  boards        jsonb       not null default '[]'::jsonb,
  boards_version integer    not null default 0,
  updated_at    timestamptz not null default now()
);
