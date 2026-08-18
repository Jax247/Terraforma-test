// Exact-range Ranged units (2026-08-03).
//
// A `Ranged` card fires at EXACTLY its `range` in orthogonal tiles — never nearer. The dead zone
// inside that distance is the mechanic: closing the gap is what melee does to an archer, and a
// shooter caught inside its own range falls back to an ordinary melee attack.
//
// Retaliation follows the same principle as "striking back is attacking": a defender hits back
// only if it can REACH the attacker's tile. Melee always can (the attacker came to it); a shot
// from two tiles away can only be answered by something that itself reaches two tiles.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, legalActions } from '../engine';
import { makeBoard, rangedTargets, sameCoord } from '../board';
import { freshGame } from './helpers';
import type { CardDef, Coord, GameState } from '../types';

const CARDS: Record<string, CardDef> = {
  bow1: {
    kind: 'unit', id: 'bow1', name: 'Bow 1', type: 'Warrior', level: 3, atk: 40, def: 20, dc: 3,
    keywords: ['Ranged'], rules: [], // range omitted -> 1, the pre-existing behaviour
  },
  bow2: {
    kind: 'unit', id: 'bow2', name: 'Bow 2', type: 'Warrior', level: 3, atk: 40, def: 20, dc: 5,
    keywords: ['Ranged'], range: 2, rules: [],
  },
  bow3: {
    kind: 'unit', id: 'bow3', name: 'Bow 3', type: 'Warrior', level: 4, atk: 40, def: 20, dc: 7,
    keywords: ['Ranged'], range: 3, rules: [],
  },
  // Out-stats every bow above, so "did the defender kill the shooter?" is unambiguous.
  brute: {
    kind: 'unit', id: 'brute', name: 'Brute', type: 'Warrior', level: 4, atk: 60, def: 30, dc: 4,
    keywords: [], rules: [],
  },
  chaff: {
    kind: 'unit', id: 'chaff', name: 'Chaff', type: 'Warrior', level: 1, atk: 10, def: 10, dc: 1,
    keywords: [], rules: [],
  },
};

/** Neutral 7×7 so terrain never skews an ATK comparison. */
function game(): GameState {
  return freshGame({ board: makeBoard(() => 'Normal'), extraCards: CARDS });
}

const shoot = (s: GameState, unit: string, target: Coord) =>
  applyAction(s, { t: 'RangedAttack', unit, target });

describe('exact range — never nearer, never further', () => {
  it('range 2 hits at 2', () => {
    const s = game();
    const bow = debugSpawn(s, 'bow2', 0, { col: 4, row: 2 });
    const prey = debugSpawn(s, 'chaff', 1, { col: 4, row: 4 });
    expect(shoot(s, bow.id, prey.pos).units[prey.id]).toBeUndefined();
  });

  it('range 2 CANNOT hit an adjacent enemy — the dead zone', () => {
    const s = game();
    const bow = debugSpawn(s, 'bow2', 0, { col: 4, row: 3 });
    const prey = debugSpawn(s, 'chaff', 1, { col: 4, row: 4 });
    expect(() => shoot(s, bow.id, prey.pos)).toThrow(/exactly 2 orthogonal tiles/);
    expect(legalActions(s).some((a) => a.t === 'RangedAttack' && a.unit === bow.id)).toBe(false);
  });

  it('range 2 cannot hit at 3 either', () => {
    const s = game();
    const bow = debugSpawn(s, 'bow2', 0, { col: 2, row: 1 });
    const prey = debugSpawn(s, 'chaff', 1, { col: 2, row: 4 });
    expect(() => shoot(s, bow.id, prey.pos)).toThrow(/exactly 2 orthogonal tiles/);
  });

  it('a shooter in its own dead zone can still melee — it just pays the exposure', () => {
    const s = game();
    const bow = debugSpawn(s, 'bow2', 0, { col: 4, row: 3 });
    const prey = debugSpawn(s, 'chaff', 1, { col: 4, row: 4 });
    const after = applyAction(s, { t: 'Move', unit: bow.id, to: prey.pos });
    expect(after.units[prey.id]).toBeUndefined();
    expect(after.units[bow.id]!.pos).toEqual({ col: 4, row: 4 }); // advanced, and now exposed
  });

  it('targeting is orthogonal only — no diagonals, per the locked 4-directional rule', () => {
    const s = game();
    const bow = debugSpawn(s, 'bow2', 0, { col: 4, row: 4 });
    const targets = rangedTargets(s, s.units[bow.id]!);
    expect(targets).toHaveLength(4);
    expect(targets.every((t) => t.col === 4 || t.row === 4)).toBe(true);
    expect(targets.some((t) => sameCoord(t, { col: 6, row: 6 }))).toBe(false);
  });

  it('range 1 is the default and is byte-for-byte the old behaviour', () => {
    const s = game();
    const bow = debugSpawn(s, 'bow1', 0, { col: 4, row: 3 });
    const prey = debugSpawn(s, 'chaff', 1, { col: 4, row: 4 });
    expect(s.units[bow.id]!.range).toBe(1);
    expect(shoot(s, bow.id, prey.pos).units[prey.id]).toBeUndefined();
  });
});

describe('walls block the line', () => {
  function withWall(at: Coord): GameState {
    const s = game();
    s.board[at.col - 1]![at.row - 1]!.terrain = 'Wall';
    return s;
  }

  it('a Wall strictly between blocks the shot', () => {
    const s = withWall({ col: 4, row: 3 });
    const bow = debugSpawn(s, 'bow2', 0, { col: 4, row: 2 });
    const prey = debugSpawn(s, 'chaff', 1, { col: 4, row: 4 });
    expect(() => shoot(s, bow.id, prey.pos)).toThrow(/Wall/);
  });

  it('a Wall off the line does not block it', () => {
    const s = withWall({ col: 3, row: 3 });
    const bow = debugSpawn(s, 'bow2', 0, { col: 4, row: 2 });
    const prey = debugSpawn(s, 'chaff', 1, { col: 4, row: 4 });
    expect(shoot(s, bow.id, prey.pos).units[prey.id]).toBeUndefined();
  });

  it('only the tiles STRICTLY between matter — a Wall on the target tile is still shootable', () => {
    // Consistent with the standing rule that Ranged is how you reach a wall-passer on a Wall.
    const s = withWall({ col: 4, row: 4 });
    const bow = debugSpawn(s, 'bow2', 0, { col: 4, row: 2 });
    expect(rangedTargets(s, s.units[bow.id]!).some((c) => sameCoord(c, { col: 4, row: 4 }))).toBe(true);
  });

  it('range 3 is blocked by a Wall anywhere along the line', () => {
    for (const wall of [{ col: 2, row: 2 }, { col: 2, row: 3 }]) {
      const s = withWall(wall);
      const bow = debugSpawn(s, 'bow3', 0, { col: 2, row: 1 });
      const prey = debugSpawn(s, 'chaff', 1, { col: 2, row: 4 });
      expect(() => shoot(s, bow.id, prey.pos)).toThrow(/Wall/);
    }
  });
});

describe('retaliation requires reach', () => {
  it('a melee body cannot answer a shot from 2 tiles — the shooter survives outclassing it', () => {
    const s = game();
    const bow = debugSpawn(s, 'bow2', 0, { col: 4, row: 2 }); // 40
    const brute = debugSpawn(s, 'brute', 1, { col: 4, row: 4 }); // 60 — would normally kill it
    const lp = s.players[0].leaderLife;
    const after = shoot(s, bow.id, brute.pos);
    expect(after.units[bow.id]).toBeDefined();          // no strikeback
    expect(after.units[brute.id]).toBeDefined();        // ...but no free break either
    expect(after.players[0].leaderLife).toBe(lp);       // and no overflow back
  });

  it('at range 1 the defender IS in reach and still kills the shooter (unchanged)', () => {
    const s = game();
    const bow = debugSpawn(s, 'bow1', 0, { col: 4, row: 3 });
    const brute = debugSpawn(s, 'brute', 1, { col: 4, row: 4 });
    const after = shoot(s, bow.id, brute.pos);
    expect(after.units[bow.id]).toBeUndefined();
    expect(after.units[brute.id]).toBeDefined();
  });

  it('archer duel: a matching-range shooter CAN answer', () => {
    const s = game();
    const mine = debugSpawn(s, 'bow2', 0, { col: 4, row: 2 });   // 40
    const theirs = debugSpawn(s, 'bow2', 1, { col: 4, row: 4 }); // 40 — a tie
    const after = shoot(s, mine.id, theirs.pos);
    expect(after.units[mine.id]).toBeUndefined();   // mutual destruction: both had reach
    expect(after.units[theirs.id]).toBeUndefined();
  });

  it('mismatched ranges do not answer each other', () => {
    const s = game();
    const long = debugSpawn(s, 'bow3', 0, { col: 2, row: 1 });  // range 3
    const short = debugSpawn(s, 'bow2', 1, { col: 2, row: 4 }); // range 2 — cannot reach 3 back
    const after = shoot(s, long.id, short.pos);
    expect(after.units[long.id]).toBeDefined();
    expect(after.units[short.id]).toBeUndefined(); // loses the tie, being unable to answer
  });

  it('a melee attacker walking into a shooter is still answered normally', () => {
    // Reach only ever gates a SHOT. A defender fighting for its own tile always hits back.
    const s = game();
    const brute = debugSpawn(s, 'brute', 0, { col: 4, row: 3 });
    const bow = debugSpawn(s, 'bow2', 1, { col: 4, row: 4 });
    const after = applyAction(s, { t: 'Move', unit: brute.id, to: bow.pos });
    expect(after.units[bow.id]).toBeUndefined();
    expect(after.units[brute.id]).toBeDefined();
  });

  it('a shot that wins outright still spills overflow as usual', () => {
    const s = game();
    const bow = debugSpawn(s, 'bow2', 0, { col: 4, row: 2 }); // 40
    const prey = debugSpawn(s, 'chaff', 1, { col: 4, row: 4 }); // 10
    const after = shoot(s, bow.id, prey.pos);
    expect(after.players[1].leaderLife).toBe(200 - 30);
  });
});
