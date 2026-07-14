// Rules Spec §5 — binary unit combat, attritional leader combat.
import { describe, expect, it } from 'vitest';
import { tileAt, unitAt, leaderOf } from '../board';
import { applyAction, debugSpawn } from '../engine';
import { freshGame, endUntil } from './helpers';

describe('unit vs unit — binary', () => {
  it('higher effective ATK wins; aggressor advances onto the vacated tile', () => {
    let s = freshGame();
    const atk = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 4 }); // 45
    const def = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 5 }); // 15 (+10 Desert tile (4,5)) = 25
    s = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 5 } });
    expect(s.units[def.id]).toBeUndefined();
    expect(s.units[atk.id]!.pos).toEqual({ col: 4, row: 5 }); // advance-on-kill
    expect(s.players[1].graveyard).toContain('carrionSwarm');
  });

  it('defender wins: attacker destroyed, defender HOLDS position', () => {
    let s = freshGame();
    const atk = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 4 }); // 15
    const def = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 5 }); // 45 on Desert = 35
    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 5 } });
    expect(s.units[atk.id]).toBeUndefined();
    expect(s.units[def.id]!.pos).toEqual({ col: 4, row: 5 }); // defender never advances
  });

  it('tie = mutual destruction, no advance', () => {
    let s = freshGame();
    const a = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 }); // 30
    const d = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 3 }); // 30 on Normal (4,3)? -> (4,3) is Desert!
    // (4,3) is Desert on the sim map: Undead +10 +Oskar passive +10 = 50. Use a neutral tile instead.
    tileAt(s.board, { col: 4, row: 3 }).terrain = 'Normal';
    expect(s.units[d.id]).toBeDefined();
    s = applyAction(s, { t: 'Move', unit: a.id, to: { col: 4, row: 3 } });
    expect(s.units[a.id]).toBeUndefined();
    expect(s.units[d.id]).toBeUndefined();
    expect(unitAt(s, { col: 4, row: 3 })).toBeUndefined(); // nobody advanced
  });

  it('summoning-sick units cannot attack but CAN move', () => {
    let s = freshGame();
    const sick = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 }, { sick: true });
    debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 });
    expect(() => applyAction(s, { t: 'Move', unit: sick.id, to: { col: 4, row: 5 } })).toThrow(/summoning-sick/);
    s = applyAction(s, { t: 'Move', unit: sick.id, to: { col: 3, row: 4 } }); // plain move is fine
    expect(s.units[sick.id]!.pos).toEqual({ col: 3, row: 4 });
  });
});

describe('anything vs leader — attritional', () => {
  it('chip lands first (full effective ATK), then strikeback; no advance', () => {
    let s = freshGame();
    // Oskar (ATK 25) at (4,7). A 20-ATK attacker chips 20 and dies to the counter.
    const atk = debugSpawn(s, 'saplingSentry', 0, { col: 4, row: 6 }); // 20
    s = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 7 } });
    expect(s.players[1].leaderLife).toBe(180); // chip landed even though the attacker died
    expect(s.units[atk.id]).toBeUndefined();   // 25 >= 20: destroyed by strikeback
    expect(leaderOf(s, 1).pos).toEqual({ col: 4, row: 7 }); // leader tile never taken
  });

  it('outclassed leader takes full damage and its strikeback fails', () => {
    let s = freshGame();
    const atk = debugSpawn(s, 'apexPredator', 0, { col: 4, row: 6 }); // 70
    s = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 7 } });
    expect(s.players[1].leaderLife).toBe(130); // full 70, no reduction
    expect(s.units[atk.id]).toBeDefined();     // 25 < 70: attacker survives
    expect(s.units[atk.id]!.pos).toEqual({ col: 4, row: 6 }); // still no advance
  });

  it('leader as attacker: kills smaller units and advances; chips itself on failure', () => {
    let s = freshGame();
    const briar = leaderOf(s, 0); // ATK 20 at (4,1)
    const small = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 2 }); // 15
    s = applyAction(s, { t: 'Move', unit: briar.id, to: { col: 4, row: 2 } });
    expect(s.units[small.id]).toBeUndefined();
    expect(leaderOf(s, 0).pos).toEqual({ col: 4, row: 2 }); // aggressor advance applies to leaders too

    // Now a failed leader attack: strikeback chips the attacking leader's pool.
    let s2 = freshGame();
    const briar2 = leaderOf(s2, 0);
    const big = debugSpawn(s2, 'graveTyrant', 1, { col: 4, row: 2 }); // 55
    s2 = applyAction(s2, { t: 'Move', unit: briar2.id, to: { col: 4, row: 2 } });
    expect(s2.units[big.id]).toBeDefined();       // survives the leader's 20
    expect(s2.players[0].leaderLife).toBe(145);   // 200 − 55 strikeback
  });

  it('LP ≤ 0 ends the game', () => {
    let s = freshGame();
    s.players[1].leaderLife = 50;
    const atk = debugSpawn(s, 'apexPredator', 0, { col: 4, row: 6 }); // 70
    s = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 7 } });
    expect(s.players[1].leaderLife).toBe(-20);
    expect(s.winner).toBe(0);
    expect(s.phase).toBe('gameover');
    expect(() => applyAction(s, { t: 'EndTurn' })).toThrow(/game is over/);
  });

  it('terrain still resolves on the defended (leader) tile', () => {
    let s = freshGame();
    tileAt(s.board, { col: 4, row: 7 }).terrain = 'Forest';
    const atk = debugSpawn(s, 'thornfang', 0, { col: 4, row: 6 }); // Beast: +10 on Forest battle tile
    s = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 7 } });
    // 30 + 10 (battle tile Forest) + 0 (Briar passive needs the unit standing on Forest; (4,6) is not)
    expect(s.players[1].leaderLife).toBe(160);
  });
});
