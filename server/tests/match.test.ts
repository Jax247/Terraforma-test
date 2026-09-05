import { describe, expect, it } from 'vitest';
import { DECKS, legalActions, makeArenaBoard } from '../../src/engine/index.ts';
import type { Action } from '../../src/engine/index.ts';
import type { ServerMsg } from '../../src/net/protocol.ts';
import { stateFingerprint } from '../../src/net/protocol.ts';
import { applyIntent, buildMatch, materialize, turnOwner } from '../match.ts';
import { RoomManager, type Conn } from '../rooms.ts';

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  send(m: ServerMsg) {
    this.msgs.push(m);
  }
  close() {}
  ofType<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
  }
}

const board = makeArenaBoard();
const deckA = DECKS[0]!;
const deckB = DECKS[1]!;

const config = () => ({
  decks: [deckA, deckB] as [typeof deckA, typeof deckB],
  board,
  orders: [[...deckA.list], [...deckB.list]] as [string[], string[]],
});

/** Drive a real room to a started game with two real decks. */
function startedRoom() {
  const mgr = new RoomManager();
  const host = new FakeConn();
  const guest = new FakeConn();
  const { code } = mgr.create(host);
  mgr.join(code, guest);
  mgr.handle(code, 0, { t: 'setDeck', deck: deckA });
  mgr.handle(code, 1, { t: 'setDeck', deck: deckB });
  mgr.handle(code, 0, { t: 'setBoard', board, boardName: 'Arena' });
  mgr.handle(code, 0, { t: 'ready', ready: true });
  mgr.handle(code, 1, { t: 'ready', ready: true });
  mgr.handle(code, 0, { t: 'start' });
  return { mgr, host, guest, code };
}

describe('the server models the game', () => {
  it('builds the same state a client would, so the fingerprint agrees', () => {
    // If these ever diverge the canary fires on the first action of every online game, so
    // this test is the thing standing between a build and a wall of false alarms.
    const a = buildMatch(config());
    const b = buildMatch(config());
    expect(stateFingerprint(a)).toBe(stateFingerprint(b));
  });

  it('replays a log to the same state as applying it step by step', () => {
    let m = materialize(config(), []);
    const taken: Action[] = [];
    for (let i = 0; i < 12; i++) {
      const legal = legalActions(m.state);
      const action = legal[0];
      if (!action) break;
      const r = applyIntent(m, turnOwner(m.state), action);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      m = { state: r.state, applied: m.applied + 1 };
      taken.push(action);
    }
    expect(stateFingerprint(materialize(config(), taken).state)).toBe(stateFingerprint(m.state));
  });

  it('names the forced-burn player as the turn owner, not the active player', () => {
    const m = materialize(config(), []);
    // With no burn pending the two agree; the point is that turnOwner consults pendingBurn at
    // all, because rejecting a legal forced burn would be worse than the cheating it stops.
    expect(turnOwner(m.state)).toBe(m.state.active);
    const pending = { ...m.state, pendingBurn: { player: 1 as const, remainingDraws: 1 } };
    expect(turnOwner(pending)).toBe(1);
  });
});

describe('validating actions', () => {
  it('accepts a legal action', () => {
    const m = materialize(config(), []);
    const legal = legalActions(m.state)[0]!;
    expect(applyIntent(m, turnOwner(m.state), legal).ok).toBe(true);
  });

  it('refuses an action from the seat whose turn it is not', () => {
    const m = materialize(config(), []);
    const legal = legalActions(m.state)[0]!;
    const other = turnOwner(m.state) === 0 ? 1 : 0;
    const r = applyIntent(m, other, legal);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not your turn/i);
  });

  it('refuses a fabricated action the engine rejects', () => {
    const m = materialize(config(), []);
    // A move from a tile holding nothing: the shape is valid, the move is not.
    const bogus = { t: 'Move', unitId: 'no-such-unit', to: { c: 0, r: 0 } } as unknown as Action;
    const r = applyIntent(m, turnOwner(m.state), bogus);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });

  it('leaves the match untouched when it refuses', () => {
    const m = materialize(config(), []);
    const before = stateFingerprint(m.state);
    applyIntent(m, turnOwner(m.state), { t: 'BurnCard', index: 99 } as Action);
    expect(stateFingerprint(m.state)).toBe(before);
  });
});

describe('the relay enforces it', () => {
  it('shuffles both decks itself rather than trusting the host', () => {
    const { host } = startedRoom();
    const start = host.ofType('start')[0]!;
    expect([...start.config.orders[0]].sort()).toEqual([...deckA.list].sort());
    expect([...start.config.orders[1]].sort()).toEqual([...deckB.list].sort());
  });

  it('relays a legal action', () => {
    const { mgr, host, guest, code } = startedRoom();
    const cfg = host.ofType('start')[0]!.config;
    const m = materialize(cfg, []);
    const legal = legalActions(m.state)[0]!;
    mgr.handle(code, turnOwner(m.state), { t: 'action', seq: 0, action: legal });
    expect(guest.ofType('action')).toHaveLength(1);
  });

  it('refuses an illegal action and resyncs the sender instead of relaying it', () => {
    const { mgr, host, guest, code } = startedRoom();
    const bogus = { t: 'Move', unitId: 'ghost', to: { c: 0, r: 0 } } as unknown as Action;
    mgr.handle(code, 0, { t: 'action', seq: 0, action: bogus });

    expect(host.ofType('error').map((e) => e.code)).toContain('bad-action');
    // The point of the phase: the opponent never sees it.
    expect(guest.ofType('action')).toHaveLength(0);
    // And the offender is put back on the truth rather than left diverged.
    expect(host.ofType('sync').length).toBeGreaterThan(0);
  });

  it('refuses an action played out of turn', () => {
    const { mgr, host, guest, code } = startedRoom();
    const cfg = host.ofType('start')[0]!.config;
    const m = materialize(cfg, []);
    const legal = legalActions(m.state)[0]!;
    const wrongSeat = turnOwner(m.state) === 0 ? 1 : 0;
    mgr.handle(code, wrongSeat, { t: 'action', seq: 0, action: legal });
    expect(guest.ofType('action')).toHaveLength(0);
  });

  it('keeps relaying when a game cannot be modelled at all', () => {
    // Stub decks cannot build a GameState. Validation is an addition to the relay, not a
    // precondition for it, so the room must still work.
    const mgr = new RoomManager();
    const host = new FakeConn();
    const guest = new FakeConn();
    const { code } = mgr.create(host);
    mgr.join(code, guest);
    mgr.handle(code, 0, { t: 'setDeck', deck: { id: 'a', name: 'A', list: ['x'] } as never });
    mgr.handle(code, 1, { t: 'setDeck', deck: { id: 'b', name: 'B', list: ['p'] } as never });
    mgr.handle(code, 0, { t: 'setBoard', board: [[]] as never, boardName: 'X' });
    mgr.handle(code, 0, { t: 'ready', ready: true });
    mgr.handle(code, 1, { t: 'ready', ready: true });
    mgr.handle(code, 0, { t: 'start' });
    mgr.handle(code, 0, { t: 'action', seq: 0, action: { t: 'EndTurn' } });
    expect(guest.ofType('action')).toHaveLength(1);
  });
});
