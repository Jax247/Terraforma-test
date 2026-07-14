// Simulation 3 — New Rules & the Long Game: Frenzy live, the repaint counter,
// mutual-destruction ties as a DECISION, and graveyard recursion timing.
import { describe, expect, it } from 'vitest';
import { makeBoard, tileAt } from '../board';
import { effectiveAtk } from '../stats';
import { applyAction, debugSpawn } from '../engine';
import { freshGame, endUntil } from './helpers';

function desertPack(s: ReturnType<typeof freshGame>) {
  // Carrion Swarm massed on Desert with 3 orthogonal allies — the sim-3 cluster.
  for (const c of [{ col: 4, row: 2 }, { col: 3, row: 2 }, { col: 5, row: 2 }, { col: 4, row: 3 }]) {
    tileAt(s.board, c).terrain = 'Desert';
  }
  const swarm = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 2 });
  debugSpawn(s, 'duneshambler', 1, { col: 3, row: 2 });
  debugSpawn(s, 'duneshambler', 1, { col: 5, row: 2 });
  debugSpawn(s, 'duneshambler', 1, { col: 4, row: 3 });
  return swarm;
}

describe('Sim 3 — Frenzy (+5/adjacent ally, max +20) is real in unit combat', () => {
  it('a 2-drop becomes a 40 purely by massing: 15 + 10 Desert + 15 Frenzy', () => {
    const s = freshGame({ board: makeBoard() });
    const swarm = desertPack(s);
    expect(effectiveAtk(s, swarm)).toBe(40); // matches the sim's arithmetic exactly
  });

  it('emergent counter #1: REPAINT the ground under the pack — 40 drops to 30', () => {
    let s = freshGame({ board: makeBoard() });
    const swarm = desertPack(s);
    s.players[0].hand.push('verdantSurge');
    // Briar at (4,1): the pack camped her doorstep, so the line is in located reach.
    s = applyAction(s, {
      t: 'CastSpell',
      card: 'verdantSurge',
      targets: [{ col: 3, row: 2 }, { col: 4, row: 2 }, { col: 5, row: 2 }],
    });
    // Insects lose +10 Desert (neutral on Forest); Frenzy is untouched: 15 + 0 + 15.
    expect(effectiveAtk(s, s.units[swarm.id]!)).toBe(30);
  });

  it('the tie rule creates a DECISION: an even trade is available, not forced', () => {
    // Thornfang on Forest (40) could trade into the Frenzied Carrion (40) — mutual
    // destruction if taken. The rule's job is that both options exist.
    let s = freshGame({ board: makeBoard() });
    desertPack(s);
    tileAt(s.board, { col: 4, row: 1 }).terrain = 'Normal'; // move Briar's tile out of the math
    const thorn = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Forest';
    // Standing: 30 + 10 Forest + 10 Briar passive = 50… the sim quoted 40.
    // DISCREPANCY (surfaced): sim-3 arithmetic did not stack Briar's passive with the
    // terrain mod. Engine follows Rules Spec §6 RAW (auras + terrainMod are separate sums).
    expect(effectiveAtk(s, s.units[thorn.id]!)).toBe(50);
    // In combat on the swarm's Desert tile the numbers converge to the sim's 40 vs 40:
    // Thornfang: 30 + 0 battle-tile (Desert is only −10 for Beast… −10, so 30−10+0=20).
    // The equal-trade case per locked rules: attack the (4,3) shambler instead.
    // Duneshambler defending on its Desert tile: 30 + 10 + 10 (Oskar passive) = 50 vs
    // Thornfang attacking: 30 + (−10 Desert battle tile) + 10 (Briar, standing on Forest) = 30.
    // The sim's exact 40/40 tie isn't reconstructible under RAW stacking — surfaced, and
    // the tie MECHANIC itself is asserted in sim2/combat suites.
    const shambler = Object.values(s.units).find((u) => u.cardId === 'duneshambler' && u.pos.row === 3)!;
    const aEff = effectiveAtk(s, s.units[thorn.id]!, { role: 'attacker', battleTile: shambler.pos, opponentId: shambler.id });
    const dEff = effectiveAtk(s, shambler, { role: 'defender', battleTile: shambler.pos, opponentId: thorn.id });
    expect(aEff).toBe(30);
    expect(dEff).toBe(50);
    s = applyAction(s, { t: 'Move', unit: thorn.id, to: shambler.pos });
    expect(s.units[thorn.id]).toBeUndefined(); // attacking into a kill-zone is a sucker's move
  });
});

describe('Sim 3 — recursion timing & the graveyard engine', () => {
  it('Raise the Fallen returns an Undead to a summon-zone tile, summoning-sick', () => {
    let s = freshGame();
    s.players[1].graveyard.push('duneshambler');
    s = endUntil(s, 1);
    s.players[1].hand.push('raiseTheFallen');
    // Oskar at (4,7): raise into his surrounding-8.
    s = applyAction(s, { t: 'CastSpell', card: 'raiseTheFallen', targets: [{ col: 4, row: 6 }] });
    const raised = Object.values(s.units).find((u) => u.cardId === 'duneshambler' && u.owner === 1);
    expect(raised).toBeDefined();
    expect(raised!.pos).toEqual({ col: 4, row: 6 });
    expect(raised!.summoningSick).toBe(true);
    expect(s.players[1].graveyard).not.toContain('duneshambler');
  });

  it('raising outside the summon zone is illegal', () => {
    let s = freshGame();
    s.players[1].graveyard.push('duneshambler');
    s = endUntil(s, 1);
    s.players[1].hand.push('raiseTheFallen');
    expect(() => applyAction(s, { t: 'CastSpell', card: 'raiseTheFallen', targets: [{ col: 4, row: 4 }] }))
      .toThrow(/summon-zone/);
  });

  it('Sand Revenant scales as the graveyard fills (the turn-7 payoff curve)', () => {
    const s = freshGame();
    const rev = debugSpawn(s, 'sandRevenant', 1, { col: 4, row: 4 });
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Normal';
    expect(effectiveAtk(s, rev)).toBe(35);
    s.players[1].graveyard.push('duneshambler', 'duneshambler', 'sandRevenant');
    expect(effectiveAtk(s, rev)).toBe(50); // 35 + 3×5 — the sim-3 "Sand Revenant → 50"
  });
});
