// Simulation 4 (as CORRECTED) — Aqua displacement vs Undead swarm: displacement
// spells must be set-and-traveled (telegraphed), the scatter deflates Frenzy via
// continuous re-evaluation, and the collision/edge rule blocks stacking.
import { describe, expect, it } from 'vitest';
import { makeBoard, tileAt } from '../board';
import { effectiveAtk, terrainMod } from '../stats';
import { applyAction, debugSpawn } from '../engine';
import { autoBurn, freshGame, teleport } from './helpers';
import { NERIS, TIDECALLER_CARDS } from '../content/simDecks';
import type { GameState, Unit } from '../types';

function tidecallerGame(): GameState {
  return freshGame({ board: makeBoard(), leaders: [NERIS, undefined], extraCards: TIDECALLER_CARDS });
}

function buildPack(s: GameState): { swarm: Unit } {
  for (const c of [{ col: 5, row: 5 }, { col: 4, row: 5 }, { col: 5, row: 4 }, { col: 6, row: 5 }]) {
    tileAt(s.board, c).terrain = 'Desert';
  }
  const swarm = debugSpawn(s, 'carrionSwarm', 1, { col: 5, row: 5 });
  debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 });
  debugSpawn(s, 'duneshambler', 1, { col: 5, row: 4 });
  debugSpawn(s, 'duneshambler', 1, { col: 6, row: 5 });
  return { swarm };
}

describe('Sim 4 — the correction: displacement is a set-and-travel board project', () => {
  it('Maelstrom CANNOT be cast from hand onto a distant formation', () => {
    const s = tidecallerGame();
    buildPack(s);
    s.players[0].hand.push('maelstrom');
    expect(() => applyAction(s, { t: 'CastSpell', card: 'maelstrom', targets: [{ col: 5, row: 4 }] }))
      .toThrow(/out of reach.*travel/);
  });

  it('set, travel 2 telegraphed turns, flip: the scatter deflates the pack 40 → 15', () => {
    let s = tidecallerGame();
    const { swarm } = buildPack(s);
    expect(effectiveAtk(s, s.units[swarm.id]!)).toBe(40); // 15 + 10 Desert + 15 Frenzy

    // Turn 1: set in the leader's zone, start walking it in (face-down, visible, dodgeable).
    s.players[0].hand.push('maelstrom');
    s = applyAction(s, { t: 'SetCard', card: 'maelstrom', tile: { col: 4, row: 2 } });
    const setId = Object.keys(s.setCards)[0]!;
    s = applyAction(s, { t: 'MoveSet', set: setId, to: { col: 4, row: 3 } });
    expect(() => applyAction(s, { t: 'MoveSet', set: setId, to: { col: 4, row: 4 } }))
      .toThrow(/already moved/); // 1 tile per turn — the telegraph is real
    s = autoBurn(applyAction(s, { t: 'EndTurn' }));
    s = autoBurn(applyAction(s, { t: 'EndTurn' })); // (the sim's swarm failed to dodge)

    // Turn 2 of travel.
    s = applyAction(s, { t: 'MoveSet', set: setId, to: { col: 4, row: 4 } });
    s = autoBurn(applyAction(s, { t: 'EndTurn' }));
    s = autoBurn(applyAction(s, { t: 'EndTurn' }));

    // Flip adjacent to the cluster: push all units in the 3×3 outward 1.
    s = applyAction(s, { t: 'FlipCard', set: setId, targets: [{ col: 5, row: 4 }] });

    // The cascade, all from one card: formation exploded, every Frenzy count recomputed,
    // the swarm pushed off its Desert footing.
    const c = s.units[swarm.id]!;
    expect(c.pos).toEqual({ col: 5, row: 6 });
    expect(effectiveAtk(s, c)).toBe(15); // 40 → 15: no neighbours, no Desert
    expect(tileAt(s.board, { col: 4, row: 4 }).occupant).toBeUndefined(); // spell consumed
    expect(s.players[0].graveyard).toContain('maelstrom');
  });
});

describe('Sim 4 — displacement collision & edge (locked rule)', () => {
  it('a push into an occupied tile stops at the last empty tile — no stacking, ever', () => {
    let s = tidecallerGame();
    const victim = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 2 });
    debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 4 }); // the wall
    s.players[0].hand.push('undertow');
    s = applyAction(s, { t: 'CastSpell', card: 'undertow', targets: [{ col: 4, row: 2 }] });
    expect(s.units[victim.id]!.pos).toEqual({ col: 4, row: 3 }); // pushed 2, blocked after 1
  });

  it('a push off the board edge stops at the last on-board tile', () => {
    let s = tidecallerGame();
    teleport(s, 'leader0', { col: 2, row: 3 }); // bring Neris to the flank
    const victim = debugSpawn(s, 'duneshambler', 1, { col: 2, row: 2 });
    s.players[0].hand.push('undertow');
    s = applyAction(s, { t: 'CastSpell', card: 'undertow', targets: [{ col: 2, row: 2 }] });
    expect(s.units[victim.id]!.pos).toEqual({ col: 2, row: 1 }); // one step, then the board edge
  });

  it('own-body walls shield against pushes (the defensive upside of clustering)', () => {
    let s = tidecallerGame();
    const victim = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 2 });
    debugSpawn(s, 'duneshambler', 1, { col: 4, row: 3 }); // its own bodyguard, directly behind
    s.players[0].hand.push('undertow');
    s = applyAction(s, { t: 'CastSpell', card: 'undertow', targets: [{ col: 4, row: 2 }] });
    expect(s.units[victim.id]!.pos).toEqual({ col: 4, row: 2 }); // didn't move at all
  });
});

describe('Sim 4 — Sea-weakening is matchup tech, not universal', () => {
  it('Sea does NOT bite Undead (one-home/one-weakness chart)', () => {
    expect(terrainMod('Undead', 'Sea')).toBe(0);
    expect(terrainMod('Machine', 'Sea')).toBe(-10); // the heavy cluster is the real target
    expect(terrainMod('Aqua', 'Sea')).toBe(10);
  });
});
