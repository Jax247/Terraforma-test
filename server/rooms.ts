/**
 * Transport-free room/relay logic for online play.
 *
 * The server is rules-agnostic: decks, boards, and actions are opaque JSON it
 * stores and relays. Both clients run the (deterministic) engine themselves;
 * the room keeps the start payload plus the append-only action log so a
 * reconnecting client can replay to the current state.
 *
 * Runs under Node's TypeScript type-stripping: erasable syntax only, and only
 * `import type` from src/.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Action, Board, DeckDef } from '../src/engine/index.ts';
import type { ClientMsg, ErrorCode, LobbyState, ServerMsg, StartPayload } from '../src/net/protocol.ts';
import { MemoryRoomStore, type RoomSnapshot, type RoomStore } from './store.ts';

/** Minimal connection adapter so tests can drive rooms without sockets. */
export interface Conn {
  send(msg: ServerMsg): void;
  close(): void;
}

type Seat = 0 | 1;

interface SeatState {
  conn: Conn | null;
  ready: boolean;
  deck?: DeckDef;
}

interface Room {
  code: string;
  phase: 'lobby' | 'playing';
  seats: [SeatState, SeatState | null]; // seat 1 is null until a guest joins
  board?: Board;
  boardName?: string;
  config?: StartPayload; // set once the host starts
  actions: Action[];
  lastActivity: number;
}

// No 0/O/1/I so codes survive being read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

const OFFLINE_ROOM_TTL_MS = 30 * 60 * 1000; // both seats gone
const LOBBY_ROOM_TTL_MS = 60 * 60 * 1000; // never started

/**
 * Ceiling on one room's action log. The log is append-only and replayed on every rejoin, so
 * without a bound it is unbounded memory a seated client can grow at will. Real games run to
 * a few hundred actions (the longest self-play in the suite is well under 500), so this is
 * roughly 20x headroom — a room that reaches it is looping, not playing.
 */
const MAX_ACTIONS_PER_ROOM = 10_000;

/**
 * Seat tokens are derived, not stored.
 *
 * A random token has to be persisted for a restarted server to recognise it, which puts a
 * live credential in the database and in every backup. An HMAC over `code:seat` is checkable
 * by any process holding the secret, so a rehydrated room accepts its players' rejoins
 * without the store having carried anything sensitive.
 *
 * The token's lifetime is bounded by the room's, which the TTL sweep bounds. Rotating
 * SEAT_SECRET invalidates every live seat — fine, that is what a redeploy already did.
 */
const SEAT_SECRET =
  process.env.SEAT_SECRET ??
  (() => {
    // Dev fallback keeps `npm run server` zero-config. Sessions die with the process, which
    // is exactly what happened before Phase 1, so nothing regresses locally.
    if (process.env.NODE_ENV === 'production') {
      console.warn('[rooms] SEAT_SECRET is unset in production — seats will not survive a restart.');
    }
    return randomBytes(32).toString('hex');
  })();

function seatToken(code: string, seat: Seat): string {
  return createHmac('sha256', SEAT_SECRET).update(`${code}:${seat}`).digest('base64url').slice(0, 22);
}

function checkSeatToken(code: string, seat: Seat, token: string): boolean {
  const want = Buffer.from(seatToken(code, seat));
  const got = Buffer.from(token);
  // timingSafeEqual throws on a length mismatch, so guard it rather than let a short token
  // crash the message handler.
  return want.length === got.length && timingSafeEqual(want, got);
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private store: RoomStore;

  /**
   * Defaults to the in-memory store, so every existing caller and test keeps working with no
   * database in sight. `server/main.ts` passes a Postgres-backed one when DATABASE_URL is set.
   */
  constructor(store: RoomStore = new MemoryRoomStore()) {
    this.store = store;
  }

  get size(): number {
    return this.rooms.size;
  }

  /**
   * Rebuild the room map from the store. Boot only, and it MUST finish before the server
   * accepts connections: a client that reconnects into the gap gets `room-not-found`, which
   * the client treats as terminal and uses to discard a game that was actually recoverable.
   *
   * Rehydrated rooms keep their original `lastActivity` rather than being stamped `now` — a
   * room idle 25 minutes before a restart should die 5 minutes after it, not 30.
   */
  async rehydrate(): Promise<number> {
    const rows = await this.store.load(Date.now());
    for (const { room, actions } of rows) {
      this.rooms.set(room.code, {
        code: room.code,
        phase: room.phase,
        // Everyone is legitimately disconnected after a restart; they arrive via rejoin.
        seats: [
          { conn: null, ready: room.seats[0].ready, deck: room.seats[0].deck },
          room.seats[1] ? { conn: null, ready: room.seats[1].ready, deck: room.seats[1].deck } : null,
        ],
        board: room.board,
        boardName: room.boardName,
        config: room.config,
        actions,
        lastActivity: room.lastActivity,
      });
    }
    return rows.length;
  }

  /** The persistable projection of a live room — drops `conn`, which cannot outlive a process. */
  private snapshot(room: Room): RoomSnapshot {
    const seat = (s: SeatState): { ready: boolean; deck?: DeckDef } => ({ ready: s.ready, deck: s.deck });
    return {
      code: room.code,
      phase: room.phase,
      board: room.board,
      boardName: room.boardName,
      config: room.config,
      seats: [seat(room.seats[0]), room.seats[1] ? seat(room.seats[1]) : null],
      lastActivity: room.lastActivity,
    };
  }

  /**
   * Every call into the store goes through here.
   *
   * store.ts asks implementations never to throw, but the manager does not take that on
   * trust: persistence is a side concern, and a bug in a store — or a driver that throws
   * synchronously before it ever returns a promise — must not be able to kill a game that is
   * otherwise fine. Defence in depth, on the cheapest possible terms.
   */
  private tryStore(what: string, run: () => void): void {
    try {
      run();
    } catch (e) {
      console.error(`[rooms] store.${what} failed:`, e);
    }
  }

  private persist(room: Room): void {
    const snap = this.snapshot(room);
    this.tryStore('save', () => this.store.save(snap));
  }

  /** Open a new room; the creator holds seat 0 (host). Sends `created`. */
  create(conn: Conn): { code: string; seat: 0 } {
    let code: string;
    do {
      code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join('');
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      phase: 'lobby',
      seats: [{ conn, ready: false }, null],
      actions: [],
      lastActivity: Date.now(),
    };
    this.rooms.set(code, room);
    this.persist(room);
    conn.send({ t: 'created', code, seat: 0, token: seatToken(code, 0) });
    return { code, seat: 0 };
  }

  /** Take seat 1 in an open room. Sends `joined` + a lobby broadcast, or an error. */
  join(code: string, conn: Conn): { code: string; seat: 1 } | null {
    const room = this.rooms.get(code);
    if (!room) {
      this.fail(conn, 'room-not-found', `No room with code ${code}.`);
      return null;
    }
    if (room.seats[1] !== null) {
      this.fail(conn, 'room-full', 'That room already has two players.');
      return null;
    }
    room.seats[1] = { conn, ready: false };
    room.lastActivity = Date.now();
    this.persist(room);
    conn.send({ t: 'joined', code, seat: 1, token: seatToken(code, 1) });
    this.broadcastLobby(room);
    return { code, seat: 1 };
  }

  /** Reclaim a seat after a refresh/reconnect. Sends a full `sync`, or an error. */
  rejoin(code: string, seat: Seat, token: string, conn: Conn): { code: string; seat: Seat } | null {
    const room = this.rooms.get(code);
    if (!room) {
      this.fail(conn, 'room-not-found', `No room with code ${code}.`);
      return null;
    }
    const ss = room.seats[seat];
    if (!ss || !checkSeatToken(code, seat, token)) {
      this.fail(conn, 'bad-token', 'Reconnect token does not match that seat.');
      return null;
    }
    ss.conn?.close(); // replace a zombie connection
    ss.conn = conn;
    room.lastActivity = Date.now();
    this.persist(room);
    this.sendSync(room, conn);
    this.sendToOther(room, seat, { t: 'peer', seat, connected: true });
    if (room.phase === 'lobby') this.broadcastLobby(room);
    return { code, seat };
  }

  /** In-room messages from an already-seated connection. */
  handle(code: string, seat: Seat, msg: ClientMsg): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const ss = room.seats[seat];
    if (!ss) return;
    room.lastActivity = Date.now();

    switch (msg.t) {
      case 'setDeck':
        if (room.phase !== 'lobby') return;
        ss.deck = msg.deck;
        ss.ready = false; // changing deck un-readies you
        this.persist(room);
        this.broadcastLobby(room);
        return;
      case 'setBoard':
        if (room.phase !== 'lobby') return;
        if (seat !== 0) return this.fail(ss.conn, 'not-host', 'Only the host picks the board.');
        room.board = msg.board;
        room.boardName = msg.boardName;
        this.persist(room);
        this.broadcastLobby(room);
        return;
      case 'ready':
        if (room.phase !== 'lobby') return;
        ss.ready = msg.ready;
        this.persist(room);
        this.broadcastLobby(room);
        return;
      case 'start': {
        if (seat !== 0) return this.fail(ss.conn, 'not-host', 'Only the host can start the game.');
        if (room.phase !== 'lobby') return;
        const guest = room.seats[1];
        if (!guest || !room.seats[0].deck || !guest.deck || !room.board)
          return this.fail(ss.conn, 'not-ready', 'Both players need a deck (and the host a board) first.');
        if (!room.seats[0].ready || !guest.ready)
          return this.fail(ss.conn, 'not-ready', 'Both players must be ready.');
        room.config = {
          decks: [room.seats[0].deck, guest.deck],
          board: room.board,
          orders: msg.orders,
        };
        room.phase = 'playing';
        this.persist(room);
        this.broadcast(room, { t: 'start', config: room.config });
        return;
      }
      case 'action': {
        if (room.phase !== 'playing') return;
        if (msg.seq !== room.actions.length) {
          this.fail(ss.conn, 'bad-seq', `Expected seq ${room.actions.length}, got ${msg.seq}.`);
          if (ss.conn) this.sendSync(room, ss.conn);
          return;
        }
        if (room.actions.length >= MAX_ACTIONS_PER_ROOM) {
          this.close(room, 'Room closed: action limit reached.');
          return;
        }
        room.actions.push(msg.action);
        // The action row is the durable one; the room row only carries lastActivity forward,
        // which is what keeps a game in progress from ageing out of the TTL sweep.
        this.tryStore('appendAction', () => this.store.appendAction(room.code, msg.seq, msg.action));
        this.persist(room);
        this.broadcast(room, { t: 'action', seq: msg.seq, action: msg.action, hash: msg.hash });
        return;
      }
      case 'resync':
        if (ss.conn) this.sendSync(room, ss.conn);
        return;
      case 'leave':
        this.leave(room, seat);
        return;
      default:
        // create/join/rejoin are connection-level; ignore here.
        return;
    }
  }

  /** Socket dropped without an explicit leave: keep the seat for rejoin. */
  disconnect(code: string, seat: Seat): void {
    const room = this.rooms.get(code);
    const ss = room?.seats[seat];
    if (!room || !ss) return;
    ss.conn = null;
    room.lastActivity = Date.now();
    this.persist(room);
    this.sendToOther(room, seat, { t: 'peer', seat, connected: false });
    if (room.phase === 'lobby') this.broadcastLobby(room);
  }

  /** Periodic GC. Returns the codes of rooms that were closed. */
  sweep(now = Date.now()): string[] {
    const closed: string[] = [];
    for (const room of this.rooms.values()) {
      const idle = now - room.lastActivity;
      const allOffline = room.seats.every((s) => !s?.conn);
      if ((allOffline && idle > OFFLINE_ROOM_TTL_MS) || (room.phase === 'lobby' && idle > LOBBY_ROOM_TTL_MS)) {
        this.close(room, 'Room expired from inactivity.');
        closed.push(room.code);
      }
    }
    return closed;
  }

  /**
   * Tell every seated player the server is going away, WITHOUT destroying their rooms.
   *
   * ⚠ Deliberately not `close()`. A container stop is routine on a PaaS, and since Phase 1
   * the rooms outlive it — deleting them here would erase exactly the state this server now
   * exists to preserve. The rows stay; clients reconnect and `rejoin` into the rehydrated
   * room. This only stops players staring at a silent reconnect spinner.
   */
  notifyShutdown(reason: string): void {
    for (const room of this.rooms.values()) {
      for (const s of room.seats) s?.conn?.send({ t: 'roomClosed', reason });
    }
  }

  private leave(room: Room, seat: Seat): void {
    if (room.phase === 'lobby') {
      if (seat === 0) {
        this.close(room, 'The host left the room.');
      } else {
        room.seats[1] = null;
        this.persist(room);
        this.broadcastLobby(room);
      }
      return;
    }
    // Mid-game: free the connection but keep the room so the peer can idle/rejoin.
    const ss = room.seats[seat];
    if (ss) ss.conn = null;
    this.sendToOther(room, seat, { t: 'peer', seat, connected: false });
  }

  private close(room: Room, reason: string): void {
    for (const s of room.seats) s?.conn?.send({ t: 'roomClosed', reason });
    this.rooms.delete(room.code);
    this.tryStore('remove', () => this.store.remove(room.code));
  }

  private lobbyState(room: Room): LobbyState {
    const seat = (s: SeatState | null) => ({
      connected: !!s?.conn,
      ready: !!s?.ready,
      deck: s?.deck,
    });
    return {
      code: room.code,
      seats: [seat(room.seats[0]), seat(room.seats[1])],
      board: room.board,
      boardName: room.boardName,
    };
  }

  private sendSync(room: Room, conn: Conn): void {
    if (room.phase === 'playing' && room.config) {
      conn.send({ t: 'sync', phase: 'game', config: room.config, actions: room.actions });
    } else {
      conn.send({ t: 'sync', phase: 'lobby', lobby: this.lobbyState(room) });
    }
  }

  private broadcastLobby(room: Room): void {
    this.broadcast(room, { t: 'lobby', lobby: this.lobbyState(room) });
  }

  private broadcast(room: Room, msg: ServerMsg): void {
    for (const s of room.seats) s?.conn?.send(msg);
  }

  private sendToOther(room: Room, seat: Seat, msg: ServerMsg): void {
    room.seats[seat === 0 ? 1 : 0]?.conn?.send(msg);
  }

  private fail(conn: Conn | null, code: ErrorCode, message: string): void {
    conn?.send({ t: 'error', code, message });
  }
}
