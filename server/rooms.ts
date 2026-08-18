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
import type { Action, Board, DeckDef } from '../src/engine/index.ts';
import type { ClientMsg, ErrorCode, LobbyState, ServerMsg, StartPayload } from '../src/net/protocol.ts';

/** Minimal connection adapter so tests can drive rooms without sockets. */
export interface Conn {
  send(msg: ServerMsg): void;
  close(): void;
}

type Seat = 0 | 1;

interface SeatState {
  token: string;
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

function newToken(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  get size(): number {
    return this.rooms.size;
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
    const token = newToken();
    this.rooms.set(code, {
      code,
      phase: 'lobby',
      seats: [{ token, conn, ready: false }, null],
      actions: [],
      lastActivity: Date.now(),
    });
    conn.send({ t: 'created', code, seat: 0, token });
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
    const token = newToken();
    room.seats[1] = { token, conn, ready: false };
    room.lastActivity = Date.now();
    conn.send({ t: 'joined', code, seat: 1, token });
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
    if (!ss || ss.token !== token) {
      this.fail(conn, 'bad-token', 'Reconnect token does not match that seat.');
      return null;
    }
    ss.conn?.close(); // replace a zombie connection
    ss.conn = conn;
    room.lastActivity = Date.now();
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
        this.broadcastLobby(room);
        return;
      case 'setBoard':
        if (room.phase !== 'lobby') return;
        if (seat !== 0) return this.fail(ss.conn, 'not-host', 'Only the host picks the board.');
        room.board = msg.board;
        room.boardName = msg.boardName;
        this.broadcastLobby(room);
        return;
      case 'ready':
        if (room.phase !== 'lobby') return;
        ss.ready = msg.ready;
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
        room.actions.push(msg.action);
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

  private leave(room: Room, seat: Seat): void {
    if (room.phase === 'lobby') {
      if (seat === 0) {
        this.close(room, 'The host left the room.');
      } else {
        room.seats[1] = null;
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
