// Simulation 6 — First Full Game (Ironworks vs Wildgrowth): fusion under pressure,
// the terrain-drag duel, full-damage-when-outclassed, and a game that ENDS.
import { describe, expect, it } from 'vitest';
import { makeBoard, tileAt, leaderOf } from '../board';
import { effectiveAtk } from '../stats';
import { applyAction, debugSpawn } from '../engine';
import { freshGame, endUntil, teleport } from './helpers';
import { COGSWORTH, IRONWORKS_CARDS } from '../content/simDecks';
import type { GameState } from '../types';

// P1 = Wildgrowth (Briar), P2 = Ironworks (Cogsworth).
function ironworksGame(): GameState {
  const s = freshGame({
    board: makeBoard(),
    leaders: [undefined, COGSWORTH],
    extraCards: IRONWORKS_CARDS,
    fusionPools: [['apexPredator'], ['ironColossus']],
  });
  return s;
}

describe('Sim 6 — Assemble: leader-driven fusion', () => {
  it('fuses two adjacent Machines into the Colossus without spending their moves', () => {
    let s = ironworksGame();
    tileAt(s.board, { col: 5, row: 5 }).terrain = 'Mountain';
    tileAt(s.board, { col: 5, row: 6 }).terrain = 'Mountain';
    debugSpawn(s, 'gearhulk', 1, { col: 5, row: 5 });
    debugSpawn(s, 'pistonKnight', 1, { col: 5, row: 6 });
    s = endUntil(s, 1);
    s.players[1].sp = 12;
    s = applyAction(s, { t: 'ActivateAbility', targets: [{ col: 5, row: 5 }, { col: 5, row: 6 }] });
    expect(s.players[1].sp).toBe(8); // Assemble costs 4
    const colossus = Object.values(s.units).find((u) => u.cardId === 'ironColossus');
    expect(colossus).toBeDefined();
    expect(colossus!.pos).toEqual({ col: 5, row: 6 }); // second material's tile
    expect(colossus!.summoningSick).toBe(true);
    expect(s.players[1].fusionPool).toEqual([]);
    // Standing on Mountain: 75 + 10 terrain + 10 Cogsworth passive = 95.
    // DISCREPANCY (surfaced): sim-6 quoted "85 on Mountain" — one +10, not two. Whether a
    // leader's "type on favored terrain" passive stacks with the terrain mod is
    // under-specified in the vault; engine follows Rules Spec §6 RAW (auras + terrainMod).
    expect(effectiveAtk(s, colossus!)).toBe(95);
  });
});

describe('Sim 6 — the go-tall duel is a TERRAIN duel', () => {
  it('Apex (80 via Forest footing) beats Colossus (75 dragged onto neutral)', () => {
    let s = ironworksGame();
    // Briar's Forest under Apex; the Colossus lured off its Mountain onto neutral center.
    tileAt(s.board, { col: 4, row: 5 }).terrain = 'Forest';
    const apex = debugSpawn(s, 'apexPredator', 0, { col: 4, row: 5 });
    const colossus = debugSpawn(s, 'ironColossus', 1, { col: 4, row: 4 });

    const a = effectiveAtk(s, apex, { role: 'attacker', battleTile: colossus.pos, opponentId: colossus.id });
    const d = effectiveAtk(s, colossus, { role: 'defender', battleTile: colossus.pos, opponentId: apex.id });
    expect(a).toBe(80); // 70 + 10 Briar passive (standing on Forest) — the sim's exact 80
    expect(d).toBe(75); // no Mountain, no passive — the sim's exact 75

    s = applyAction(s, { t: 'Move', unit: apex.id, to: { col: 4, row: 4 } });
    expect(s.units[colossus.id]).toBeUndefined();
    expect(s.units[apex.id]!.pos).toEqual({ col: 4, row: 4 }); // advances into the center
    // A fused unit dies to the graveyard AS THE FUSED CARD — premium recursion target.
    expect(s.players[1].graveyard).toContain('ironColossus');
  });
});

describe('Sim 6 — closing a game: full damage when outclassed', () => {
  it('Apex connects on Cogsworth: strikeback 25 < 80, leader eats the full 80 (200→120)', () => {
    let s = ironworksGame();
    teleport(s, 'leader1', { col: 4, row: 5 }); // Cogsworth caught forward
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Forest';
    const apex = debugSpawn(s, 'apexPredator', 0, { col: 4, row: 4 });
    s = applyAction(s, { t: 'Move', unit: apex.id, to: { col: 4, row: 5 } });
    expect(s.players[1].leaderLife).toBe(120);              // full 80: offense never buys safety
    expect(s.units[apex.id]).toBeDefined();                 // 25 strikeback < 80: survives
    expect(leaderOf(s, 1).pos).toEqual({ col: 4, row: 5 }); // no advance onto a leader
  });

  it('the second wave closes it: chip + big hits end the game inside the arc', () => {
    let s = ironworksGame();
    s.players[1].leaderLife = 120; // after the first connection
    teleport(s, 'leader1', { col: 4, row: 5 });
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Forest';
    tileAt(s.board, { col: 3, row: 5 }).terrain = 'Forest';
    const apex = debugSpawn(s, 'apexPredator', 0, { col: 4, row: 4 });
    const bull = debugSpawn(s, 'mosshideBull', 0, { col: 3, row: 5 });
    s = applyAction(s, { t: 'Move', unit: apex.id, to: { col: 4, row: 5 } }); // 80
    expect(s.players[1].leaderLife).toBe(40);
    s = applyAction(s, { t: 'Move', unit: bull.id, to: { col: 4, row: 5 } }); // 45 + 10 Briar = 55
    expect(s.players[1].leaderLife).toBeLessThanOrEqual(0);
    expect(s.winner).toBe(0); // Wildgrowth wins by LP depletion — games END
    expect(s.phase).toBe('gameover');
  });
});
