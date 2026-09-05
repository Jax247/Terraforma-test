import { describe, expect, it } from 'vitest';
import type { Action, Board, DeckDef } from '../../src/engine/index.ts';
import type { ServerMsg } from '../../src/net/protocol.ts';
import { RoomManager, type Conn } from '../rooms.ts';
import { MemoryRoomStore, type RoomSnapshot, type RoomStore } from '../store.ts';

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  closed = false;
  send(msg: ServerMsg) {
    this.msgs.push(msg);
  }
  close() {
    this.closed = true;
  }
  ofType<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
  }
}

/** Every write throws. Proves a dead database degrades rather than taking games down. */
class FailingStore implements RoomStore {
  degraded = true;
  load(): Promise<{ room: RoomSnapshot; actions: Action[] }[]> {
    return Promise.reject(new Error('db down'));
  }
  save(): void {
    throw new Error('db down');
  }
  appendAction(): void {
    throw new Error('db down');
  }
  remove(): void {
    throw new Error('db down');
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
}

const deckA = { id: 'a', name: 'Deck A', list: ['x', 'y'] } as unknown as DeckDef;
const deckB = { id: 'b', name: 'Deck B', list: ['p', 'q'] } as unknown as DeckDef;
const board = [[]] as unknown as Board;
const endTurn = { t: 'EndTurn' } as Action;

/** Drive a room all the way to a started game with some moves played. */
function playSome(store: RoomStore) {
  const mgr = new RoomManager(store);
  const host = new FakeConn();
  const guest = new FakeConn();
  const { code } = mgr.create(host);
  mgr.join(code, guest);
  mgr.handle(code, 0, { t: 'setDeck', deck: deckA });
  mgr.handle(code, 1, { t: 'setDeck', deck: deckB });
  mgr.handle(code, 0, { t: 'setBoard', board, boardName: 'Arena' });
  mgr.handle(code, 0, { t: 'ready', ready: true });
  mgr.handle(code, 1, { t: 'ready', ready: true });
  mgr.handle(code, 0, { t: 'start', orders: [['x'], ['p']] });
  mgr.handle(code, 0, { t: 'action', seq: 0, action: endTurn });
  mgr.handle(code, 1, { t: 'action', seq: 1, action: endTurn });
  return { mgr, host, guest, code };
}

describe('RoomStore seam', () => {
  it('defaults to an in-memory store, so existing callers need no database', () => {
    const mgr = new RoomManager();
    const host = new FakeConn();
    expect(mgr.create(host).code).toHaveLength(5);
  });

  it('a store whose every write throws does not break play', () => {
    // The point of the contract: games keep running, they just stop being durable.
    expect(() => playSome(new FailingStore())).not.toThrow();
  });
});

describe('surviving a restart', () => {
  it('rehydrates a game in progress with its config and full action log', async () => {
    const store = new MemoryRoomStore();
    const { host, code } = playSome(store);
    const hostToken = host.ofType('created')[0]!.token;
    await store.flush();

    // A brand-new manager over the same store is what a redeployed process looks like.
    const revived = new RoomManager(store);
    expect(await revived.rehydrate()).toBe(1);
    expect(revived.size).toBe(1);

    // The returning player must land on the same state the old server would have sent.
    const after = new FakeConn();
    revived.rejoin(code, 0, hostToken, after);

    const sync = after.ofType('sync')[0]!;
    expect(sync.phase).toBe('game');
    if (sync.phase !== 'game') throw new Error('expected a game sync');
    expect(sync.actions).toEqual([endTurn, endTurn]);
    expect(sync.config.decks).toEqual([deckA, deckB]);
    expect(sync.config.orders).toEqual([['x'], ['p']]);
  });

  it('accepts the original seat token after a restart, because tokens are derived not stored', async () => {
    const store = new MemoryRoomStore();
    const { guest, code } = playSome(store);
    const token = guest.ofType('joined')[0]!.token;
    await store.flush();

    const revived = new RoomManager(store);
    await revived.rehydrate();

    const fresh = new FakeConn();
    // The token was minted by a process that no longer exists and was never persisted.
    expect(revived.rejoin(code, 1, token, fresh)).toEqual({ code, seat: 1 });
    expect(fresh.ofType('sync')).toHaveLength(1);
  });

  it('rejects a forged token after a restart', async () => {
    const store = new MemoryRoomStore();
    const { code } = playSome(store);
    await store.flush();
    const revived = new RoomManager(store);
    await revived.rehydrate();

    const fresh = new FakeConn();
    expect(revived.rejoin(code, 1, 'not-a-real-token-abc', fresh)).toBeNull();
    expect(fresh.ofType('error')[0]?.code).toBe('bad-token');
  });

  it('keeps the original lastActivity, so a nearly-expired room still expires on time', async () => {
    const store = new MemoryRoomStore();
    const { code } = playSome(store);
    await store.flush();

    const revived = new RoomManager(store);
    await revived.rehydrate();

    // 25 minutes of idling happened BEFORE the restart. Stamping `now` on load would hand the
    // room a fresh 30-minute lease; keeping the original means it has 5 minutes left.
    expect(revived.sweep(Date.now() + 25 * 60 * 1000)).toEqual([]);
    expect(revived.sweep(Date.now() + 31 * 60 * 1000)).toEqual([code]);
  });

  it('a closed room is removed from the store and does not come back', async () => {
    const store = new MemoryRoomStore();
    const { mgr, code } = playSome(store);
    // The TTL only reclaims rooms nobody is connected to, so vacate both seats first.
    mgr.disconnect(code, 0);
    mgr.disconnect(code, 1);
    mgr.sweep(Date.now() + 31 * 60 * 1000);
    await store.flush();

    const revived = new RoomManager(store);
    expect(await revived.rehydrate()).toBe(0);
    expect(revived.size).toBe(0);
  });

  it('a lobby that never started rehydrates as a lobby', async () => {
    const store = new MemoryRoomStore();
    const mgr = new RoomManager(store);
    const host = new FakeConn();
    const { code } = mgr.create(host);
    mgr.join(code, new FakeConn());
    mgr.handle(code, 0, { t: 'setBoard', board, boardName: 'Arena' });
    mgr.handle(code, 0, { t: 'setDeck', deck: deckA });
    const hostToken = host.ofType('created')[0]!.token;
    await store.flush();

    const revived = new RoomManager(store);
    await revived.rehydrate();
    const fresh = new FakeConn();
    revived.rejoin(code, 0, hostToken, fresh);

    const sync = fresh.ofType('sync')[0]!;
    expect(sync.phase).toBe('lobby');
    if (sync.phase !== 'lobby') throw new Error('expected a lobby sync');
    // Seat 1 was taken but had no deck: the guest must still be seated after the restart.
    expect(sync.lobby.seats[1]!.connected).toBe(false);
    expect(sync.lobby.boardName).toBe('Arena');
    expect(sync.lobby.seats[0]!.deck).toEqual(deckA);
  });
});
