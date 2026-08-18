import { describe, expect, it } from 'vitest';
import type { Action, Board, DeckDef } from '../../src/engine/index.ts';
import type { ServerMsg } from '../../src/net/protocol.ts';
import { RoomManager, type Conn } from '../rooms.ts';

/** Conn double that records every message. */
class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  closed = false;
  send(msg: ServerMsg) {
    this.msgs.push(msg);
  }
  close() {
    this.closed = true;
  }
  last(): ServerMsg | undefined {
    return this.msgs[this.msgs.length - 1];
  }
  ofType<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
  }
}

// The server treats decks/boards/actions as opaque JSON; stubs are fine.
const deckA = { id: 'a', name: 'Deck A', list: ['x', 'y'] } as unknown as DeckDef;
const deckB = { id: 'b', name: 'Deck B', list: ['p', 'q'] } as unknown as DeckDef;
const board = [[]] as unknown as Board;
const endTurn = { t: 'EndTurn' } as Action;

function makeLobby() {
  const mgr = new RoomManager();
  const host = new FakeConn();
  const guest = new FakeConn();
  const { code } = mgr.create(host);
  mgr.join(code, guest);
  return { mgr, host, guest, code };
}

function makeStarted() {
  const ctx = makeLobby();
  const { mgr, code } = ctx;
  mgr.handle(code, 0, { t: 'setDeck', deck: deckA });
  mgr.handle(code, 1, { t: 'setDeck', deck: deckB });
  mgr.handle(code, 0, { t: 'setBoard', board, boardName: 'Arena' });
  mgr.handle(code, 0, { t: 'ready', ready: true });
  mgr.handle(code, 1, { t: 'ready', ready: true });
  mgr.handle(code, 0, { t: 'start', orders: [['y', 'x'], ['q', 'p']] });
  return ctx;
}

describe('room creation and joining', () => {
  it('creates a room with a 5-char code and host token', () => {
    const mgr = new RoomManager();
    const host = new FakeConn();
    const { code, seat } = mgr.create(host);
    expect(seat).toBe(0);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    const created = host.ofType('created')[0]!;
    expect(created.code).toBe(code);
    expect(created.token).toHaveLength(16);
  });

  it('joins seat 1 and broadcasts the lobby to both', () => {
    const { host, guest, code } = makeLobby();
    const joined = guest.ofType('joined')[0]!;
    expect(joined.seat).toBe(1);
    expect(joined.code).toBe(code);
    for (const conn of [host, guest]) {
      const lobby = conn.ofType('lobby').at(-1)!.lobby;
      expect(lobby.seats[0].connected).toBe(true);
      expect(lobby.seats[1].connected).toBe(true);
    }
  });

  it('rejects joining a missing or full room', () => {
    const { mgr, code } = makeLobby();
    const c1 = new FakeConn();
    expect(mgr.join('XXXXX', c1)).toBeNull();
    expect(c1.last()).toMatchObject({ t: 'error', code: 'room-not-found' });
    const c2 = new FakeConn();
    expect(mgr.join(code, c2)).toBeNull();
    expect(c2.last()).toMatchObject({ t: 'error', code: 'room-full' });
  });
});

describe('lobby flow and start', () => {
  it('setDeck un-readies the seat and shows in the lobby broadcast', () => {
    const { mgr, guest, code } = makeLobby();
    mgr.handle(code, 1, { t: 'ready', ready: true });
    mgr.handle(code, 1, { t: 'setDeck', deck: deckB });
    const lobby = guest.ofType('lobby').at(-1)!.lobby;
    expect(lobby.seats[1].deck).toEqual(deckB);
    expect(lobby.seats[1].ready).toBe(false);
  });

  it('only the host may set the board', () => {
    const { mgr, guest, code } = makeLobby();
    mgr.handle(code, 1, { t: 'setBoard', board, boardName: 'Nope' });
    expect(guest.last()).toMatchObject({ t: 'error', code: 'not-host' });
  });

  it('start assembles the payload from both decks + board + orders and broadcasts it', () => {
    const { host, guest } = makeStarted();
    for (const conn of [host, guest]) {
      const start = conn.ofType('start')[0]!;
      expect(start.config.decks).toEqual([deckA, deckB]);
      expect(start.config.board).toEqual(board);
      expect(start.config.orders).toEqual([['y', 'x'], ['q', 'p']]);
    }
  });

  it('rejects start from the guest and start before both are ready', () => {
    const { mgr, host, guest, code } = makeLobby();
    mgr.handle(code, 1, { t: 'start', orders: [[], []] });
    expect(guest.last()).toMatchObject({ t: 'error', code: 'not-host' });
    mgr.handle(code, 0, { t: 'setDeck', deck: deckA });
    mgr.handle(code, 1, { t: 'setDeck', deck: deckB });
    mgr.handle(code, 0, { t: 'setBoard', board, boardName: 'Arena' });
    mgr.handle(code, 0, { t: 'ready', ready: true });
    mgr.handle(code, 0, { t: 'start', orders: [[], []] });
    expect(host.last()).toMatchObject({ t: 'error', code: 'not-ready' });
    expect(host.ofType('start')).toHaveLength(0);
  });
});

describe('action relay', () => {
  it('appends in-sequence actions and broadcasts to both seats', () => {
    const { mgr, host, guest, code } = makeStarted();
    mgr.handle(code, 0, { t: 'action', seq: 0, action: endTurn, hash: 123 });
    for (const conn of [host, guest]) {
      expect(conn.ofType('action')[0]).toMatchObject({ seq: 0, action: endTurn, hash: 123 });
    }
    mgr.handle(code, 1, { t: 'action', seq: 1, action: endTurn });
    expect(host.ofType('action')[1]).toMatchObject({ seq: 1 });
  });

  it('rejects an out-of-sequence action with bad-seq plus a fresh sync', () => {
    const { mgr, host, code } = makeStarted();
    mgr.handle(code, 0, { t: 'action', seq: 5, action: endTurn });
    expect(host.ofType('error')[0]).toMatchObject({ code: 'bad-seq' });
    const sync = host.ofType('sync').at(-1)!;
    expect(sync).toMatchObject({ phase: 'game' });
    if (sync.phase === 'game') expect(sync.actions).toEqual([]);
  });
});

describe('disconnect and rejoin', () => {
  it('rejoin with the right token returns config + action log and notifies the peer', () => {
    const { mgr, host, guest, code } = makeStarted();
    mgr.handle(code, 1, { t: 'action', seq: 0, action: endTurn });
    const token = guest.ofType('joined')[0]!.token;
    mgr.disconnect(code, 1);
    expect(host.ofType('peer').at(-1)).toMatchObject({ seat: 1, connected: false });

    const fresh = new FakeConn();
    expect(mgr.rejoin(code, 1, token, fresh)).toEqual({ code, seat: 1 });
    const sync = fresh.ofType('sync')[0]!;
    expect(sync.phase).toBe('game');
    if (sync.phase === 'game') {
      expect(sync.config.decks).toEqual([deckA, deckB]);
      expect(sync.actions).toEqual([endTurn]);
    }
    expect(host.ofType('peer').at(-1)).toMatchObject({ seat: 1, connected: true });
  });

  it('rejects a rejoin with a bad token', () => {
    const { mgr, code } = makeStarted();
    const fresh = new FakeConn();
    expect(mgr.rejoin(code, 1, 'wrong-token-0000', fresh)).toBeNull();
    expect(fresh.last()).toMatchObject({ t: 'error', code: 'bad-token' });
  });

  it('rejoin replaces a zombie connection', () => {
    const { mgr, guest, code } = makeStarted();
    const token = guest.ofType('joined')[0]!.token;
    const fresh = new FakeConn();
    mgr.rejoin(code, 1, token, fresh);
    expect(guest.closed).toBe(true);
  });

  it('host leaving the lobby closes the room for the guest', () => {
    const { mgr, guest, code } = makeLobby();
    mgr.handle(code, 0, { t: 'leave' });
    expect(guest.last()).toMatchObject({ t: 'roomClosed' });
    expect(mgr.size).toBe(0);
  });
});

describe('sweep', () => {
  it('deletes rooms whose seats are all offline past the TTL', () => {
    const { mgr, code } = makeStarted();
    mgr.disconnect(code, 0);
    mgr.disconnect(code, 1);
    expect(mgr.sweep(Date.now() + 29 * 60 * 1000)).toEqual([]);
    expect(mgr.sweep(Date.now() + 31 * 60 * 1000)).toEqual([code]);
    expect(mgr.size).toBe(0);
  });

  it('deletes never-started lobbies after the lobby TTL even while connected', () => {
    const { mgr, host, code } = makeLobby();
    expect(mgr.sweep(Date.now() + 61 * 60 * 1000)).toEqual([code]);
    expect(host.last()).toMatchObject({ t: 'roomClosed' });
  });
});
