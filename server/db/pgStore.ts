/**
 * Postgres-backed RoomStore.
 *
 * Writes are fire-and-forget from the caller's point of view (see the contract in store.ts),
 * so the ordering discipline lives here:
 *
 * - One promise chain per room code, so a `save` can never overtake the `remove` that was
 *   issued before it and resurrect a closed room.
 * - `save` coalesces: it is a full-row upsert, so when one is already queued for a code only
 *   the newest payload matters. Under a fast exchange this collapses a burst into one write.
 * - `appendAction` never coalesces — every action must land — and is idempotent on (code, seq),
 *   so a retry is always safe.
 * - A write that keeps failing is dropped and the store goes `degraded`. It never throws into
 *   the WebSocket handler: a dead database must degrade this server to its pre-Phase-1
 *   in-memory behaviour, not take live games down with it.
 */
import pg from 'pg';
import type { Action } from '../../src/engine/index.ts';
import type { RoomSnapshot, RoomStore } from '../store.ts';
import { migrate } from './migrate.ts';

const { Pool } = pg;

const RETRY_DELAYS_MS = [250, 1000, 4000];

/**
 * jsonb parameters must be pre-serialised.
 *
 * node-postgres maps a JS array to a POSTGRES ARRAY literal (`{{1,2}}`), not to JSON — so a
 * `Board`, which is an array of arrays, is rejected outright by a jsonb column. Objects
 * happen to survive because they serialise as JSON either way, which makes this a bug that
 * hides until the first array-shaped value reaches the database.
 */
function json(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

interface RoomRow {
  code: string;
  phase: 'lobby' | 'playing';
  board: unknown;
  board_name: string | null;
  config: unknown;
  seat0_ready: boolean;
  seat0_deck: unknown;
  seat1_taken: boolean;
  seat1_ready: boolean;
  seat1_deck: unknown;
  last_activity: Date;
}

export class PgRoomStore implements RoomStore {
  private pool: pg.Pool;
  private chains = new Map<string, Promise<void>>();
  private pendingSave = new Map<string, RoomSnapshot>();
  private failures = 0;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  get degraded(): boolean {
    return this.failures > 0;
  }

  /** Queue `work` behind anything already in flight for `code`. */
  private chain(code: string, work: () => Promise<void>): void {
    const prev = this.chains.get(code) ?? Promise.resolve();
    const next = prev.then(work).catch((e: unknown) => {
      this.failures++;
      console.error(`[store] giving up on a write for room ${code}:`, e);
    });
    this.chains.set(code, next);
    // Drop the chain entry once it settles, so the map does not grow with dead room codes.
    void next.then(() => {
      if (this.chains.get(code) === next) this.chains.delete(code);
    });
  }

  private async withRetry(run: () => Promise<unknown>): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await run();
        this.failures = 0;
        return;
      } catch (e) {
        if (attempt >= RETRY_DELAYS_MS.length) throw e;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  save(room: RoomSnapshot): void {
    const queued = this.pendingSave.has(room.code);
    // Replace the payload; the already-queued job will pick up the newest one.
    this.pendingSave.set(room.code, room);
    if (queued) return;
    this.chain(room.code, async () => {
      const r = this.pendingSave.get(room.code);
      this.pendingSave.delete(room.code);
      if (!r) return;
      await this.withRetry(() =>
        this.pool.query(
          `insert into rooms (code, phase, board, board_name, config,
                              seat0_ready, seat0_deck, seat1_taken, seat1_ready, seat1_deck, last_activity)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11/1000.0))
           on conflict (code) do update set
             phase = excluded.phase, board = excluded.board, board_name = excluded.board_name,
             config = excluded.config, seat0_ready = excluded.seat0_ready,
             seat0_deck = excluded.seat0_deck, seat1_taken = excluded.seat1_taken,
             seat1_ready = excluded.seat1_ready, seat1_deck = excluded.seat1_deck,
             last_activity = excluded.last_activity`,
          [
            r.code, r.phase,
            json(r.board), r.boardName ?? null, json(r.config),
            r.seats[0].ready, json(r.seats[0].deck),
            r.seats[1] !== null, r.seats[1]?.ready ?? false, json(r.seats[1]?.deck),
            r.lastActivity,
          ],
        ),
      );
    });
  }

  appendAction(code: string, seq: number, action: Action): void {
    this.chain(code, () =>
      this.withRetry(() =>
        this.pool.query(
          `insert into room_actions (code, seq, action) values ($1,$2,$3)
           on conflict (code, seq) do nothing`,
          [code, seq, json(action)],
        ),
      ),
    );
  }

  remove(code: string): void {
    // A queued save for a room being removed is stale by definition.
    this.pendingSave.delete(code);
    this.chain(code, () => this.withRetry(() => this.pool.query('delete from rooms where code = $1', [code])));
  }

  async flush(): Promise<void> {
    // Chains can enqueue more work as they settle, so drain until the map stops changing.
    while (this.chains.size) await Promise.all([...this.chains.values()]);
  }

  async load(now: number): Promise<{ room: RoomSnapshot; actions: Action[] }[]> {
    // Apply the TTL in SQL first. After a long outage the table can hold many dead rooms, and
    // rehydrating them just for the in-memory sweeper to kill them a minute later is waste.
    // Mirrors sweep()'s predicate with "all seats offline" collapsed to true — after a
    // restart, nobody is connected.
    const offlineCutoff = now - 30 * 60 * 1000;
    const lobbyCutoff = now - 60 * 60 * 1000;
    await this.pool.query(
      `delete from rooms
        where last_activity < to_timestamp($1/1000.0)
           or (phase = 'lobby' and last_activity < to_timestamp($2/1000.0))`,
      [offlineCutoff, lobbyCutoff],
    );

    const rooms = await this.pool.query<RoomRow>('select * from rooms');
    const acts = await this.pool.query<{ code: string; seq: number; action: Action }>(
      'select code, seq, action from room_actions order by code, seq',
    );
    const byCode = new Map<string, Action[]>();
    for (const a of acts.rows) {
      const log = byCode.get(a.code) ?? [];
      log[a.seq] = a.action;
      byCode.set(a.code, log);
    }

    return rooms.rows.map((r) => ({
      room: {
        code: r.code,
        phase: r.phase,
        board: (r.board ?? undefined) as RoomSnapshot['board'],
        boardName: r.board_name ?? undefined,
        config: (r.config ?? undefined) as RoomSnapshot['config'],
        seats: [
          { ready: r.seat0_ready, deck: (r.seat0_deck ?? undefined) as RoomSnapshot['seats'][0]['deck'] },
          r.seat1_taken
            ? { ready: r.seat1_ready, deck: (r.seat1_deck ?? undefined) as RoomSnapshot['seats'][0]['deck'] }
            : null,
        ],
        lastActivity: r.last_activity.getTime(),
      },
      actions: byCode.get(r.code) ?? [],
    }));
  }
}

/** Build the pool, run migrations, and hand back a ready store. */
export async function createPgStore(connectionString: string): Promise<PgRoomStore> {
  const pool = new Pool({
    connectionString,
    // One process, turn-based traffic: a large pool would only hold idle connections against
    // the small instance limits these platforms ship with.
    max: 4,
    // Managed Postgres on Render/Railway presents a cert the container has no CA for.
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });
  await migrate(pool);
  return new PgRoomStore(pool);
}
