// Flanking (adopted 2026-07-17): a unit attacking a unit gains +5 effective ATK
// per other friendly NON-TOKEN unit adjacent to the defender, max +10. Leaders
// neither grant nor receive it; tokens never count as flankers.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn } from '../engine';
import { makeBoard } from '../board';
import { WILDGROWTH_EXTRA_CARDS } from '../content/decks';
import { freshGame } from './helpers';
import type { CardDef, GameState } from '../types';

/**
 * A 30-ATK range-1 shooter, as a LOCAL fixture.
 *
 * ⚠ This used to be Wildgrowth's Skyrender, cut on 2026-08-08 (0.02 ranged attacks per game —
 * range-1 `Ranged` is near-dead text, since retaliation-requires-reach is satisfied by adjacency).
 * No registered deck has a 30-ATK range-1 shooter any more, and the test needs exactly that: a TIE
 * with the defender, so the flank bonus is what breaks it. Owning the fixture keeps the arithmetic
 * independent of whatever the decks happen to field.
 */
/**
 * A plain 30-ATK body, as a LOCAL fixture.
 *
 * ⚠ These tests used to borrow Wildgrowth's Thornfang for "a 30-ATK body", and the 2026-08-08
 * rebuild moved it to 35 — silently turning every flanking TIE into an outright win and breaking
 * five tests at once. Flanking arithmetic must not depend on any deck's current balance.
 */
const BRAWLER: CardDef = {
  kind: 'unit', id: 'brawler', name: 'Brawler', type: 'Beast',
  level: 3, atk: 30, def: 15, dc: 2, keywords: [], rules: [],
};

/** A plain 20-ATK body, so the +10 flanking CAP lands on an exact tie. Same reason as BRAWLER. */
const WHELP: CardDef = {
  kind: 'unit', id: 'whelp', name: 'Whelp', type: 'Beast',
  level: 2, atk: 20, def: 10, dc: 1, keywords: [], rules: [],
};

const SHOOTER: CardDef = {
  kind: 'unit', id: 'shooter', name: 'Shooter', type: 'Avian',
  level: 3, atk: 30, def: 10, dc: 3, keywords: ['Ranged'], rules: [],
};

/** All-Normal board: no terrain mods or terrain-gated auras muddying the arithmetic. */
const flat = () =>
  freshGame({ board: makeBoard(() => 'Normal'), extraCards: { ...WILDGROWTH_EXTRA_CARDS, shooter: SHOOTER, brawler: BRAWLER, whelp: WHELP } });

const leaderOf = (s: GameState, p: 0 | 1) =>
  Object.values(s.units).find((u) => u.isLeader && u.owner === p)!;

describe('flanking — unit vs unit', () => {
  it('baseline sanity: equal ATK with no allies nearby is mutual destruction', () => {
    const s = flat();
    const atk = debugSpawn(s, 'brawler', 0, { col: 4, row: 4 }); // 30
    const def = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 }); // 30
    const end = applyAction(s, { t: 'Move', unit: atk.id, to: def.pos });
    expect(end.units[atk.id]).toBeUndefined();
    expect(end.units[def.id]).toBeUndefined();
  });

  it('one real ally adjacent to the defender turns the tie into a kill (+5)', () => {
    const s = flat();
    const atk = debugSpawn(s, 'brawler', 0, { col: 4, row: 4 }); // 30
    debugSpawn(s, 'whelp', 0, { col: 5, row: 5 }); // flanker beside the defender
    const def = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 }); // 30
    const end = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 5 } });
    expect(end.units[def.id]).toBeUndefined();
    expect(end.units[atk.id]!.pos).toEqual({ col: 4, row: 5 }); // survives and advances
    expect(end.log.some((l) => l.includes('flanks with 1 ally: +5'))).toBe(true);
  });

  it('caps at two allies (+10): three flankers do not stack to +15', () => {
    const s = flat();
    const atk = debugSpawn(s, 'whelp', 0, { col: 4, row: 4 }); // 20
    debugSpawn(s, 'whelp', 0, { col: 5, row: 5 });
    debugSpawn(s, 'whelp', 0, { col: 3, row: 5 });
    debugSpawn(s, 'whelp', 0, { col: 5, row: 4 });
    const def = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 }); // 30
    // 20 + 10 = 30: a tie (mutual destruction). Uncapped +15 would be a clean kill.
    const end = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 5 } });
    expect(end.units[atk.id]).toBeUndefined();
    expect(end.units[def.id]).toBeUndefined();
    expect(end.log.some((l) => l.includes('flanks with 2 allies: +10'))).toBe(true);
  });

  it('tokens do not count as flankers', () => {
    const s = flat();
    const atk = debugSpawn(s, 'brawler', 0, { col: 4, row: 4 }); // 30
    const chaff = debugSpawn(s, 'saplingSentry', 0, { col: 5, row: 5 });
    chaff.isToken = true; // fixture: same body, token flag on
    const def = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 }); // 30
    const end = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 5 } });
    expect(end.units[atk.id]).toBeUndefined(); // still a tie: both die
    expect(end.units[def.id]).toBeUndefined();
    expect(end.log.some((l) => l.includes('flanks'))).toBe(false);
  });

  it('the leader does not count as a flanker', () => {
    const s = flat();
    const briar = leaderOf(s, 0); // starts at (4,1)
    const def = debugSpawn(s, 'duneshambler', 1, { col: briar.pos.col, row: briar.pos.row + 1 }); // 30, beside the leader
    const atk = debugSpawn(s, 'brawler', 0, { col: def.pos.col, row: def.pos.row + 1 }); // 30
    expect(Math.max(Math.abs(briar.pos.col - def.pos.col), Math.abs(briar.pos.row - def.pos.row))).toBe(1);
    const end = applyAction(s, { t: 'Move', unit: atk.id, to: def.pos });
    expect(end.units[atk.id]).toBeUndefined(); // tie: leader adjacency gave nothing
    expect(end.units[def.id]).toBeUndefined();
  });

  it('Ranged attacks flank too', () => {
    const s = flat();
    const atk = debugSpawn(s, 'shooter', 0, { col: 4, row: 4 }); // 30 ATK, range 1 — a tie on stats
    debugSpawn(s, 'saplingSentry', 0, { col: 5, row: 5 });
    const def = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 }); // 30
    const end = applyAction(s, { t: 'RangedAttack', unit: atk.id, target: def.pos });
    expect(end.units[def.id]).toBeUndefined();
    expect(end.units[atk.id]!.pos).toEqual({ col: 4, row: 4 }); // no advance on ranged
  });
});

describe('flanking — leader boundaries', () => {
  it('attacks on a leader get no flanking bonus', () => {
    const s = flat();
    const oskar = leaderOf(s, 1);
    const atk = debugSpawn(s, 'brawler', 0, { col: oskar.pos.col, row: oskar.pos.row - 1 }); // 30
    debugSpawn(s, 'saplingSentry', 0, { col: oskar.pos.col - 1, row: oskar.pos.row }); // adjacent to the leader
    const lpBefore = s.players[1].leaderLife;
    const end = applyAction(s, { t: 'Move', unit: atk.id, to: oskar.pos });
    expect(lpBefore - end.players[1].leaderLife).toBe(30); // 30, not 35
  });
});
