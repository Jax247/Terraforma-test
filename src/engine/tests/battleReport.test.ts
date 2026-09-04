// The presentational record of a combat exchange — see `BattleReport` in types.ts.
//
// The invariant worth guarding is the one that made the popup buildable at all: the itemised
// breakdown and the number the engine actually fights with are the SAME computation, so their
// totals can never disagree. `computeAtk` / `computeDef` in stats.ts are what guarantee it; these
// tests are what would catch someone splitting them apart again.
import { describe, expect, it } from 'vitest';
import { leaderOf, tileAt } from '../board';
import { applyAction, debugSpawn } from '../engine';
import { atkBreakdown, defBreakdown, effectiveAtk, effectiveDef } from '../stats';
import { freshGame, endUntil, teleport } from './helpers';
import type { CardDef } from '../types';

/** A Ranged card, mirroring `ranged.test.ts` — the sim decks carry no shooter. */
const BOW: Record<string, CardDef> = {
  bow2: {
    kind: 'unit', id: 'bow2', name: 'Bow 2', type: 'Warrior', level: 3, atk: 40, def: 20, dc: 5,
    keywords: ['Ranged'], range: 2, rules: [],
  },
};

const sum = (terms: { amount: number }[]) => terms.reduce((n, t) => n + t.amount, 0);

describe('breakdown totals', () => {
  it('add up to the number the engine fights with', () => {
    const s = freshGame();
    debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 4 });
    debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 5 });
    for (const unit of Object.values(s.units)) {
      const atk = atkBreakdown(s, unit);
      const def = defBreakdown(s, unit);
      expect(atk.total).toBe(effectiveAtk(s, unit));
      expect(def.total).toBe(effectiveDef(s, unit));
      // And the itemisation is complete — nothing is added to the total off the books.
      expect(sum(atk.terms)).toBe(atk.total);
      expect(sum(def.terms)).toBe(def.total);
    }
  });

  it('itemises terrain against the base, and names the terrain', () => {
    const s = freshGame();
    // (4,5) is Desert on the sim map; Beast is weak to it.
    const bull = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 5 });
    const { total, terms } = atkBreakdown(s, bull);
    expect(terms[0]).toEqual({ label: 'Base ATK', amount: bull.baseAtk, kind: 'base' });
    const terrain = terms.find((t) => t.kind === 'terrain');
    expect(terrain?.label).toContain('Desert');
    expect(terrain?.amount).toBe(-10);
    expect(total).toBe(bull.baseAtk - 10);
  });

  it('leaves out terms worth nothing rather than listing a row of zeroes', () => {
    const s = freshGame();
    const u = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Normal';
    expect(atkBreakdown(s, u).terms.every((t) => t.amount !== 0 || t.kind === 'base')).toBe(true);
  });
});

describe('battle reports', () => {
  it('records one exchange per attack, with both sides itemised', () => {
    let s = freshGame();
    const atk = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 4 });
    const def = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 5 });
    s = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 5 } });

    expect(s.battles).toHaveLength(1);
    const b = s.battles[0]!;
    expect(b.tile).toEqual({ col: 4, row: 5 });
    expect(b.ranged).toBe(false);
    expect(b.attacker.unitId).toBe(atk.id);
    expect(b.defender.unitId).toBe(def.id);
    expect(b.attacker.destroyed).toBe(false);
    expect(b.defender.destroyed).toBe(true);
    // The summary is the engine's own log lines, not a second wording.
    expect(b.lines.length).toBeGreaterThan(0);
    expect(s.log.join('\n')).toContain(b.lines[0]!);
    // Both sides are itemised, and each itemisation is internally consistent.
    expect(sum(b.attacker.breakdown.terms)).toBe(b.attacker.breakdown.total);
    expect(sum(b.defender.breakdown.terms)).toBe(b.defender.breakdown.total);
  });

  it('meets a defending unit on its DEF and says so', () => {
    let s = freshGame();
    const wall = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 4 });
    s = applyAction(s, { t: 'SetStance', unit: wall.id, stance: 'defense' });
    const hitter = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 3 });
    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: hitter.id, to: { col: 4, row: 4 } });

    const b = s.battles[0]!;
    expect(b.attacker.stat).toBe('atk');
    expect(b.defender.stat).toBe('def');
    expect(b.defender.breakdown.total).toBe(effectiveDef(s, s.units[wall.id]!, {
      role: 'defender',
      battleTile: { col: 4, row: 4 },
      opponentId: hitter.id,
    }));
  });

  it('reports the life a leader lost, and never marks a leader destroyed', () => {
    let s = freshGame();
    const enemyLeader = leaderOf(s, 1);
    const hitter = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 4 });
    teleport(s, hitter.id, { col: enemyLeader.pos.col, row: enemyLeader.pos.row - 1 });
    const before = s.players[1].leaderLife;
    s = applyAction(s, { t: 'Move', unit: hitter.id, to: enemyLeader.pos });

    const b = s.battles.at(-1)!;
    expect(b.defender.isLeader).toBe(true);
    expect(b.defender.destroyed).toBe(false);
    expect(b.lifeLoss[1]).toBe(before - s.players[1].leaderLife);
  });

  it('is reset by the next action rather than accumulating', () => {
    let s = freshGame();
    const atk = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 4 });
    debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 5 });
    s = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 5 } });
    expect(s.battles).toHaveLength(1);
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.battles).toEqual([]);
  });

  it('stays empty for a move that is only a move', () => {
    let s = freshGame();
    const u = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 4 });
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 5 } });
    expect(s.battles).toEqual([]);
  });

  it('marks a shot as ranged', () => {
    let s = freshGame({ extraCards: BOW });
    const shooter = debugSpawn(s, 'bow2', 0, { col: 4, row: 4 });
    const target = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 6 });
    s = applyAction(s, { t: 'RangedAttack', unit: shooter.id, target: target.pos });
    expect(s.battles[0]!.ranged).toBe(true);
  });
});
