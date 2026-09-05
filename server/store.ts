/**
 * Durable-room persistence seam.
 *
 * The shape here is deliberately the mirror of `Conn` in rooms.ts: a tiny interface with an
 * in-memory double, so `RoomManager` can be driven in tests with no I/O at all.
 *
 * ⚠ The mutating methods return `void`, not promises, and that is the whole design.
 * `RoomManager` stays synchronous, which matters for two reasons:
 *
 * 1. WebSocket messages from one socket MUST be applied in arrival order. `ws.on('message')`
 *    is synchronous today, so ordering is free. An async manager would need a per-connection
 *    promise chain to keep a `ready` from overtaking a `setDeck` — a subtle piece of
 *    machinery guarding a hot path, and a bug class the current design simply does not have.
 * 2. The 15 existing room tests drive the manager through its public API. Async would mean
 *    `await` on every call and a rewrite of the best test harness in the repo.
 *
 * The cost is that a hard crash can lose the tail of the action log. That is survivable:
 * a client reconnects, `sync` carries a shorter log, and the existing resync path rebuilds
 * from it — the player loses at most their last move. Trading that for a WS handler that can
 * reorder messages would be a bad deal.
 *
 * The other rule, enforced by every implementation: a failing store NEVER throws into the
 * caller. A dead database degrades this server to exactly the in-memory behaviour it had
 * before Phase 1; it does not take live games down with it.
 */
import type { Action, Board, DeckDef } from '../src/engine/index.ts';
import type { StartPayload } from '../src/net/protocol.ts';

/** A seat as it survives a restart. Deliberately without `conn` or `token`. */
export interface PersistedSeat {
  ready: boolean;
  deck?: DeckDef;
}

/**
 * Everything about a room that outlives the process.
 *
 * No seat tokens: those are HMACs derived from `code:seat` (see `seatToken` in rooms.ts), so
 * a restarted server can validate a rejoin without having loaded anything, and a database
 * backup carries no credential.
 */
export interface RoomSnapshot {
  code: string;
  phase: 'lobby' | 'playing';
  board?: Board;
  boardName?: string;
  config?: StartPayload;
  seats: [PersistedSeat, PersistedSeat | null];
  lastActivity: number;
}

export interface RoomStore {
  /**
   * Boot only: every room worth resuming, with its log. Implementations drop expired rooms
   * before returning, so a long outage cannot rehydrate thousands of dead rooms just for the
   * sweeper to kill them a minute later.
   */
  load(now: number): Promise<{ room: RoomSnapshot; actions: Action[] }[]>;
  /** Upsert the room. Fire-and-forget; may coalesce with a pending save for the same code. */
  save(room: RoomSnapshot): void;
  /** Append one action. Idempotent on (code, seq) so a write-behind retry is safe. */
  appendAction(code: string, seq: number, action: Action): void;
  /** Drop the room and its actions. */
  remove(code: string): void;
  /** Drain pending writes. For SIGTERM, and for tests that need to observe the result. */
  flush(): Promise<void>;
  /** True while writes are failing, so /health can say so. */
  readonly degraded: boolean;
}

/**
 * The default store: keeps nothing beyond the process.
 *
 * This is not only a test double — it is the production fallback when DATABASE_URL is unset,
 * which is what keeps `npm run server` zero-config for local play.
 */
export class MemoryRoomStore implements RoomStore {
  readonly degraded = false;
  private rooms = new Map<string, RoomSnapshot>();
  private actions = new Map<string, Action[]>();

  load(_now: number): Promise<{ room: RoomSnapshot; actions: Action[] }[]> {
    return Promise.resolve(
      [...this.rooms.values()].map((room) => ({ room, actions: this.actions.get(room.code) ?? [] })),
    );
  }

  save(room: RoomSnapshot): void {
    // Deep-ish copy: the caller keeps mutating its live Room object, and a store that aliased
    // it would "persist" future edits retroactively and hide ordering bugs from the tests.
    this.rooms.set(room.code, structuredClone(room));
  }

  appendAction(code: string, seq: number, action: Action): void {
    const log = this.actions.get(code) ?? [];
    log[seq] = action;
    this.actions.set(code, log);
  }

  remove(code: string): void {
    this.rooms.delete(code);
    this.actions.delete(code);
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }
}
