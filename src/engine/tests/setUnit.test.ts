// Face-down units (the "universal bluff"): a monster can be Set like a spell/trap.
// Rulings: costs its Level in SP and takes a slot in the 5-unit cap (not the non-unit
// cap); owner flip-summons on a later turn ready to act, same turn it stays sick; an
// enemy attacking a face-down unit flips it up and combat resolves on whatever STANCE
// it was set in (2026-08-16 — being hidden is not a posture).
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, isSick, legalActions } from '../engine';
import { leaderOf, mooreAdjacent, tileAt } from '../board';
import { freshGame, endUntil } from './helpers';
import type { GameState } from '../types';

/** First empty tile in a player's leader summon ring. */
function ringTile(s: GameState, player: 0 | 1) {
  const leader = leaderOf(s, player);
  const c = mooreAdjacent(leader.pos).find((t) => !tileAt(s.board, t).occupant);
  if (!c) throw new Error('no empty ring tile');
  return c;
}

describe('a face-down unit chooses its stance', () => {
  it('legalActions offers BOTH stances for a unit, and none for a spell or trap', () => {
    const s = freshGame();
    s.players[0].hand.push('thornfang', 'verdantSurge');
    s.players[0].sp = 12;
    const acts = legalActions(s);
    const tile = ringTile(s, 0);

    // Without both offers, setting in defense is unreachable for the bots and for the fuzz suite.
    expect(acts).toContainEqual({ t: 'SetCard', card: 'thornfang', tile, stance: 'attack' });
    expect(acts).toContainEqual({ t: 'SetCard', card: 'thornfang', tile, stance: 'defense' });

    // A spell has no posture to hold, so it is offered exactly once and unqualified.
    const spellSets = acts.filter((a) => a.t === 'SetCard' && a.card === 'verdantSurge');
    expect(spellSets.length).toBeGreaterThan(0);
    expect(spellSets.every((a) => a.t === 'SetCard' && a.stance === undefined)).toBe(true);
  });

  it('records the chosen stance on the set card, and defaults to attack', () => {
    let s = freshGame();
    s.players[0].hand.push('thornfang');
    s.players[0].sp = 12;
    s = applyAction(s, { t: 'SetCard', card: 'thornfang', tile: ringTile(s, 0) });
    expect(Object.values(s.setCards).find((c) => c.cardId === 'thornfang')!.stance).toBe('attack');

    let t = freshGame();
    t.players[0].hand.push('thornfang');
    t.players[0].sp = 12;
    t = applyAction(t, { t: 'SetCard', card: 'thornfang', tile: ringTile(t, 0), stance: 'defense' });
    expect(Object.values(t.setCards).find((c) => c.cardId === 'thornfang')!.stance).toBe('defense');
  });
});

describe('setting a unit face-down', () => {
  it('costs its Level in SP, occupies a tile as a face-down card, and spawns no unit yet', () => {
    let s = freshGame();
    s.players[0].hand.push('saplingSentry'); // Verdant, level 2, ATK 20
    const sp = s.players[0].sp;
    const tile = ringTile(s, 0);
    s = applyAction(s, { t: 'SetCard', card: 'saplingSentry', tile });

    expect(s.players[0].sp).toBe(sp - 2); // charged its level, like a summon
    const set = Object.values(s.setCards).find((c) => c.cardId === 'saplingSentry');
    expect(set?.kind).toBe('unit');
    expect(tileAt(s.board, tile).occupant).toEqual({ kind: 'set', id: set!.id });
    // No real unit exists while hidden.
    expect(Object.values(s.units).some((u) => u.cardId === 'saplingSentry')).toBe(false);
  });

  it('logs identically to any other set card — the back never reveals the card', () => {
    let s = freshGame();
    s.players[0].hand.push('thornfang');
    s = applyAction(s, { t: 'SetCard', card: 'thornfang', tile: ringTile(s, 0) });
    const last = s.log.at(-1)!;
    expect(last).toMatch(/set face-down/);
    expect(last).not.toMatch(/Thornfang/); // identity stays hidden
  });

  it('flip-summoning the same turn it was set leaves it summoning-sick', () => {
    let s = freshGame();
    s.players[0].hand.push('saplingSentry');
    const tile = ringTile(s, 0);
    s = applyAction(s, { t: 'SetCard', card: 'saplingSentry', tile });
    const setId = Object.values(s.setCards).find((c) => c.cardId === 'saplingSentry')!.id;
    s = applyAction(s, { t: 'FlipCard', set: setId });

    const u = Object.values(s.units).find((x) => x.cardId === 'saplingSentry')!;
    expect(isSick(u)).toBe(true);
    expect(u.pos).toEqual(tile);
    expect(s.setCards[setId]).toBeUndefined();
  });

  it('flip-summoning on a later turn comes up ready to act', () => {
    let s = freshGame();
    s.players[0].hand.push('saplingSentry');
    s = applyAction(s, { t: 'SetCard', card: 'saplingSentry', tile: ringTile(s, 0) });
    const setId = Object.values(s.setCards).find((c) => c.cardId === 'saplingSentry')!.id;

    s = applyAction(s, { t: 'EndTurn' }); // end P0, then run through P1 back to P0's turn 2
    s = endUntil(s, 0);
    s = applyAction(s, { t: 'FlipCard', set: setId });
    const u = Object.values(s.units).find((x) => x.cardId === 'saplingSentry')!;
    expect(isSick(u)).toBe(false);
  });

  it('an enemy attacking a face-down unit flips it up and resolves combat', () => {
    let s = freshGame();
    const tile = { col: 4, row: 2 };
    const attackerTile = { col: 4, row: 3 };
    tileAt(s.board, tile).terrain = 'Normal'; // strip terrain/passive noise
    tileAt(s.board, attackerTile).terrain = 'Normal';

    s.players[0].hand.push('thornfang'); // Beast, ATK 30
    s = applyAction(s, { t: 'SetCard', card: 'thornfang', tile, stance: 'defense' });
    const setId = Object.values(s.setCards).find((c) => c.cardId === 'thornfang')!.id;

    s = endUntil(s, 1);
    const attacker = debugSpawn(s, 'carrionSwarm', 1, attackerTile); // ATK 15
    s = applyAction(s, { t: 'Move', unit: attacker.id, to: tile });

    // Set in DEFENSE, so Thornfang is fought against its DEF — 15 here, the round(atk/2) fallback
    // the single-stat POC fixtures still use — not its ATK 30. 15 vs 15 is the hold branch: the
    // wall stops the attack and takes nothing, and since a defender never counter-KILLS, the
    // attacker bounces off alive.
    //
    // ⚠ The `stance: 'defense'` above is load-bearing since 2026-08-16. Face-down no longer means
    // defense position; set this card without it and the clash resolves on ATK 30 instead.
    expect(s.setCards[setId]).toBeUndefined();
    const flipped = Object.values(s.units).find((u) => u.cardId === 'thornfang')!;
    expect(flipped.stance).toBe('defense');
    expect(flipped.pos).toEqual(tile); // defender never advances
    expect(s.units[attacker.id]).toBeDefined();
    expect(s.units[attacker.id]!.pos).toEqual(attackerTile); // and never took the tile
  });

  it('set in ATTACK, the same clash resolves on ATK — concealment is not a posture', () => {
    let s = freshGame();
    const tile = { col: 4, row: 2 };
    const attackerTile = { col: 4, row: 3 };
    tileAt(s.board, tile).terrain = 'Normal';
    tileAt(s.board, attackerTile).terrain = 'Normal';

    s.players[0].hand.push('thornfang'); // Beast, ATK 30 / DEF 15
    s = applyAction(s, { t: 'SetCard', card: 'thornfang', tile }); // defaults to attack stance
    s = endUntil(s, 1);
    const attacker = debugSpawn(s, 'carrionSwarm', 1, attackerTile); // ATK 15
    s = applyAction(s, { t: 'Move', unit: attacker.id, to: tile });

    // vs ATK 30 the 15-ATK attacker simply dies — the mirror of the defense case above, and the
    // behaviour the old "face-down IS defense" rule made unreachable.
    const flipped = Object.values(s.units).find((u) => u.cardId === 'thornfang')!;
    expect(flipped.stance).toBe('attack');
    expect(s.units[attacker.id]).toBeUndefined();
  });
});
