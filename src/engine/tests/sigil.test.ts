// Sigils — marked ground that applies a status on ENTRY. Model (ii) of the terrain-CC design
// in the vault's Crowd Control & Status Effects.
//
// The load-bearing property is "on entry, never while standing": a while-standing stun would
// mean the victim cannot move, therefore cannot leave, therefore is stunned forever. The
// soft-lock tests below are what pin that down.
import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, isStunned, legalActions } from '../engine';
import { arenaLayout, boardFromLayout, layoutFromBoard, validateBoardLayout } from '../boardLayout';
import { effectiveAtk, effectiveDef } from '../stats';
import { RULES_DEFAULTS, resetRules, setRules } from '../rules';
import { endUntil, freshGame } from './helpers';
import { DEFAULT_WEIGHTS, evaluate, makeGreedyPolicy } from '../../ai';
import type { CardDef, Coord, GameState, SigilSpec } from '../types';
import type { BoardLayout } from '../boardLayout';

const CARDS: Record<string, CardDef> = {
  walker: {
    kind: 'unit', id: 'walker', name: 'Walker', type: 'Warrior', level: 2, atk: 30, def: 20, dc: 2,
    keywords: [], rules: [],
  },
  // Weak enough that Walker beats it outright — an equal-ATK body would mutually destruct
  // and there would be no advance to test.
  chaff: {
    kind: 'unit', id: 'chaff', name: 'Chaff', type: 'Warrior', level: 1, atk: 10, def: 10, dc: 1,
    keywords: [], rules: [],
  },
  // OnSummon push, so a test can shove a unit onto a sigil rather than walking it there.
  shover: {
    kind: 'unit', id: 'shover', name: 'Shover', type: 'Warrior', level: 2, atk: 30, def: 20, dc: 2,
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'Push', tiles: 1 }, target: { t: 'AdjacentEnemies' } }],
  },
  // Area3x3 takes the chosen tile as its centre — PaintTerrain needs a TILE target, and
  // there is no single-chosen-tile spec in the vocabulary.
  scrub: {
    kind: 'spell', id: 'scrub', name: 'Scrub', dc: 1, sp: 0, scope: 'global',
    effects: [{ effect: { e: 'PaintTerrain', terrain: 'Desert' }, target: { t: 'Area3x3' } }],
  },
};

/** A game whose board carries one sigil at `at`. */
function gameWithSigil(at: Coord, spec?: SigilSpec): GameState {
  const layout: BoardLayout = { ...arenaLayout(), sigils: [{ at, spec }] };
  const s = freshGame({ board: boardFromLayout(layout), extraCards: CARDS });
  // The lane these tests walk down, held neutral so terrain never skews a stat assertion.
  for (const row of [2, 3, 4]) s.board[3]![row - 1]!.terrain = 'Normal';
  return s;
}

afterEach(resetRules);

describe('a sigil fires on entry, however the unit arrived', () => {
  it('walking onto it applies the status', () => {
    let s = gameWithSigil({ col: 4, row: 4 });
    const u = debugSpawn(s, 'walker', 0, { col: 4, row: 3 });
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 4 } });
    expect(isStunned(s.units[u.id]!)).toBe(true);
  });

  it('being displaced onto it applies the status', () => {
    let s = gameWithSigil({ col: 4, row: 4 });
    const victim = debugSpawn(s, 'walker', 1, { col: 4, row: 3 });
    expect(isStunned(s.units[victim.id]!)).toBe(false);
    // Shover lands at (4,2); its OnSummon push shoves the adjacent enemy at (4,3) to (4,4).
    s.players[0].hand.push('shover');
    s.players[0].sp = 9;
    s = applyAction(s, { t: 'Summon', card: 'shover', tile: { col: 4, row: 2 } });
    expect(s.units[victim.id]!.pos).toEqual({ col: 4, row: 4 });
    expect(isStunned(s.units[victim.id]!)).toBe(true);
  });

  it('advancing onto it after a kill applies the status', () => {
    let s = gameWithSigil({ col: 4, row: 4 });
    const killer = debugSpawn(s, 'walker', 0, { col: 4, row: 3 });
    debugSpawn(s, 'chaff', 1, { col: 4, row: 4 });
    s = applyAction(s, { t: 'Move', unit: killer.id, to: { col: 4, row: 4 } });
    const after = s.units[killer.id]!;
    expect(after.pos).toEqual({ col: 4, row: 4 }); // advance-on-kill happened
    expect(isStunned(after)).toBe(true);
  });

  it('standing on it does NOT re-apply — this is what stops the soft-lock', () => {
    let s = gameWithSigil({ col: 4, row: 4 }, { status: 'Stunned', amount: 0, turns: 1 });
    const u = debugSpawn(s, 'walker', 0, { col: 4, row: 3 });
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 4 } });
    expect(isStunned(s.units[u.id]!)).toBe(true);
    // One own-turn later the stun has run out and is not renewed by simply being there.
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(isStunned(s.units[u.id]!)).toBe(true); // the 1 turn it costs
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(isStunned(s.units[u.id]!)).toBe(false);
    // ...and it can now walk off, which is the whole point.
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 3 } });
    expect(s.units[u.id]!.pos).toEqual({ col: 4, row: 3 });
  });

  it('re-entering refreshes the stun instead of stacking a second copy', () => {
    let s = gameWithSigil({ col: 4, row: 4 }, { status: 'Stunned', amount: 0, turns: 1 });
    const u = debugSpawn(s, 'walker', 0, { col: 4, row: 3 });
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 4 } });
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0); // the one turn it costs
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0); // free again
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 3 } });  // step off
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 4 } });  // and back on
    expect(s.units[u.id]!.statuses.filter((st) => st.kind === 'Stunned')).toHaveLength(1);
  });
});

describe('a sigil carries any status, not just Stunned', () => {
  it('an AtkMod sigil shifts effective ATK and leaves the unit able to act', () => {
    let s = gameWithSigil({ col: 4, row: 4 }, { status: 'AtkMod', amount: -20, turns: 2 });
    const u = debugSpawn(s, 'walker', 0, { col: 4, row: 3 });
    const base = effectiveAtk(s, u);
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 4 } });
    expect(effectiveAtk(s, s.units[u.id]!)).toBe(base - 20);
    expect(isStunned(s.units[u.id]!)).toBe(false);
  });

  it('a DefMod sigil shifts effective DEF', () => {
    let s = gameWithSigil({ col: 4, row: 4 }, { status: 'DefMod', amount: 20, turns: 2 });
    const u = debugSpawn(s, 'walker', 0, { col: 4, row: 3 });
    const base = effectiveDef(s, u);
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 4 } });
    expect(effectiveDef(s, s.units[u.id]!)).toBe(base + 20);
  });

  it('turns: 0 is inert', () => {
    let s = gameWithSigil({ col: 4, row: 4 }, { status: 'Stunned', amount: 0, turns: 0 });
    const u = debugSpawn(s, 'walker', 0, { col: 4, row: 3 });
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 4 } });
    expect(s.units[u.id]!.statuses).toEqual([]);
  });

  it('a leader is CC-immune and is billed in LP instead', () => {
    // Leaders live in a health-pool world (Combat Resolution: "binary for units, attritional
    // for the leader"), so marked ground charges them the only currency they have. A leader
    // that could be locked down could not flee, answer, or be played around.
    let s = gameWithSigil({ col: 4, row: 2 });
    const leader = Object.values(s.units).find((u) => u.isLeader && u.owner === 0)!;
    const before = s.players[0].leaderLife;
    s = applyAction(s, { t: 'Move', unit: leader.id, to: { col: 4, row: 2 } });
    expect(isStunned(s.units[leader.id]!)).toBe(false);
    expect(s.units[leader.id]!.statuses).toEqual([]);
    expect(s.players[0].leaderLife).toBe(before - RULES_DEFAULTS.sigilLeaderLp);
    // ...and it can still act on its very next turn.
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(legalActions(s).some((a) => 'unit' in a && a.unit === leader.id)).toBe(true);
  });

  it('bills the leader the same LP regardless of what the sigil carries', () => {
    for (const spec of [
      { status: 'AtkMod', amount: -20, turns: 2 },
      { status: 'DefMod', amount: 20, turns: 2 },
    ] as SigilSpec[]) {
      let s = gameWithSigil({ col: 4, row: 2 }, spec);
      const leader = Object.values(s.units).find((u) => u.isLeader && u.owner === 0)!;
      const before = s.players[0].leaderLife;
      s = applyAction(s, { t: 'Move', unit: leader.id, to: { col: 4, row: 2 } });
      expect(s.players[0].leaderLife).toBe(before - RULES_DEFAULTS.sigilLeaderLp);
      expect(s.units[leader.id]!.statuses).toEqual([]);
    }
  });

  it('sigilLeaderLp 0 makes sigils harmless to leaders', () => {
    setRules({ sigilLeaderLp: 0 });
    let s = gameWithSigil({ col: 4, row: 2 });
    const leader = Object.values(s.units).find((u) => u.isLeader && u.owner === 0)!;
    const before = s.players[0].leaderLife;
    s = applyAction(s, { t: 'Move', unit: leader.id, to: { col: 4, row: 2 } });
    expect(s.players[0].leaderLife).toBe(before);
  });

  it('a sigil can finish a leader that is already low', () => {
    setRules({ startingLife: RULES_DEFAULTS.sigilLeaderLp });
    let s = gameWithSigil({ col: 4, row: 2 });
    const leader = Object.values(s.units).find((u) => u.isLeader && u.owner === 0)!;
    s = applyAction(s, { t: 'Move', unit: leader.id, to: { col: 4, row: 2 } });
    expect(s.players[0].leaderLife).toBeLessThanOrEqual(0);
    expect(s.winner).toBe(1);
  });

});

describe('a sigil is a marker, not a terrain', () => {
  it('the tile keeps its own terrain and its type-vs-terrain swing', () => {
    const layout: BoardLayout = { ...arenaLayout(), sigils: [{ at: { col: 4, row: 4 } }] };
    layout.terrain[3]![3] = 'Grassland'; // Warrior's favoured ground
    const s = freshGame({ board: boardFromLayout(layout), extraCards: CARDS });
    const off = debugSpawn(s, 'walker', 0, { col: 4, row: 3 });
    const on = debugSpawn(s, 'walker', 1, { col: 4, row: 4 });
    expect(s.board[3]![3]!.terrain).toBe('Grassland');
    expect(effectiveAtk(s, on)).toBe(effectiveAtk(s, off) + 10); // +10 Grassland, undisturbed
  });

  it('painting the tile wipes the sigil', () => {
    let s = gameWithSigil({ col: 4, row: 4 });
    expect(s.board[3]![3]!.sigil).toBeDefined();
    s.players[0].hand.push('scrub');
    s = applyAction(s, { t: 'CastSpell', card: 'scrub', targets: [{ col: 4, row: 4 }] });
    expect(s.board[3]![3]!.terrain).toBe('Desert');
    expect(s.board[3]![3]!.sigil).toBeUndefined();
    // ...and a unit may now stand there freely.
    const u = debugSpawn(s, 'walker', 0, { col: 4, row: 3 });
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 4 } });
    expect(isStunned(s.units[u.id]!)).toBe(false);
  });

  it('a REFUSED paint on a Wall does not wipe the sigil', () => {
    const layout: BoardLayout = { ...arenaLayout(), sigils: [{ at: { col: 4, row: 4 } }] };
    layout.terrain[3]![3] = 'Wall';
    let s = freshGame({ board: boardFromLayout(layout), extraCards: CARDS });
    s.players[0].hand.push('scrub');
    s = applyAction(s, { t: 'CastSpell', card: 'scrub', targets: [{ col: 4, row: 4 }] });
    expect(s.board[3]![3]!.terrain).toBe('Wall');
    expect(s.board[3]![3]!.sigil).toBeDefined();
  });
});

describe('the RULES fallback is a default, the per-tile spec an override', () => {
  it('a spec-less sigil materialises the rules fallback at board-build time', () => {
    setRules({ sigilStatus: 'AtkMod', sigilAmount: -15, sigilTurns: 3 });
    const board = boardFromLayout({ ...arenaLayout(), sigils: [{ at: { col: 4, row: 4 } }] });
    expect(board[3]![3]!.sigil).toEqual({ status: 'AtkMod', amount: -15, turns: 3 });
  });

  it('an explicit spec beats the fallback', () => {
    setRules({ sigilStatus: 'AtkMod', sigilAmount: -15, sigilTurns: 3 });
    const spec: SigilSpec = { status: 'Stunned', amount: 0, turns: 1 };
    const board = boardFromLayout({ ...arenaLayout(), sigils: [{ at: { col: 4, row: 4 }, spec }] });
    expect(board[3]![3]!.sigil).toEqual(spec);
  });

  it('the shipping default is a 2-turn stun', () => {
    expect(RULES_DEFAULTS.sigilStatus).toBe('Stunned');
    expect(RULES_DEFAULTS.sigilTurns).toBe(2);
  });
});

describe('serialisation', () => {
  it('round-trips through board <-> layout with the spec made explicit', () => {
    const spec: SigilSpec = { status: 'DefMod', amount: 20, turns: 2 };
    const board = boardFromLayout({ ...arenaLayout(), sigils: [{ at: { col: 2, row: 2 }, spec }] });
    const back = layoutFromBoard(board);
    expect(back.sigils).toEqual([{ at: { col: 2, row: 2 }, spec }]);
  });

  it('omits the key entirely when no sigils exist, so old saves stay byte-identical', () => {
    expect(layoutFromBoard(boardFromLayout(arenaLayout())).sigils).toBeUndefined();
  });

  it('rejects a structurally broken sigil', () => {
    expect(() => boardFromLayout({ ...arenaLayout(), sigils: [{ at: { col: 9, row: 9 } }] }))
      .toThrow(/out of bounds/);
    const bad = { status: 'Nonsense', amount: 0, turns: 1 } as unknown as SigilSpec;
    expect(() => boardFromLayout({ ...arenaLayout(), sigils: [{ at: { col: 2, row: 2 }, spec: bad }] }))
      .toThrow(/unknown sigil status/);
  });
});

describe('validator', () => {
  function warnings(sigils: BoardLayout['sigils']): string[] {
    return validateBoardLayout({ ...arenaLayout(), sigils });
  }

  it('flags a sigil sitting on a spring', () => {
    // Arena springs are (2,4) and (6,4); both sit on the mirror axis so one entry is symmetric.
    expect(warnings([{ at: { col: 2, row: 4 } }]).join('\n')).toMatch(/sits on a spring/);
  });

  it('flags a sigil ringing a spring', () => {
    expect(warnings([{ at: { col: 2, row: 3 } }, { at: { col: 2, row: 5 } }]).join('\n'))
      .toMatch(/adjacent to the spring/);
  });

  it('flags an unmirrored sigil', () => {
    expect(warnings([{ at: { col: 1, row: 1 } }]).join('\n')).toMatch(/has no mirror/);
  });

  it('flags mirrored sigils whose effects differ', () => {
    const msgs = warnings([
      { at: { col: 1, row: 1 }, spec: { status: 'Stunned', amount: 0, turns: 2 } },
      { at: { col: 1, row: 7 }, spec: { status: 'Stunned', amount: 0, turns: 1 } },
    ]).join('\n');
    expect(msgs).toMatch(/carry different effects/);
  });

  it('accepts a properly mirrored pair away from the springs', () => {
    const clean = warnings([{ at: { col: 4, row: 2 } }, { at: { col: 4, row: 6 } }]);
    expect(clean.filter((m) => m.includes('sigil'))).toEqual([]);
  });

  it('flags a sigil on a Wall, which could never fire', () => {
    const layout: BoardLayout = { ...arenaLayout(), sigils: [{ at: { col: 1, row: 1 } }, { at: { col: 1, row: 7 } }] };
    layout.terrain[0]![0] = 'Wall';
    layout.terrain[0]![6] = 'Wall';
    expect(validateBoardLayout(layout).join('\n')).toMatch(/is on a Wall/);
  });
});

describe('the bot respects marked ground', () => {
  // None of this is sigil-specific bot code. A sigil stuns on ENTRY, so the state reached by
  // stepping onto one already carries the status, and `stunnedAtk` prices it. Note the own-side
  // penalty comes from evaluate() being sideScore(me) − sideScore(opp): our stunned unit scores
  // for the opponent and is subtracted. See the comment on that term before "fixing" it.
  const boardWith = (sigils: { col: number; row: number }[]) =>
    boardFromLayout({ ...arenaLayout(), sigils: sigils.map((at) => ({ at })) });

  it('the SAME move scores worse when the destination is marked', () => {
    // Isolates the sigil as the only variable — same unit, same tile, same distance travelled.
    const to = { col: 4, row: 5 };
    const score = (sigils: { col: number; row: number }[]) => {
      const s = freshGame({ board: boardWith(sigils), extraCards: CARDS });
      const u = debugSpawn(s, 'walker', 0, { col: 4, row: 4 });
      return evaluate(applyAction(s, { t: 'Move', unit: u.id, to }), 0, DEFAULT_WEIGHTS);
    };
    expect(score([to])).toBeLessThan(score([]));
  });

  it('greedy takes the tile straight toward the enemy leader — unless it is marked', () => {
    // The board is flattened to Normal on purpose: on the stock arena the terrain ATK swing at
    // (4,4) outweighs a one-tile aggression gain, so greedy sits still either way and the test
    // proves nothing. Neutral ground makes (4,5) unambiguously its best move, so refusing it is
    // attributable to the sigil alone.
    const sigil = { col: 4, row: 5 };
    const pick = (sigils: { col: number; row: number }[]) => {
      const s = freshGame({ board: boardWith(sigils), extraCards: CARDS });
      for (let c = 1; c <= 7; c++) for (let r = 1; r <= 7; r++) s.board[c - 1]![r - 1]!.terrain = 'Normal';
      debugSpawn(s, 'walker', 0, { col: 4, row: 4 });
      s.players[0].sp = 0; // no summons competing for the turn's best action
      return makeGreedyPolicy()(s, 0);
    };
    expect(pick([])).toMatchObject({ t: 'Move', to: sigil });   // it wants that tile
    expect(pick([sigil])).not.toMatchObject({ t: 'Move', to: sigil }); // ...but not marked
  });

  it('a stunned own unit is a liability the default weights can see', () => {
    const mk = () => {
      const g = freshGame({ board: boardWith([]), extraCards: CARDS });
      debugSpawn(g, 'walker', 0, { col: 4, row: 4 });
      return g;
    };
    const clean = mk();
    const hit = mk();
    Object.values(hit.units).find((x) => x.owner === 0 && !x.isLeader)!
      .statuses.push({ id: 'x', kind: 'Stunned', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } });
    expect(evaluate(hit, 0, DEFAULT_WEIGHTS)).toBeLessThan(evaluate(clean, 0, DEFAULT_WEIGHTS));
  });
});
