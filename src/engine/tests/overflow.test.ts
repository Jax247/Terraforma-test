// Combat overflow (adopted 2026-07-18): when a unit beats a unit, the winner's
// effective-ATK margin (winner − loser, flank included) is dealt to the LOSING
// unit's owner's LP pool. Ties still mutual-destruct (0 margin). Leader combat
// is untouched. See Combat Resolution.md.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn } from '../engine';
import { RULES } from '../rules';
import { makeBoard } from '../board';
import { WILDGROWTH_EXTRA_CARDS } from '../content/decks';
import { freshGame } from './helpers';
import type { CardDef } from '../types';

/**
 * ⚠ OWNED fixtures, not borrowed deck cards. These tests used Wildgrowth's Thornfang (30) and
 * Sapling Sentry (20) as "a 30" and "a 20"; the 2026-08-08 rebuild moved them to 35 and 25, which
 * turned the tie case into a win and — worse — left the MARGIN cases passing by coincidence, since
 * 35-25 is also 10. Overflow arithmetic must not depend on any deck's current balance.
 */
const BRAWLER: CardDef = {
  kind: 'unit', id: 'brawler', name: 'Brawler', type: 'Beast',
  level: 3, atk: 30, def: 15, dc: 2, keywords: [], rules: [],
};
const WHELP: CardDef = {
  kind: 'unit', id: 'whelp', name: 'Whelp', type: 'Beast',
  level: 2, atk: 20, def: 10, dc: 1, keywords: [], rules: [],
};

/** All-Normal board so no terrain mods perturb the ATK arithmetic. */
const flat = () =>
  freshGame({
    board: makeBoard(() => 'Normal'),
    extraCards: { ...WILDGROWTH_EXTRA_CARDS, brawler: BRAWLER, whelp: WHELP },
  });

describe('combat overflow — unit vs unit', () => {
  it('aggressor wins: margin spills to the defender-owner LP pool', () => {
    const s = flat();
    const atk = debugSpawn(s, 'brawler', 0, { col: 4, row: 4 }); // 30
    const def = debugSpawn(s, 'whelp', 1, { col: 4, row: 5 }); // 20, no flankers
    const end = applyAction(s, { t: 'Move', unit: atk.id, to: def.pos });
    expect(end.units[def.id]).toBeUndefined(); // 30 > 20: defender dies
    expect(end.units[atk.id]!.pos).toEqual({ col: 4, row: 5 }); // survives and advances
    expect(end.players[1].leaderLife).toBe(RULES.startingLife - 10); // margin 30-20
    expect(end.players[0].leaderLife).toBe(RULES.startingLife); // winner's owner untouched
  });

  it('defender wins the strikeback: margin spills to the attacker-owner LP pool', () => {
    const s = flat();
    const atk = debugSpawn(s, 'whelp', 0, { col: 4, row: 4 }); // 20
    const def = debugSpawn(s, 'brawler', 1, { col: 4, row: 5 }); // 30, no flankers
    const end = applyAction(s, { t: 'Move', unit: atk.id, to: def.pos });
    expect(end.units[atk.id]).toBeUndefined(); // 20 < 30: attacker dies
    expect(end.units[def.id]!.pos).toEqual({ col: 4, row: 5 }); // defender holds
    expect(end.players[0].leaderLife).toBe(RULES.startingLife - 10); // margin 30-20
    expect(end.players[1].leaderLife).toBe(RULES.startingLife); // winner's owner untouched
  });

  it('flank bonus is included in the spilled margin', () => {
    const s = flat();
    const atk = debugSpawn(s, 'whelp', 0, { col: 4, row: 4 }); // 20
    debugSpawn(s, 'whelp', 0, { col: 5, row: 5 }); // +5 flanker beside the defender
    const def = debugSpawn(s, 'whelp', 1, { col: 4, row: 5 }); // 20
    const end = applyAction(s, { t: 'Move', unit: atk.id, to: def.pos });
    expect(end.units[def.id]).toBeUndefined(); // 20+5 > 20
    expect(end.players[1].leaderLife).toBe(RULES.startingLife - 5); // margin (20+5)-20
  });

  it('tie is mutual destruction with no LP spill', () => {
    const s = flat();
    const atk = debugSpawn(s, 'brawler', 0, { col: 4, row: 4 }); // 30
    const def = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 }); // 30, no flankers
    const end = applyAction(s, { t: 'Move', unit: atk.id, to: def.pos });
    expect(end.units[atk.id]).toBeUndefined();
    expect(end.units[def.id]).toBeUndefined();
    expect(end.players[0].leaderLife).toBe(RULES.startingLife);
    expect(end.players[1].leaderLife).toBe(RULES.startingLife);
  });
});
