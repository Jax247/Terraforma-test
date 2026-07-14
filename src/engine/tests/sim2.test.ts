// Simulation 2 — Aggression Test: multi-summon tempo, combat on neutral springs,
// the tie rule, and auras re-evaluating as Forest spreads.
import { describe, expect, it } from 'vitest';
import { makeBoard, tileAt } from '../board';
import { effectiveAtk } from '../stats';
import { applyAction, debugSpawn } from '../engine';
import { freshGame } from './helpers';

describe('Sim 2 — multi-summon widens the opening', () => {
  it('P2 fields two bodies off the 5-SP coin turn', () => {
    let s = freshGame();
    s = applyAction(s, { t: 'EndTurn' }); // P2's turn 1: 4 + 1 coin = 5 SP
    s.players[1].hand = ['duneshambler', 'carrionSwarm'];
    s = applyAction(s, { t: 'Summon', card: 'duneshambler', tile: { col: 3, row: 7 } });
    s = applyAction(s, { t: 'Summon', card: 'carrionSwarm', tile: { col: 5, row: 7 } });
    expect(s.players[1].sp).toBe(0); // 5 − 3 − 2: the coin bought the second body
    expect(Object.values(s.units).filter((u) => u.owner === 1 && !u.isLeader).length).toBe(2);
  });
});

describe('Sim 2 — combat pays on NEUTRAL ground (the springs)', () => {
  it('attack on a neutral spring: kill, advance, spring control flips via combat', () => {
    let s = freshGame();
    // P1's Thornfang camps the (2,4) spring (still active — it just arrived by fixture).
    const thorn = debugSpawn(s, 'thornfang', 0, { col: 2, row: 4 });
    // P2's Duneshambler attacks from a Desert tile it owns the footing on.
    tileAt(s.board, { col: 2, row: 5 }).terrain = 'Desert';
    const shambler = debugSpawn(s, 'duneshambler', 1, { col: 2, row: 5 });
    s = applyAction(s, { t: 'EndTurn' }); // P2's turn
    const spBefore = s.players[1].sp;

    // Battle resolves on the DEFENDED tile (the spring, Normal): terrain mod 0 for both.
    // Attacker keeps Oskar's own-tile passive (+10, standing on Desert): 30+10=40 vs 30.
    // DISCREPANCY (surfaced): sim-2 narrative quoted "Duneshambler 50 > Thornfang 30" —
    // its loose arithmetic stacked own-tile terrain into the attack; engine RAW gives 40.
    // Outcome (kill + advance + spring flip) is identical.
    const a = effectiveAtk(s, s.units[shambler.id]!, {
      role: 'attacker', battleTile: { col: 2, row: 4 }, opponentId: thorn.id,
    });
    const d = effectiveAtk(s, s.units[thorn.id]!, {
      role: 'defender', battleTile: { col: 2, row: 4 }, opponentId: shambler.id,
    });
    expect(a).toBe(40);
    expect(d).toBe(30);

    s = applyAction(s, { t: 'Move', unit: shambler.id, to: { col: 2, row: 4 } });
    expect(s.units[thorn.id]).toBeUndefined();
    expect(s.units[shambler.id]!.pos).toEqual({ col: 2, row: 4 }); // advance-on-kill
    expect(s.players[1].sp).toBe(spBefore + 3);                    // capture flipped with the tile
    expect(tileAt(s.board, { col: 2, row: 4 }).springActive).toBe(false);
  });

  it('attacking into a stat wall fails: Carrion Swarm dies for nothing', () => {
    let s = freshGame();
    const thorn = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    const swarm = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 3 });
    tileAt(s.board, { col: 4, row: 3 }).terrain = 'Normal';
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Normal';
    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'Move', unit: swarm.id, to: { col: 4, row: 4 } });
    expect(s.units[swarm.id]).toBeUndefined(); // 15 < 30
    expect(s.units[thorn.id]).toBeDefined();
    expect(s.units[thorn.id]!.pos).toEqual({ col: 4, row: 4 }); // defender holds
  });
});

describe('Sim 2 — the tie rule (locked: mutual destruction)', () => {
  it('equal effective ATK destroys both, nobody advances', () => {
    let s = freshGame({ board: makeBoard() });
    const a = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });    // 30
    const d = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 }); // 30
    s = applyAction(s, { t: 'Move', unit: a.id, to: { col: 4, row: 5 } });
    expect(s.units[a.id]).toBeUndefined();
    expect(s.units[d.id]).toBeUndefined();
    expect(tileAt(s.board, { col: 4, row: 5 }).occupant).toBeUndefined();
    expect(s.players[0].graveyard).toContain('thornfang');
    expect(s.players[1].graveyard).toContain('duneshambler');
  });
});

describe('Sim 2 — continuous auras as Forest spreads', () => {
  it('Grovecaller 35 → 50 as Verdant Surge adds three Forest tiles to its ring', () => {
    let s = freshGame({ board: makeBoard() });
    tileAt(s.board, { col: 3, row: 4 }).terrain = 'Forest';
    tileAt(s.board, { col: 5, row: 4 }).terrain = 'Forest';
    const g = debugSpawn(s, 'grovecaller', 0, { col: 4, row: 3 });
    expect(effectiveAtk(s, g)).toBe(35); // 25 + 2×5
    s.players[0].hand.push('verdantSurge');
    s = applyAction(s, {
      t: 'CastSpell',
      card: 'verdantSurge',
      targets: [{ col: 3, row: 2 }, { col: 4, row: 2 }, { col: 5, row: 2 }],
    });
    expect(effectiveAtk(s, s.units[g.id]!)).toBe(50); // 25 + 5×5
  });
});
