// Simulation 8 — Traps, Chain, Mines & Ascension (Duskweave vs Vanguard).
// The LIFO before-completion chain, negate-vs-respond, pinpoint mines, universal bluff.
import { describe, expect, it } from 'vitest';
import { makeBoard, tileAt } from '../board';
import { effectiveAtk } from '../stats';
import { applyAction, debugSpawn } from '../engine';
import { freshGame, endUntil, teleport } from './helpers';
import { DUSKWEAVE_CARDS, RURIK, VAEL, VANGUARD_CARDS } from '../content/simDecks';
import type { GameState } from '../types';

// P1 = Vanguard (Rurik, the aggressor); P2 = Duskweave (Vael, the trap player).
function duskweaveGame(): GameState {
  return freshGame({
    board: makeBoard(),
    leaders: [RURIK, VAEL],
    extraCards: { ...DUSKWEAVE_CARDS, ...VANGUARD_CARDS },
  });
}

/** P2 sets a card near Vael, then play returns to P1. */
function p2Sets(s: GameState, cardId: string, tile: { col: number; row: number }): GameState {
  let cur = endUntil(s, 1);
  cur.players[1].hand.push(cardId);
  cur = applyAction(cur, { t: 'SetCard', card: cardId, tile });
  return endUntil(cur, 0);
}

describe('Sim 8 — mines are pinpoint, contact-triggered, one-shot', () => {
  it('stepping on the EXACT tile triggers Hex Mine: 25 → 5 this turn, mine consumed', () => {
    let s = duskweaveGame();
    const sk = debugSpawn(s, 'skirmisher', 0, { col: 3, row: 6 });
    s = p2Sets(s, 'hexMine', { col: 4, row: 6 });
    s = applyAction(s, { t: 'Move', unit: sk.id, to: { col: 4, row: 6 } });
    const hit = s.units[sk.id]!;
    expect(hit.pos).toEqual({ col: 4, row: 6 });          // move completed onto the freed tile
    expect(effectiveAtk(s, hit)).toBe(5);                 // 25 − 20
    expect(s.players[1].graveyard).toContain('hexMine');  // consumed
    // "This turn": the debuff expires at end of turn.
    s = applyAction(s, { t: 'EndTurn' });
    expect(effectiveAtk(s, s.units[sk.id]!)).toBe(25);
  });

  it('one tile over = nothing (pinpoint, unlike the 9-tile trap zone)', () => {
    let s = duskweaveGame();
    const sk = debugSpawn(s, 'skirmisher', 0, { col: 3, row: 5 });
    s = p2Sets(s, 'hexMine', { col: 4, row: 6 });
    s = applyAction(s, { t: 'Move', unit: sk.id, to: { col: 3, row: 6 } }); // adjacent to the mine
    expect(effectiveAtk(s, s.units[sk.id]!)).toBe(25);
    expect(Object.keys(s.setCards).length).toBe(1); // mine still armed
  });

  it('mines are friend-or-foe: your own unit springs your own mine', () => {
    let s = duskweaveGame();
    s = endUntil(s, 1);
    s.players[1].hand.push('hexMine');
    s = applyAction(s, { t: 'SetCard', card: 'hexMine', tile: { col: 4, row: 6 } });
    const own = debugSpawn(s, 'hexblade', 1, { col: 3, row: 6 });
    s = applyAction(s, { t: 'Move', unit: own.id, to: { col: 4, row: 6 } });
    expect(effectiveAtk(s, s.units[own.id]!)).toBe(10); // 30 − 20: route around your own hazards
  });
});

describe('Sim 8 — the LIFO before-completion chain', () => {
  it('respond trap: Snare fires first, the paused attack still completes, stun bites next turn', () => {
    let s = duskweaveGame();
    const legionnaire = debugSpawn(s, 'legionnaire', 0, { col: 3, row: 5 });
    const hexblade = debugSpawn(s, 'hexblade', 1, { col: 3, row: 6 });
    s = p2Sets(s, 'shadowSnare', { col: 4, row: 6 }); // zone covers (3,6)

    s = applyAction(s, { t: 'Move', unit: legionnaire.id, to: { col: 3, row: 6 } });
    // Chain resolved LIFO: Snare (stun) → then the attack completes: 45 > 30.
    expect(s.units[hexblade.id]).toBeUndefined();
    const leg = s.units[legionnaire.id]!;
    expect(leg.pos).toEqual({ col: 3, row: 6 });                       // advance-on-kill still happened
    expect(leg.statuses.some((st) => st.kind === 'Stunned')).toBe(true);
    expect(s.players[1].graveyard).toContain('shadowSnare');           // trap consumed on activation

    // Next P1 turn: no move (the status costs the victim its own activations).
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(() => applyAction(s, { t: 'Move', unit: legionnaire.id, to: { col: 3, row: 5 } }))
      .toThrow(/cannot move/);
    // ...and the turn after that too: turnsLeft 2 costs the victim exactly TWO of its own
    // activations, per the locked duration rule in the vault's Non-Unit Cards.
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(() => applyAction(s, { t: 'Move', unit: legionnaire.id, to: { col: 3, row: 5 } }))
      .toThrow(/cannot move/);
    // The third turn, it has expired.
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    s = applyAction(s, { t: 'Move', unit: legionnaire.id, to: { col: 3, row: 5 } });
    expect(s.units[legionnaire.id]!.pos).toEqual({ col: 3, row: 5 });
  });

  it('negate trap: Spike Pit destroys the attacker and the attack NEVER completes', () => {
    let s = duskweaveGame();
    const legionnaire = debugSpawn(s, 'legionnaire', 0, { col: 3, row: 5 });
    const hexblade = debugSpawn(s, 'hexblade', 1, { col: 3, row: 6 });
    s = p2Sets(s, 'spikePit', { col: 5, row: 6 }); // condition trap: no zone requirement

    s = applyAction(s, { t: 'Move', unit: legionnaire.id, to: { col: 3, row: 6 } });
    expect(s.units[legionnaire.id]).toBeUndefined(); // destroyed before striking
    expect(s.units[hexblade.id]).toBeDefined();      // the 45-vs-30 kill never resolved
    expect(s.units[hexblade.id]!.pos).toEqual({ col: 3, row: 6 });
  });

  it('a trap activation is NOT a spell activation: Mirror Trap does not chain off Shadow Snare', () => {
    let s = duskweaveGame();
    const legionnaire = debugSpawn(s, 'legionnaire', 0, { col: 3, row: 5 });
    debugSpawn(s, 'hexblade', 1, { col: 3, row: 6 });
    s = p2Sets(s, 'shadowSnare', { col: 4, row: 6 });
    s = p2Sets(s, 'mirrorTrap', { col: 5, row: 6 }); // parked in Vael's zone

    s = applyAction(s, { t: 'Move', unit: legionnaire.id, to: { col: 3, row: 6 } });
    // Snare fired; Mirror Trap is still armed — trap ≠ spell.
    expect(s.players[1].graveyard).toContain('shadowSnare');
    expect(s.players[1].graveyard).not.toContain('mirrorTrap');
    expect(Object.values(s.setCards).some((c) => c.cardId === 'mirrorTrap')).toBe(true);
  });

  it('Mirror Trap negates an actual enemy SPELL and draws', () => {
    let s = duskweaveGame();
    s = p2Sets(s, 'mirrorTrap', { col: 4, row: 6 });
    const deckBefore = s.players[1].hand.length;
    s.players[0].hand.push('verdantSurge'); // Vanguard techs a spell
    s = applyAction(s, {
      t: 'CastSpell',
      card: 'verdantSurge',
      targets: [{ col: 3, row: 2 }, { col: 4, row: 2 }, { col: 5, row: 2 }],
    });
    expect(tileAt(s.board, { col: 4, row: 2 }).terrain).toBe('Normal'); // negated: never resolved
    expect(s.players[0].graveyard).toContain('verdantSurge');           // spent anyway
    expect(s.players[1].hand.length).toBe(deckBefore + 1);              // the chained draw
    expect(s.players[1].graveyard).toContain('mirrorTrap');
  });
});

describe('Sim 8 — universal bluff & face-down uniformity', () => {
  it('set spells and traps are indistinguishable state-side: same SetCard shape', () => {
    let s = duskweaveGame();
    s = endUntil(s, 1);
    teleport(s, 'leader1', { col: 4, row: 6 }); // Vael forward: a full 8-tile ring to set into
    s.players[1].hand.push('hexMine', 'shadowSnare', 'mirrorTrap');
    s = applyAction(s, { t: 'SetCard', card: 'hexMine', tile: { col: 3, row: 5 } });
    s = applyAction(s, { t: 'SetCard', card: 'shadowSnare', tile: { col: 4, row: 5 } });
    s = applyAction(s, { t: 'SetCard', card: 'mirrorTrap', tile: { col: 5, row: 5 } });
    // Three identical face-down pieces on the board; identity hidden, position telegraphed.
    expect(Object.keys(s.setCards).length).toBe(3);
    // The non-unit cap counts them all (committed resources — no throwaway bluffs).
    s.players[1].hand.push('hexMine', 'hexMine', 'shadowSnare');
    s = applyAction(s, { t: 'SetCard', card: 'hexMine', tile: { col: 3, row: 6 } });
    s = applyAction(s, { t: 'SetCard', card: 'hexMine', tile: { col: 5, row: 6 } });
    expect(() => applyAction(s, { t: 'SetCard', card: 'shadowSnare', tile: { col: 3, row: 7 } }))
      .toThrow(/non-unit cap/);
  });

  it('face-down set cards move like units; moving a trap into an enemy does not trigger it', () => {
    let s = duskweaveGame();
    const leg = debugSpawn(s, 'legionnaire', 0, { col: 4, row: 4 });
    s = endUntil(s, 1);
    s.players[1].hand.push('shadowSnare');
    s = applyAction(s, { t: 'SetCard', card: 'shadowSnare', tile: { col: 4, row: 6 } });
    const setId = Object.values(s.setCards).find((c) => c.cardId === 'shadowSnare')!.id;
    s = applyAction(s, { t: 'MoveSet', set: setId, to: { col: 4, row: 5 } }); // now adjacent to the enemy
    // Nothing fires — traps are purely the opponent's to spring.
    expect(Object.values(s.setCards).some((c) => c.cardId === 'shadowSnare')).toBe(true);
    expect(s.units[leg.id]!.statuses).toEqual([]);
  });
});

describe('Sim 8 — Ascension mid-game', () => {
  it('Doomshift: permanent Transform, huge swing and a huge removal target', () => {
    let s = duskweaveGame();
    tileAt(s.board, { col: 4, row: 6 }).terrain = 'Shadow';
    const hexblade = debugSpawn(s, 'hexblade', 1, { col: 4, row: 6 });
    s = endUntil(s, 1);
    s.players[1].hand.push('doomshift');
    s = applyAction(s, { t: 'CastSpell', card: 'doomshift', targets: [{ col: 4, row: 6 }] });
    // Standing on Shadow: 60 + 10 terrain + 10 Vael passive = 80.
    // DISCREPANCY (surfaced): sim-8 quoted 70 (+10 Shadow only) — its arithmetic did not
    // stack Vael's passive with the terrain mod; engine follows Rules Spec §6 RAW.
    expect(effectiveAtk(s, s.units[hexblade.id]!)).toBe(80);
    expect(s.units[hexblade.id]!.baseAtk).toBe(60);
    // Permanent: survives any number of turn cycles.
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 1);
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 1);
    expect(s.units[hexblade.id]!.baseAtk).toBe(60);
    // The unit keeps its identity (name/cardId) — fusion recipes would still match.
    expect(s.units[hexblade.id]!.cardId).toBe('hexblade');
  });
});
