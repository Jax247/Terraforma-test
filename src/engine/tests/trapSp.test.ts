// Setting a trap costs SP (2026-08-09). Traps used to be free — DC was their entire price — which
// made a set a strictly additive play: you could fill the non-unit cap on the same turns you spent
// every point of SP on bodies. The charge lands at SET, not at activation, because a trap springs
// on the OPPONENT's turn, when its owner's pool has already been zeroed.
//
// A mine (a face-down spell that enemy contact can spring) prepays for the same reason, and must
// therefore NOT be billed again if its owner flips it up by hand instead.
//
// Card prices live in the deck files; these fixtures print their own so the rule under test cannot
// be broken by a content tuning pass.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, legalActions } from '../engine';
import { leaderOf, mooreAdjacent, tileAt } from '../board';
import { freshGame, endUntil } from './helpers';
import type { CardDef, Coord, GameState } from '../types';

const CARDS: Record<string, CardDef> = {
  costlyTrap: {
    kind: 'trap', id: 'costlyTrap', name: 'Costly Trap', dc: 3, sp: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{ effect: { e: 'Damage', amount: 20 }, target: { t: 'TriggeringUnit' } }],
  },
  // No printed `sp` — the default is 0, which is what keeps every pre-2026-08-09 fixture legal.
  freeTrap: {
    kind: 'trap', id: 'freeTrap', name: 'Free Trap', dc: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{ effect: { e: 'Damage', amount: 20 }, target: { t: 'TriggeringUnit' } }],
  },
  costlyMine: {
    kind: 'spell', id: 'costlyMine', name: 'Costly Mine', dc: 2, sp: 2, scope: 'located',
    effects: [{ effect: { e: 'Damage', amount: 20 }, target: { t: 'TriggeringUnit' } }],
  },
  // Touches a tile, not the unit that walks onto it — a travelling board spell, not a mine.
  travelSpell: {
    kind: 'spell', id: 'travelSpell', name: 'Travel Spell', dc: 2, sp: 2, scope: 'located',
    effects: [{ effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'ThisTile' } }],
  },
};

const game = () => freshGame({ extraCards: CARDS });

/** First empty tile in a player's leader summon ring. */
function ringTile(s: GameState, player: 0 | 1): Coord {
  const leader = leaderOf(s, player);
  const c = mooreAdjacent(leader.pos).find((t) => !tileAt(s.board, t).occupant);
  if (!c) throw new Error('no empty ring tile');
  return c;
}

const setsOffered = (s: GameState, card: string) =>
  legalActions(s).some((a) => a.t === 'SetCard' && a.card === card);

describe('setting a trap costs SP', () => {
  it('charges the printed price at set', () => {
    let s = game();
    s.players[0].hand.push('costlyTrap');
    const sp = s.players[0].sp;
    s = applyAction(s, { t: 'SetCard', card: 'costlyTrap', tile: ringTile(s, 0) });

    expect(s.players[0].sp).toBe(sp - 2);
    expect(Object.values(s.setCards).some((c) => c.cardId === 'costlyTrap')).toBe(true);
  });

  it('still logs identically — paying for the back must not reveal what it is', () => {
    let s = game();
    s.players[0].hand.push('costlyTrap');
    s = applyAction(s, { t: 'SetCard', card: 'costlyTrap', tile: ringTile(s, 0) });
    const last = s.log.at(-1)!;
    expect(last).toMatch(/set face-down/);
    expect(last).not.toMatch(/Costly Trap/);
  });

  it('refuses the set — and never offers it — when the SP is not there', () => {
    let s = game();
    s.players[0].hand.push('costlyTrap');
    s.players[0].sp = 1;
    expect(setsOffered(s, 'costlyTrap')).toBe(false);
    expect(() => applyAction(s, { t: 'SetCard', card: 'costlyTrap', tile: ringTile(s, 0) }))
      .toThrow(/not enough SP/);

    s.players[0].sp = 2; // exactly affordable
    expect(setsOffered(s, 'costlyTrap')).toBe(true);
    s = applyAction(s, { t: 'SetCard', card: 'costlyTrap', tile: ringTile(s, 0) });
    expect(s.players[0].sp).toBe(0);
  });

  it('leaves a trap with no printed price free, so older content still sets at 0', () => {
    let s = game();
    s.players[0].hand.push('freeTrap');
    s.players[0].sp = 0;
    expect(setsOffered(s, 'freeTrap')).toBe(true);
    s = applyAction(s, { t: 'SetCard', card: 'freeTrap', tile: ringTile(s, 0) });
    expect(s.players[0].sp).toBe(0);
  });

  it('costs nothing more when it FIRES on the opponent turn — the set was the whole bill', () => {
    let s = game();
    s.players[0].hand.push('costlyTrap');
    const trapTile = { col: 4, row: 4 };
    tileAt(s.board, trapTile).occupant = undefined;
    // Set it by hand: the summon ring is nowhere near the victim, and the point under test is
    // what the ACTIVATION costs, not where a trap may be placed.
    s = applyAction(s, { t: 'SetCard', card: 'costlyTrap', tile: ringTile(s, 0) });
    const trap = Object.values(s.setCards).find((c) => c.cardId === 'costlyTrap')!;
    tileAt(s.board, trap.pos).occupant = undefined;
    trap.pos = trapTile;
    tileAt(s.board, trapTile).occupant = { kind: 'set', id: trap.id };

    s = endUntil(s, 1);
    const victim = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 6 }); // ATK 15, one step out
    const lifeBefore = s.players[1].leaderLife;
    s.players[1].sp = 0; // the trap owner is not the one acting, and nobody has SP to give
    s = applyAction(s, { t: 'Move', unit: victim.id, to: { col: 4, row: 5 } });

    expect(s.log.some((l) => /trap Costly Trap fires/.test(l))).toBe(true);
    expect(s.setCards[trap.id]).toBeUndefined(); // consumed
    expect(s.players[0].sp).toBe(0); // the owner's pool was zeroed at end of turn and stayed there
    expect(s.players[1].sp).toBe(0); // and the victim paid nothing for being caught
    expect(s.players[1].leaderLife).toBe(lifeBefore);
  });
});

describe('a mine prepays at set', () => {
  it('charges its spell SP when set, then springs on contact for free', () => {
    let s = game();
    s.players[0].hand.push('costlyMine');
    const sp = s.players[0].sp;
    const mineTile = ringTile(s, 0);
    s = applyAction(s, { t: 'SetCard', card: 'costlyMine', tile: mineTile });
    expect(s.players[0].sp).toBe(sp - 2);

    const set = Object.values(s.setCards).find((c) => c.cardId === 'costlyMine')!;
    s = endUntil(s, 1);
    const victim = debugSpawn(s, 'carrionSwarm', 1, { col: mineTile.col, row: mineTile.row + 1 });
    s.players[1].sp = 0;
    s = applyAction(s, { t: 'Move', unit: victim.id, to: mineTile });

    expect(s.setCards[set.id]).toBeUndefined();
    expect(s.log.some((l) => /steps onto Costly Mine/.test(l))).toBe(true);
  });

  it('is not billed a second time when its owner flips it up by hand', () => {
    let s = game();
    s.players[0].hand.push('costlyMine');
    s.players[0].sp = 2; // exactly one mine's worth
    const tile = ringTile(s, 0);
    s = applyAction(s, { t: 'SetCard', card: 'costlyMine', tile });
    const setId = Object.values(s.setCards).find((c) => c.cardId === 'costlyMine')!.id;
    expect(s.players[0].sp).toBe(0);

    // Broke at set — so a flip must still be legal and must still resolve at 0 SP.
    expect(legalActions(s).some((a) => a.t === 'FlipCard' && a.set === setId)).toBe(true);
    s = applyAction(s, { t: 'FlipCard', set: setId });
    expect(s.players[0].sp).toBe(0);
    expect(s.setCards[setId]).toBeUndefined();
    expect(s.players[0].graveyard).toContain('costlyMine');
  });
});

describe('a travelling board spell is unchanged — it sets free and pays at flip', () => {
  it('takes no SP at set and the full price at activation', () => {
    let s = game();
    s.players[0].hand.push('travelSpell');
    s.players[0].sp = 2;
    const tile = ringTile(s, 0);
    s = applyAction(s, { t: 'SetCard', card: 'travelSpell', tile });
    expect(s.players[0].sp).toBe(2); // free to set: it can only ever be activated by its owner

    s = applyAction(s, { t: 'FlipCard', set: Object.values(s.setCards).find((c) => c.cardId === 'travelSpell')!.id });
    expect(s.players[0].sp).toBe(0);
    expect(tileAt(s.board, tile).terrain).toBe('Forest');
  });

  it('is not offered as a flip when its SP is gone, though the set itself was free', () => {
    let s = game();
    s.players[0].hand.push('travelSpell');
    s = applyAction(s, { t: 'SetCard', card: 'travelSpell', tile: ringTile(s, 0) });
    const setId = Object.values(s.setCards).find((c) => c.cardId === 'travelSpell')!.id;
    s.players[0].sp = 1;
    expect(legalActions(s).some((a) => a.t === 'FlipCard' && a.set === setId)).toBe(false);
  });
});
