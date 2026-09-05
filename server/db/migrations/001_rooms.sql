-- Durable rooms. The server stays rules-agnostic: decks, boards, configs and actions are
-- opaque JSON it stores and hands back, so tuning RULES never requires a migration.

create table if not exists rooms (
  -- The room code is the only identifier the protocol has, so it is the natural key. Its
  -- unique constraint is also what makes the code-collision retry in create() safe when two
  -- instances briefly overlap during a rolling deploy.
  code          text        primary key,
  phase         text        not null check (phase in ('lobby', 'playing')),
  board         jsonb,
  board_name    text,
  config        jsonb,
  seat0_ready   boolean     not null default false,
  seat0_deck    jsonb,
  -- Distinct from "seat 1 has a deck": a guest occupies the seat long before choosing one,
  -- and join() must reject a second guest from the moment they sit down.
  seat1_taken   boolean     not null default false,
  seat1_ready   boolean     not null default false,
  seat1_deck    jsonb,
  created_at    timestamptz not null default now(),
  last_activity timestamptz not null
);

-- The TTL sweep is the only query that scans rather than seeks.
create index if not exists rooms_last_activity_idx on rooms (last_activity);

create table if not exists room_actions (
  code   text    not null references rooms(code) on delete cascade,
  seq    integer not null,
  action jsonb   not null,
  -- Gives idempotence for free (a write-behind retry re-inserts harmlessly) and ordering for
  -- free (the log is read back with `order by seq`). It is also the only access path, so no
  -- further index earns its keep.
  primary key (code, seq)
);
