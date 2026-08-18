// GUARD — re-spec'd 2026-08-09 from an INTERCEPTION experiment (never enabled, and its A/B was
// vacuous at 0/3840 because no card carried the keyword) to a shipping movement rule:
//
//     While a unit stands orthogonally adjacent to an enemy Guard, it may not end a move on an
//     EMPTY tile that is not also orthogonally adjacent to that Guard. Attacks are unaffected.
//
// The vault had already moved: `Crowd Control & Status Effects.md` describes Guard as "you cannot
// walk past me" and rules taunt out on the grounds that Guard "already does the useful half". The
// engine simply never followed.
//
// ⚠ THE PROPERTY THIS FILE EXISTS TO PROTECT is that a pin is not a LOCK. Guard is the first rule
// in the game that can remove a unit's legal moves, and the CC note warns that while-standing
// movement denial soft-locks. It is safe here only because movement IS attacking: a pinned unit can
// always swing at the Guard, shuffle to the Guard's other tiles, or pass. Every one of those three
// escapes has a test, and if one ever breaks the rule is unsafe.
//
// ⚠ Every test here was mutation-tested: break the rule it covers and it must FAIL.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, isPinnedByGuard, legalActions, leaderOf, RULES, unitAt } from '../index';
import type { CardDef, Coord, GameState } from '../index';
import { freshGame, teleport } from './helpers';

/** A minimal Push, so the displacement test does not depend on which leader a fixture picked. */
const SHOVE: Record<string, CardDef> = {
  shove: {
    kind: 'spell', id: 'shove', name: 'Shove', dc: 2, sp: 1, scope: 'global',
    effects: [{ effect: { e: 'Push', tiles: 1 }, target: { t: 'ChosenEnemy' } }],
  },
};

const GUARD_DEFS: Record<string, CardDef> = {
  guardsman: {
    kind: 'unit', id: 'guardsman', name: 'Guardsman', type: 'Undead', level: 3, atk: 30, def: 15, dc: 4,
    keywords: ['Guard'], rules: [],
  },
  runner: {
    kind: 'unit', id: 'runner', name: 'Runner', type: 'Undead', level: 2, atk: 20, def: 10, dc: 2,
    keywords: [], rules: [],
  },
  longbow: {
    kind: 'unit', id: 'longbow', name: 'Longbow', type: 'Undead', level: 3, atk: 25, def: 10, dc: 4,
    keywords: ['Ranged'], rules: [],
  },
};

/**
 * Every EMPTY tile unit `id` may walk to.
 *
 * ⚠ Filtering to empty tiles is the whole point: movement IS attacking here, so an attack is also
 * a `Move` action, and counting those would make every pinned unit look mobile. The first draft of
 * this file did exactly that and six tests lied.
 */
function moveTiles(s: GameState, id: string): Coord[] {
  return legalActions(s)
    .filter((a): a is Extract<typeof a, { t: 'Move' }> => a.t === 'Move' && a.unit === id)
    .map((a) => a.to)
    .filter((c) => unitAt(s, c) === undefined);
}
const has = (tiles: Coord[], c: Coord) => tiles.some((t) => t.col === c.col && t.row === c.row);

/** P0 runner at (4,4) with a P1 Guard beside it at (4,5). Mid-board, no terrain, nothing adjacent. */
function pinned(): { s: GameState; runner: string; guard: string } {
  const s = freshGame({ extraCards: GUARD_DEFS });
  const r = debugSpawn(s, 'runner', 0, { col: 4, row: 4 });
  const g = debugSpawn(s, 'guardsman', 1, { col: 4, row: 5 });
  return { s, runner: r.id, guard: g.id };
}

describe('the pin — you may not walk away from a Guard', () => {
  it('holds: every empty destination must still be beside the Guard', () => {
    const { s, runner, guard } = pinned();
    expect(isPinnedByGuard(s, s.units[runner]!)).toBe(true);
    const tiles = moveTiles(s, runner);
    // The Guard sits at (4,5). Its other three tiles are (3,5), (5,5) and (4,6) — but only tiles
    // the runner can actually REACH in one step matter, and from (4,4) that is none of them.
    expect(tiles.length, 'walking away is not on the menu').toBe(0);
    expect(s.units[guard]).toBeDefined();
  });

  it('but the Guard itself is always a legal target — this is why a pin is not a lock', () => {
    const { s, runner, guard } = pinned();
    const attacks = legalActions(s).filter(
      (a) => a.t === 'Move' && a.unit === runner && a.to.col === 4 && a.to.row === 5,
    );
    expect(attacks.length, 'you can always swing at what is holding you').toBe(1);
    const after = applyAction(s, { t: 'Move', unit: runner, to: { col: 4, row: 5 } });
    // 20 into a 30 defender: the runner dies. The point is that the ACTION was available.
    expect(after.units[guard]).toBeDefined();
  });

  it('and shuffling to the Guard’s other tiles is legal — the second escape', () => {
    const s = freshGame({ extraCards: GUARD_DEFS });
    // Runner at (4,4) is adjacent to the Guard at (5,4); (5,3) and (5,5) are also beside it, and
    // both are two steps away — so give the runner the reach to use them.
    const r = debugSpawn(s, 'runner', 0, { col: 4, row: 4 });
    r.extraMove = 1;
    debugSpawn(s, 'guardsman', 1, { col: 5, row: 4 });
    const tiles = moveTiles(s, r.id);
    expect(has(tiles, { col: 5, row: 3 }), 'still beside the Guard: allowed').toBe(true);
    expect(has(tiles, { col: 5, row: 5 }), 'still beside the Guard: allowed').toBe(true);
    expect(has(tiles, { col: 2, row: 4 }), 'two tiles away: refused').toBe(false);
    expect(has(tiles, { col: 4, row: 2 }), 'two tiles away: refused').toBe(false);
  });

  it('is a DESTINATION rule, not a route rule — extra reach buys more of the ring, never an exit', () => {
    // ⚠ The first draft asserted "three steps of reach and nowhere to land", which was simply
    // wrong: more reach lets you walk AROUND to the Guard's far tiles. That is correct and is the
    // interesting property — the pin bounds where you may STOP, not how far you may travel.
    const s = freshGame({ extraCards: GUARD_DEFS });
    const r = debugSpawn(s, 'runner', 0, { col: 4, row: 4 });
    r.extraMove = 2;
    debugSpawn(s, 'guardsman', 1, { col: 4, row: 5 });
    const tiles = moveTiles(s, r.id);
    expect(tiles.length, 'three steps reaches the far side of the Guard').toBeGreaterThan(0);
    for (const c of tiles) {
      const beside = Math.abs(c.col - 4) + Math.abs(c.row - 5) === 1;
      expect(beside, `(${c.col},${c.row}) must still be beside the Guard`).toBe(true);
    }
  });

  it('an unpinned unit keeps its full range — the pin is not a blanket movement nerf', () => {
    const s = freshGame({ extraCards: GUARD_DEFS });
    const r = debugSpawn(s, 'runner', 0, { col: 4, row: 4 });
    debugSpawn(s, 'guardsman', 1, { col: 4, row: 6 }); // two tiles away: not adjacent
    expect(isPinnedByGuard(s, s.units[r.id]!)).toBe(false);
    expect(moveTiles(s, r.id).length).toBe(4);
  });
});

describe('who Guards, and who gets pinned', () => {
  it('LEADERS ARE PINNED — CC-immunity covers statuses, and a pin is not a status', () => {
    const s = freshGame({ extraCards: GUARD_DEFS });
    const l = leaderOf(s, 0);
    teleport(s, l.id, { col: 4, row: 4 });
    debugSpawn(s, 'guardsman', 1, { col: 4, row: 5 });
    expect(isPinnedByGuard(s, s.units[l.id]!)).toBe(true);
    expect(moveTiles(s, l.id).length).toBe(0);
    // ...and the leader's escape is the same as everyone's: hit the thing holding it.
    expect(
      legalActions(s).some((a) => a.t === 'Move' && a.unit === l.id && a.to.col === 4 && a.to.row === 5),
    ).toBe(true);
  });

  it('a SICK Guard does not pin — no emergency screens', () => {
    const s = freshGame({ extraCards: GUARD_DEFS });
    const r = debugSpawn(s, 'runner', 0, { col: 4, row: 4 });
    debugSpawn(s, 'guardsman', 1, { col: 4, row: 5 }, { sick: true });
    expect(isPinnedByGuard(s, s.units[r.id]!)).toBe(false);
    expect(moveTiles(s, r.id).length).toBe(3); // (4,5) is occupied, so 3 empty neighbours
  });

  it('a TOKEN Guard does not pin — a token engine would make the pin free and endless', () => {
    const s = freshGame({ extraCards: GUARD_DEFS });
    const r = debugSpawn(s, 'runner', 0, { col: 4, row: 4 });
    const g = debugSpawn(s, 'guardsman', 1, { col: 4, row: 5 });
    g.isToken = true;
    expect(isPinnedByGuard(s, s.units[r.id]!)).toBe(false);
  });

  it('a FRIENDLY Guard does not pin — it screens for you, not against you', () => {
    const s = freshGame({ extraCards: GUARD_DEFS });
    const r = debugSpawn(s, 'runner', 0, { col: 4, row: 4 });
    debugSpawn(s, 'guardsman', 0, { col: 4, row: 5 });
    expect(isPinnedByGuard(s, s.units[r.id]!)).toBe(false);
  });

  it('two Guards INTERSECT: a tile that satisfies one but not the other is refused', () => {
    // ⚠ Shown as a CONTROL PAIR rather than an exact tile list. Two Guards adjacent to the same
    // victim tend to sit ON the only routes to their shared tiles, so "the intersection" is usually
    // unreachable and an exact-list assertion just measures pathing. The rule is the delta below.
    const build = (second: boolean) => {
      const s = freshGame({ extraCards: GUARD_DEFS });
      const r = debugSpawn(s, 'runner', 0, { col: 4, row: 4 });
      r.extraMove = 1;
      debugSpawn(s, 'guardsman', 1, { col: 4, row: 5 });
      if (second) debugSpawn(s, 'guardsman', 1, { col: 4, row: 3 });
      return { s, id: r.id };
    };
    const one = build(false);
    expect(has(moveTiles(one.s, one.id), { col: 3, row: 5 }), 'beside the only Guard: allowed').toBe(true);

    const two = build(true);
    expect(isPinnedByGuard(two.s, two.s.units[two.id]!)).toBe(true);
    expect(
      has(moveTiles(two.s, two.id), { col: 3, row: 5 }),
      'beside the first Guard but not the second: refused',
    ).toBe(false);
  });
});

describe('the counterplay', () => {
  it('DISPLACEMENT escapes the pin — forced movement is not the unit’s move', () => {
    // The pin lives in `reachableDestinations`, which is the unit's OWN movement. Push/Pull do not
    // route through it, so a shove is the designed way out — and `Anchored` is the answer to that.
    const s = freshGame({ extraCards: { ...GUARD_DEFS, ...SHOVE } });
    const r = debugSpawn(s, 'runner', 1, { col: 4, row: 4 });
    // Beside the victim, NOT in the push lane: P0's leader starts at (4,1), so the shove drives the
    // runner down-board to (4,5), and a Guard standing there would simply block it.
    debugSpawn(s, 'guardsman', 0, { col: 5, row: 4 });
    expect(isPinnedByGuard(s, s.units[r.id]!), 'control: it is pinned first').toBe(true);
    s.players[0].hand = ['shove'];
    s.players[0].sp = 8;
    const after = applyAction(s, { t: 'CastSpell', card: 'shove', targets: [{ col: 4, row: 4 }] });
    const moved = after.units[r.id]!;
    expect(moved.pos, 'shoved clear of the Guard').toEqual({ col: 4, row: 5 });
    expect(isPinnedByGuard(after, moved)).toBe(false);
  });

  it('SUPPRESSED turns Guard off, free, because hasKeyword is the single chokepoint', () => {
    const s = freshGame({ extraCards: GUARD_DEFS });
    const r = debugSpawn(s, 'runner', 0, { col: 4, row: 4 });
    const g = debugSpawn(s, 'guardsman', 1, { col: 4, row: 5 });
    expect(isPinnedByGuard(s, s.units[r.id]!), 'control: it pins while unsuppressed').toBe(true);
    g.statuses = [
      ...(g.statuses ?? []),
      { id: 'test-suppress', kind: 'Suppressed', amount: 0, duration: { kind: 'permanent' } },
    ];
    expect(isPinnedByGuard(s, s.units[r.id]!)).toBe(false);
    expect(moveTiles(s, r.id).length).toBe(3);
  });

  it('a pinned RANGED unit still shoots — the pin restricts movement, nothing else', () => {
    const s = freshGame({ extraCards: GUARD_DEFS });
    const bow = debugSpawn(s, 'longbow', 0, { col: 4, row: 4 });
    debugSpawn(s, 'guardsman', 1, { col: 4, row: 5 });
    expect(isPinnedByGuard(s, s.units[bow.id]!)).toBe(true);
    expect(
      legalActions(s).some((a) => a.t === 'RangedAttack' && a.unit === bow.id),
      'the pin took its feet, not its bow',
    ).toBe(true);
  });
});

describe('Guard no longer touches combat at all', () => {
  it('a Guard beside its leader does NOT intercept an attack on that leader', () => {
    // The whole of the old spec, now deliberately absent: the keyword decides where you may GO,
    // never who you end up fighting.
    const s = freshGame({ extraCards: GUARD_DEFS });
    debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 6 }); // 45 ATK, one step from P1's leader
    const g = debugSpawn(s, 'guardsman', 1, { col: 3, row: 7 });
    const after = applyAction(s, { t: 'Move', unit: 'u1', to: { col: 4, row: 7 } });
    expect(after.players[1].leaderLife, 'the leader takes the hit itself').toBe(RULES.startingLife - 45);
    expect(after.units[g.id], 'the Guard is untouched').toBeDefined();
  });
});
