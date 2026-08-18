import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, effectiveAtk, leaderOf, RULES } from '../../engine';
import type { CardDef, GameState } from '../../engine';
import { DECK_CARDS } from '../../engine/content/decks';
import { freshGame } from '../../engine/tests/helpers';
import { DEFAULT_WEIGHTS, evaluate, projectedFatigueLp } from '../evaluate';
import type { EvalWeights } from '../evaluate';

// Zero-sum requires offense == defense and no aggression ramp (the ramp is
// perspective-keyed by design: it only sharpens the side asking the question).
// `desperationPush` is off for the same reason — it scales the asker's march only.
const SYMMETRIC: EvalWeights = {
  ...DEFAULT_WEIGHTS,
  leaderExposure: DEFAULT_WEIGHTS.leaderThreat,
  leaderThreatRamp: 0,
  lifeDiffRamp: 0,
  desperationPush: 0,
};

describe('evaluate', () => {
  it('is zero-sum when offense and defense are weighted equally', () => {
    const s = freshGame();
    debugSpawn(s, 'thornfang', 0, { col: 4, row: 2 });
    debugSpawn(s, 'duneshambler', 1, { col: 4, row: 6 });
    expect(evaluate(s, 0, SYMMETRIC)).toBeCloseTo(-evaluate(s, 1, SYMMETRIC), 8);
  });

  it('more material scores higher', () => {
    const s = freshGame();
    const before = evaluate(s, 0);
    debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 2 });
    expect(evaluate(s, 0)).toBeGreaterThan(before);
    // ...and the opponent sees the mirror image.
    expect(evaluate(s, 1)).toBeLessThan(0);
  });

  it('a decided game dominates any material swing', () => {
    const s = freshGame();
    // Give P1 a massive material lead, then declare P0 the winner anyway.
    for (const [i, pos] of [[1, 5], [2, 5], [3, 5], [5, 5], [6, 5]].entries()) {
      debugSpawn(s, i % 2 ? 'graveTyrant' : 'sandRevenant', 1, { col: pos[0]!, row: pos[1]! });
    }
    s.winner = 0;
    s.phase = 'gameover';
    expect(evaluate(s, 0)).toBe(DEFAULT_WEIGHTS.win);
    expect(evaluate(s, 1)).toBe(-DEFAULT_WEIGHTS.win);
  });

  it('killing an enemy unit beats a neutral move', () => {
    let s = freshGame();
    debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 4 }); // 45 ATK attacker
    debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 5 }); // 15 ATK victim
    const kill = evaluate(applyAction(s, { t: 'Move', unit: 'u1', to: { col: 4, row: 5 } }), 0);
    const shuffle = evaluate(applyAction(s, { t: 'Move', unit: 'u1', to: { col: 3, row: 4 } }), 0);
    expect(kill).toBeGreaterThan(shuffle);
  });

  it('SP has value: casting an economy spell is an eval gain, not a card loss', () => {
    const s = freshGame({ extraCards: DECK_CARDS });
    s.players[0].hand = ['corpseTithe', 'thornfang', 'thornfang'];
    const before = evaluate(s, 0);
    // Corpse Tithe: −1 card cast, +2 SP, +1 card drawn — net positive now that SP counts.
    const after = evaluate(applyAction(s, { t: 'CastSpell', card: 'corpseTithe' }), 0);
    expect(after).toBeGreaterThan(before);
  });

  it('threatened chip: an adjacent enemy is priced as a fraction of the LP it can take', () => {
    // Isolate the term from the exposure gradient and the LP ramp.
    const off: EvalWeights = { ...DEFAULT_WEIGHTS, leaderExposure: 0, lifeDiffRamp: 0, threatChipFrac: 0 };
    const on: EvalWeights = { ...off, threatChipFrac: 0.5 };
    const s = freshGame();
    const u = debugSpawn(s, 'thornfang', 1, { col: 4, row: 2 }); // orth-adjacent to P0's leader at (4,1)
    const leader = leaderOf(s, 0);
    const chip = effectiveAtk(s, u, { role: 'attacker', battleTile: leader.pos, opponentId: leader.id });
    expect(evaluate(s, 0, off) - evaluate(s, 0, on)).toBeCloseTo(0.5 * off.lifeDiff * chip, 8);
  });

  it('threatened chip ignores diagonal units — they cannot reach the leader next turn', () => {
    const off: EvalWeights = { ...DEFAULT_WEIGHTS, leaderExposure: 0, lifeDiffRamp: 0, threatChipFrac: 0 };
    const on: EvalWeights = { ...off, threatChipFrac: 0.5 };
    const s = freshGame();
    debugSpawn(s, 'thornfang', 1, { col: 3, row: 2 }); // diagonal to (4,1)
    expect(evaluate(s, 0, on)).toBeCloseTo(evaluate(s, 0, off), 8);
  });

  it('threatened chip stays zero-sum under symmetric weights', () => {
    const s = freshGame();
    debugSpawn(s, 'thornfang', 0, { col: 4, row: 6 });     // adjacent to P1's leader at (4,7)
    debugSpawn(s, 'duneshambler', 1, { col: 4, row: 2 });  // adjacent to P0's leader at (4,1)
    expect(evaluate(s, 0, SYMMETRIC)).toBeCloseTo(-evaluate(s, 1, SYMMETRIC), 8);
  });

  it('GUARD: the pin is priced by what it holds, and stays zero-sum', () => {
    // Replaces an interception test deleted with the 2026-08-09 re-spec. `pinnedAtk` credits each
    // ENEMY unit our Guards are holding, scaled by its effective ATK.
    const guardsman: CardDef = {
      kind: 'unit', id: 'guardsman', name: 'Guardsman', type: 'Verdant', level: 3, atk: 30, def: 15, dc: 4,
      keywords: ['Guard'], rules: [],
    };
    // ⚠ Built on SYMMETRIC, not DEFAULT_WEIGHTS: the defaults are deliberately NOT zero-sum
    // (the aggression ramp is perspective-keyed), so the symmetry assertion below needs the same
    // base the file's other zero-sum tests use.
    const off: EvalWeights = { ...SYMMETRIC, pinnedAtk: 0 };
    const on: EvalWeights = { ...off, pinnedAtk: 1 };
    const s = freshGame({ extraCards: { guardsman } });
    debugSpawn(s, 'duneshambler', 1, { col: 4, row: 4 });
    // Control: nothing is pinned yet, so the term must be worth exactly nothing.
    expect(evaluate(s, 0, on)).toBeCloseTo(evaluate(s, 0, off), 8);

    debugSpawn(s, 'guardsman', 0, { col: 4, row: 5 }); // now P0 holds it
    const held = evaluate(s, 0, on) - evaluate(s, 0, off);

    // ⚠ EXACT MAGNITUDE, not `toBeGreaterThan(0)`. `evaluate()` is already
    // `sideScore(me) − sideScore(opp)`, so a term signed by ownership double-counts — and a
    // double-count is still perfectly ANTISYMMETRIC, which means the zero-sum check below cannot
    // see it. The first draft of this test asserted only symmetry and sign, and both mutations
    // (zeroing the weight, and signing it by ownership) passed. Pinning the exact value is what
    // makes the test load-bearing.
    const victim = Object.values(s.units).find((u) => u.owner === 1 && !u.isLeader)!;
    expect(held, 'holding an enemy is worth exactly its effective ATK, once').toBeCloseTo(
      effectiveAtk(s, victim), 8,
    );
    expect(evaluate(s, 0, on)).toBeCloseTo(-evaluate(s, 1, on), 8);

    // And the term must ship ENABLED — zeroing the default is a silent way to delete the mechanic.
    expect(DEFAULT_WEIGHTS.pinnedAtk).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Deck depth / fatigue clock
  // -------------------------------------------------------------------------

  /** Weights isolating the deck-depth terms: no ramps, no positional noise. */
  const clockOff: EvalWeights = {
    ...DEFAULT_WEIGHTS,
    lifeDiffRamp: 0, leaderThreatRamp: 0, threatChipFrac: 0,
    fatigueFrac: 0, desperationPush: 0,
  };

  it('projects nothing while the deck is deeper than the horizon', () => {
    const s = freshGame();
    expect(projectedFatigueLp(s, 0, 10)).toBe(0);
    // Exactly at the horizon is still safe: d cards cover d draws.
    s.players[0].deck = Array(10).fill('thornfang');
    expect(projectedFatigueLp(s, 0, 10)).toBe(0);
  });

  it('projects the escalating fatigue ladder once the deck runs short', () => {
    const s = freshGame();
    s.players[0].deck = Array(7).fill('thornfang'); // 3 missed draws inside a 10-turn horizon
    expect(projectedFatigueLp(s, 0, 10)).toBe(RULES.fatigueStep * (1 + 2 + 3));
    // A player already two ticks into fatigue pays 3+4+5, not 1+2+3.
    s.players[0].fatigue = 2;
    expect(projectedFatigueLp(s, 0, 10)).toBe(RULES.fatigueStep * (3 + 4 + 5));
  });

  it('never projects more damage than the player has LP left', () => {
    const s = freshGame();
    s.players[0].deck = [];
    s.players[0].leaderLife = 25;
    expect(projectedFatigueLp(s, 0, 10)).toBe(25);
  });

  it('a shallow deck is priced as a fraction of the LP it will cost', () => {
    const on: EvalWeights = { ...clockOff, fatigueFrac: 0.5 };
    const s = freshGame();
    s.players[0].deck = Array(8).fill('thornfang'); // 2 misses → 10 + 20 LP
    const debt = projectedFatigueLp(s, 0, on.fatigueHorizon);
    expect(evaluate(s, 0, clockOff) - evaluate(s, 0, on)).toBeCloseTo(0.5 * on.lifeDiff * debt, 8);
    // ...and the opponent's shallow deck is worth exactly as much the other way.
    expect(evaluate(s, 1, on) - evaluate(s, 1, clockOff)).toBeCloseTo(0.5 * on.lifeDiff * debt, 8);
  });

  it('the deck-depth debt stays zero-sum under symmetric weights', () => {
    const s = freshGame();
    s.players[0].deck = Array(4).fill('thornfang');
    s.players[1].deck = Array(9).fill('thornfang');
    s.players[1].fatigue = 1;
    expect(evaluate(s, 0, SYMMETRIC)).toBeCloseTo(-evaluate(s, 1, SYMMETRIC), 8);
  });

  it('desperation sharpens aggression when the clock is losing the game', () => {
    // Same board, same LP: only P0's deck is empty. The march must be worth more to the player
    // who is about to fatigue out than to the one who is not.
    const on: EvalWeights = { ...clockOff, desperationPush: 1 };
    const near = { col: 4, row: 5 };
    const far = { col: 4, row: 3 };
    const gradient = (s: GameState, w: EvalWeights): number => {
      const a = evaluate(s, 0, w);
      const u = Object.values(s.units).find((x) => x.owner === 0 && !x.isLeader)!;
      u.pos = near;
      const b = evaluate(s, 0, w);
      u.pos = far;
      return b - a; // value of one step toward the enemy leader
    };
    const s = freshGame();
    debugSpawn(s, 'thornfang', 0, far);
    const calm = gradient(s, on);
    s.players[0].deck = [];
    const desperate = gradient(s, on);
    expect(desperate).toBeGreaterThan(calm);
    // With the knob at 0 the same board produces the same gradient — the term is the cause.
    s.players[0].deck = [];
    expect(gradient(s, clockOff)).toBeCloseTo(calm, 8);
  });

  it('clockPush fires where desperation cannot: a symmetric mutual deck-out', () => {
    // Both sides equal on LP and equally out of cards — nobody is behind, so the differential
    // term is exactly 0. This is the defense-mode wall mirror in miniature.
    const s = freshGame();
    debugSpawn(s, 'thornfang', 0, { col: 4, row: 3 });
    s.players[0].deck = [];
    s.players[1].deck = [];
    const desperationOnly: EvalWeights = { ...clockOff, desperationPush: 1 };
    const withClock: EvalWeights = { ...desperationOnly, clockPush: 1 };
    const gradient = (w: EvalWeights): number => {
      const u = Object.values(s.units).find((x) => x.owner === 0 && !x.isLeader)!;
      const before = evaluate(s, 0, w);
      u.pos = { col: 4, row: 4 }; // one step toward the enemy leader
      const after = evaluate(s, 0, w);
      u.pos = { col: 4, row: 3 };
      return after - before;
    };
    expect(gradient(desperationOnly)).toBeCloseTo(gradient(clockOff), 8); // differential term: silent
    expect(gradient(withClock)).toBeGreaterThan(gradient(desperationOnly)); // absolute term: not
  });

  it('desperation is silent while the bot is winning the race', () => {
    const on: EvalWeights = { ...clockOff, desperationPush: 1 };
    const s = freshGame();
    debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    s.players[1].leaderLife = 40; // we are ahead on effective LP
    s.players[1].deck = Array(3).fill('thornfang'); // and they are the ones decking out
    expect(evaluate(s, 0, on)).toBeCloseTo(evaluate(s, 0, { ...on, desperationPush: 0 }), 8);
  });

  it('hand pressure: the 7th card is worth less than the 3rd', () => {
    const s = freshGame();
    s.players[0].hand = ['thornfang', 'thornfang'];
    const at2 = evaluate(s, 0);
    s.players[0].hand.push('thornfang');
    const third = evaluate(s, 0) - at2;
    s.players[0].hand = Array(6).fill('thornfang');
    const at6 = evaluate(s, 0);
    s.players[0].hand.push('thornfang');
    const seventh = evaluate(s, 0) - at6;
    expect(third).toBeCloseTo(DEFAULT_WEIGHTS.handCard, 8);
    expect(seventh).toBeCloseTo(DEFAULT_WEIGHTS.handCard - DEFAULT_WEIGHTS.handPressure, 8);
    expect(seventh).toBeLessThan(third);
  });
});

/**
 * The defense-stance terms (2026-08-04). Every one of these is written so that ZEROING the weight
 * under test makes it fail — the mutation check the last eval pass learned to demand, after
 * several first-draft terms turned out to have vacuous tests that passed either way.
 */
describe('defense stance is valued by what it actually buys', () => {
  // Attacker out-stats the wall on ATK but cannot break its DEF: 40 ATK vs 20 ATK / 60 DEF.
  const WALL: CardDef = {
    kind: 'unit', id: 'evalWall', name: 'Eval Wall', type: 'Warrior', level: 3,
    atk: 20, def: 60, dc: 3, keywords: [], rules: [],
  };
  const BREAKER: CardDef = {
    kind: 'unit', id: 'evalBreaker', name: 'Eval Breaker', type: 'Warrior', level: 3,
    atk: 40, def: 20, dc: 3, keywords: [], rules: [],
  };
  const LANCE: CardDef = {
    kind: 'unit', id: 'evalLance', name: 'Eval Lance', type: 'Warrior', level: 3,
    atk: 40, def: 20, dc: 3, keywords: ['Piercing'], rules: [],
  };
  // DEF *below* ATK, so the stat swap alone scores defending as a straight loss. This is the
  // shape the old evaluator could never defend with, and the shape most printed cards now have.
  const TROOPER: CardDef = {
    kind: 'unit', id: 'evalTrooper', name: 'Eval Trooper', type: 'Warrior', level: 3,
    atk: 40, def: 30, dc: 3, keywords: [], rules: [],
  };
  const HEAVY: CardDef = {
    kind: 'unit', id: 'evalHeavy', name: 'Eval Heavy', type: 'Warrior', level: 5,
    atk: 60, def: 30, dc: 4, keywords: [], rules: [],
  };

  /** Our body at (4,4), an enemy adjacent at (4,5) unless `alone`. */
  function faceOff(defender: string, attacker: string, opts: { alone?: boolean } = {}): GameState {
    const s = freshGame({
      extraCards: { evalWall: WALL, evalBreaker: BREAKER, evalLance: LANCE, evalTrooper: TROOPER, evalHeavy: HEAVY },
    });
    s.board[3]![3]!.terrain = 'Normal';
    s.board[4]![3]!.terrain = 'Normal';
    debugSpawn(s, defender, 0, { col: 4, row: 4 });
    if (!opts.alone) debugSpawn(s, attacker, 1, { col: 4, row: 5 });
    return s;
  }

  const stanceGain = (s: GameState, w: EvalWeights = DEFAULT_WEIGHTS): number => {
    const before = evaluate(s, 0, w);
    const u = Object.values(s.units).find((x) => x.owner === 0 && !x.isLeader)!;
    u.stance = 'defense';
    return evaluate(s, 0, w) - before;
  };

  it('an UNTHREATENED body loses by defending — the stance costs it its action', () => {
    // Nothing can reach it, so both new terms are 0 and only the DEF-for-ATK swap applies.
    // 60 DEF vs 20 ATK still wins on the swap alone, so use the breaker: 20 DEF vs 40 ATK.
    expect(stanceGain(faceOff('evalBreaker', 'evalWall', { alone: true }))).toBeLessThan(0);
  });

  it('a THREATENED body gains by defending EVEN WITH DEF BELOW ITS ATK', () => {
    // 40 ATK / 30 DEF facing 60 ATK. The stat swap alone says this is a loss (30 DEF is worth
    // less than 40 ATK) and the wall does not even hold — but in attack stance it dies AND pays
    // 20 overflow off our own leader, while a broken wall pays nothing. That denial is the whole
    // point, and it is exactly the case the pre-2026-08-04 evaluator scored backwards.
    const noTerms = { ...DEFAULT_WEIGHTS, wallDenyFrac: 0, wallReflectFrac: 0 };
    expect(stanceGain(faceOff('evalTrooper', 'evalHeavy'), noTerms)).toBeLessThan(0);
    expect(stanceGain(faceOff('evalTrooper', 'evalHeavy'))).toBeGreaterThan(0);
  });

  it('the deny term is load-bearing: zeroing it removes the gain', () => {
    const noDeny = { ...DEFAULT_WEIGHTS, wallDenyFrac: 0, wallReflectFrac: 0 };
    expect(stanceGain(faceOff('evalWall', 'evalBreaker'), noDeny))
      .toBeLessThan(stanceGain(faceOff('evalWall', 'evalBreaker')));
  });

  it('PIERCING denies nothing — it tramples the margin through the wall anyway', () => {
    const vsPlain = stanceGain(faceOff('evalWall', 'evalBreaker'));
    const vsPierce = stanceGain(faceOff('evalWall', 'evalLance'));
    expect(vsPierce).toBeLessThan(vsPlain);
  });

  it('an enemy LEADER is a real threat to defend against, but denies no overflow', () => {
    // Ruling 2026-08-04: a leader attacking a defending unit resolves on the same table. But
    // leader-vs-unit combat is binary and spills no LP either way, so there is nothing for the
    // stance to DENY — only reflect applies, which is priced at a fifth of deny.
    const s = freshGame({ extraCards: { evalWall: WALL } });
    s.board[3]![3]!.terrain = 'Normal';
    const wall = debugSpawn(s, 'evalWall', 0, { col: 4, row: 4 });
    const enemyLeader = leaderOf(s, 1);
    enemyLeader.pos = { col: 4, row: 5 };
    s.board[4]![3]!.occupant = { kind: 'unit', id: enemyLeader.id };
    const noTerms = { ...DEFAULT_WEIGHTS, wallDenyFrac: 0, wallReflectFrac: 0 };
    const before = evaluate(s, 0);
    const beforeBlind = evaluate(s, 0, noTerms);
    wall.stance = 'defense';
    // Isolate the two terms from the DEF-for-ATK stat swap, which fires either way.
    const termValue = (evaluate(s, 0) - before) - (evaluate(s, 0, noTerms) - beforeBlind);
    // The wall out-DEFs the leader, so REFLECT is live — the leader is a threat it can hold.
    expect(termValue).toBeGreaterThan(0);
    // But it is pure reflect: no deny, because leader-vs-unit spills no LP to deny.
    const reflect = 60 - effectiveAtk(s, leaderOf(s, 1), { role: 'attacker', battleTile: wall.pos, opponentId: wall.id });
    const life = DEFAULT_WEIGHTS.lifeDiff + DEFAULT_WEIGHTS.lifeDiffRamp * Math.max(0, s.players[0].turnCount - 1);
    expect(termValue).toBeCloseTo(life * DEFAULT_WEIGHTS.wallReflectFrac * reflect, 6);
  });

  it('reflect is priced well below the overflow it denies', () => {
    expect(DEFAULT_WEIGHTS.wallReflectFrac).toBeLessThan(DEFAULT_WEIGHTS.wallDenyFrac);
    expect(DEFAULT_WEIGHTS.wallReflectFrac).toBeLessThan(DEFAULT_WEIGHTS.threatChipFrac);
  });

  it('stays zero-sum — the terms are own-side only, never signed by ownership', () => {
    const s = faceOff('evalWall', 'evalBreaker');
    Object.values(s.units).find((x) => x.owner === 0 && !x.isLeader)!.stance = 'defense';
    expect(evaluate(s, 0, SYMMETRIC)).toBeCloseTo(-evaluate(s, 1, SYMMETRIC), 8);
  });
});
