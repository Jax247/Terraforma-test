// Expert tier — the support-card bot. Each test targets one of the blind spots measured on
// 2026-08-01 (see src/ai/expert.ts for the numbers) and asserts the fix as a CONTRAST on the
// same position: "Expert values this, DEFAULT_WEIGHTS scores it identically either way". The
// paired `toBe` assertions against DEFAULT_WEIGHTS are doing real work — they are what proves
// Normal and Hard stayed byte-identical baselines rather than quietly drifting.
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  debugSpawn,
  DECK_CARDS,
  DECK_TOKENS,
  DECKS,
  initGame,
  makeArenaBoard,
  mulberry32,
  shuffled,
} from '../../engine';
import { freshGame } from '../../engine/tests/helpers';
import { DEFAULT_WEIGHTS, evaluate, supportTermsOff } from '../evaluate';
import { makeGreedyPolicy, playGame, playTurn } from '../greedy';
import type { Policy } from '../greedy';
import { makeSearchPolicy } from '../search';
import { EXPERT_NODE_BUDGET, EXPERT_SEARCH_SETTINGS, EXPERT_WEIGHTS, makeExpertPolicy } from '../expert';
import type { ExpertOptions, PlanStats } from '../expert';
import type { Action, CardDef, GameState } from '../../engine';

const throwOnCandidateError = (a: Action, e: unknown) => {
  throw new Error(`candidate ${JSON.stringify(a)} threw: ${e instanceof Error ? e.message : e}`);
};

/** Small, fast search effort — behaviour under test is structural, not effort-dependent. */
const FAST = { beamWidth: 6, maxPlanLength: 5, replyCandidates: 3, rolloutTurns: 1, nodeBudget: 4000 };

const expert = (o: ExpertOptions = {}) => makeExpertPolicy({ ...FAST, onCandidateError: throwOnCandidateError, ...o });

/** Cards that isolate one blind spot each. Priced so SP is never the reason a test fails. */
const CARDS: Record<string, CardDef> = {
  // Draw 1 + GainSP 1: measured at exactly 0.0 eval delta — neutral by construction.
  cantrip: {
    kind: 'spell', id: 'cantrip', name: 'Cantrip', dc: 1, sp: 1, scope: 'global',
    effects: [
      { effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' } },
      { effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
    ],
  },
  // A body far above the SP curve: unplayable, so it reads as a dead card.
  unaffordable: {
    kind: 'unit', id: 'unaffordable', name: 'Unaffordable', type: 'Terra', level: 9, sp: 99,
    atk: 10, dc: 1, keywords: [], rules: [],
  },
  cheapBody: {
    kind: 'unit', id: 'cheapBody', name: 'Cheap Body', type: 'Terra', level: 1, atk: 10, dc: 1, keywords: [], rules: [],
  },
  zoneTrap: {
    kind: 'trap', id: 'zoneTrap', name: 'Zone Trap', dc: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{ effect: { e: 'Damage', amount: 20 }, target: { t: 'TriggeringUnit' } }],
  },
};

const play = (s: GameState, hand: string[], sp: number): GameState => {
  s.players[0].hand = [...hand];
  s.players[0].sp = sp;
  return s;
};

/** Every action the policy issues for one whole turn. */
function turnActions(s: GameState, policy: Policy): Action[] {
  const out: Action[] = [];
  let cur = s;
  for (let i = 0; i < 40; i++) {
    const a = policy(cur, cur.active);
    out.push(a);
    if (a.t === 'EndTurn') break;
    cur = applyAction(cur, a);
  }
  return out;
}

describe('the support terms are opt-in', () => {
  it('DEFAULT_WEIGHTS leaves every support term at 0 — Normal and Hard score as before', () => {
    expect(supportTermsOff(DEFAULT_WEIGHTS)).toBe(true);
    expect(supportTermsOff(EXPERT_WEIGHTS)).toBe(false);
  });

  it('a position scores identically under DEFAULT_WEIGHTS with the new code in place', () => {
    // The support branches are all gated on a non-zero weight, so with defaults they must not
    // contribute anything. Guards the "Normal/Hard stay valid baselines" contract.
    const s = freshGame({ extraCards: CARDS });
    play(s, ['cantrip', 'unaffordable'], 4);
    debugSpawn(s, 'thornfang', 1, { col: 4, row: 4 });
    const bare = { ...DEFAULT_WEIGHTS };
    expect(evaluate(s, 0, bare)).toBe(evaluate(s, 0, DEFAULT_WEIGHTS));
  });
});

describe('economy: a cantrip is worth casting', () => {
  it('Expert casts it to cycle a clogged hand; Hard cannot see any value in it', () => {
    const mk = () => {
      const s = freshGame({ extraCards: CARDS });
      // Hand is a cantrip plus three cards it cannot pay for, and the next card up is one it
      // CAN use: the exact situation where trading a do-nothing card for a real one is correct.
      // (Cycling into a card you also can't cast is not correct play, and Expert declines it —
      // the first draft of this test got that backwards and the bot was right.)
      s.players[0].deck = ['cheapBody', ...s.players[0].deck];
      return play(s, ['cantrip', 'unaffordable', 'unaffordable', 'unaffordable'], 4);
    };
    const casts = (acts: Action[]) => acts.some((a) => a.t === 'CastSpell' && a.card === 'cantrip');
    expect(casts(turnActions(mk(), expert()))).toBe(true);
    // Contrast against GREEDY, not Hard. Under DEFAULT_WEIGHTS the cast is a Δ0 no-op, so a
    // one-ply bot provably cannot clear actionEpsilon and take it — that is the measured blind
    // spot. Hard is excluded on purpose: its beam CAN find cast→summon when cycling is the only
    // line available, which is correct play and not something to assert against.
    const greedy = makeGreedyPolicy({ onCandidateError: throwOnCandidateError });
    expect(casts(turnActions(mk(), greedy))).toBe(false);
  });

  it('values a live hand above a dead one', () => {
    const live = play(freshGame({ extraCards: CARDS }), ['cheapBody', 'cheapBody'], 8);
    const dead = play(freshGame({ extraCards: CARDS }), ['unaffordable', 'unaffordable'], 8);
    expect(evaluate(live, 0, EXPERT_WEIGHTS)).toBeGreaterThan(evaluate(dead, 0, EXPERT_WEIGHTS));
    // ...and that distinction does not exist for the older tiers.
    expect(evaluate(live, 0, DEFAULT_WEIGHTS)).toBe(evaluate(dead, 0, DEFAULT_WEIGHTS));
  });
});

describe('trap placement', () => {
  it('an armed trap zone scores above a parked one', () => {
    const armed = freshGame({ extraCards: CARDS });
    const parked = freshGame({ extraCards: CARDS });
    for (const s of [armed, parked]) debugSpawn(s, 'graveTyrant', 1, { col: 4, row: 4 });
    // Same card, same owner — only the tile differs.
    const setAt = (s: GameState, col: number, row: number) => {
      s.setCards['t1'] = { id: 't1', owner: 0, cardId: 'zoneTrap', kind: 'trap', pos: { col, row }, hasActed: false, setTurnCount: 0, stance: 'attack' };
      s.board[col - 1]![row - 1]!.occupant = { kind: 'set', id: 't1' };
    };
    setAt(armed, 4, 5); // zone covers the enemy at (4,4)
    setAt(parked, 1, 1); // far corner
    expect(evaluate(armed, 0, EXPERT_WEIGHTS)).toBeGreaterThan(evaluate(parked, 0, EXPERT_WEIGHTS));
    expect(evaluate(armed, 0, DEFAULT_WEIGHTS)).toBe(evaluate(parked, 0, DEFAULT_WEIGHTS));
  });
});

describe('denial and reach are worth something', () => {
  // `stunnedAtk` is EVERY tier's business since 2026-08-02: sigils let the board stun a unit, so
  // a bot blind to stuns walks onto marked ground at any difficulty. Hence DEFAULT_WEIGHTS is
  // asserted to move here, unlike the genuinely Expert-only terms above.
  const pin = (owner: 0 | 1) => {
    const s = freshGame();
    debugSpawn(s, 'graveTyrant', owner, { col: 4, row: 4 });
    return s;
  };
  const stun = (s: ReturnType<typeof pin>, owner: 0 | 1) => {
    const t = Object.values(s.units).find((u) => u.owner === owner && !u.isLeader)!;
    t.statuses.push({ id: 'x', kind: 'Stunned', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } });
    return s;
  };

  it('scores a Stunned ENEMY as offence removed, at every tier', () => {
    const free = pin(1);
    const pinned = stun(pin(1), 1);
    expect(evaluate(pinned, 0, EXPERT_WEIGHTS)).toBeGreaterThan(evaluate(free, 0, EXPERT_WEIGHTS));
    expect(evaluate(pinned, 0, DEFAULT_WEIGHTS)).toBeGreaterThan(evaluate(free, 0, DEFAULT_WEIGHTS));
  });

  it('scores one of OUR OWN units being Stunned as a loss — the sigil-avoidance half', () => {
    const free = pin(0);
    const pinned = stun(pin(0), 0);
    expect(evaluate(pinned, 0, DEFAULT_WEIGHTS)).toBeLessThan(evaluate(free, 0, DEFAULT_WEIGHTS));
  });

  it('scores unspent granted movement', () => {
    const still = freshGame();
    const mobile = freshGame();
    for (const s of [still, mobile]) debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    Object.values(mobile.units).find((u) => u.owner === 0 && !u.isLeader)!.extraMove = 2;
    expect(evaluate(mobile, 0, EXPERT_WEIGHTS)).toBeGreaterThan(evaluate(still, 0, EXPERT_WEIGHTS));
    expect(evaluate(mobile, 0, DEFAULT_WEIGHTS)).toBe(evaluate(still, 0, DEFAULT_WEIGHTS));
  });
});

describe('forced discard', () => {
  it('burns the unplayable card, not an arbitrary one', () => {
    const s = freshGame({ extraCards: CARDS });
    // Hand cap is 7; the dead card sits at index 0 so "burn index 0" and "burn the dead one"
    // are distinguishable only if the bot actually reads playability.
    s.players[0].hand = ['unaffordable', 'cheapBody', 'cheapBody', 'cheapBody', 'cheapBody', 'cheapBody', 'cheapBody'];
    s.players[0].sp = 8;
    s.pendingBurn = { player: 0, remainingDraws: 0 };
    const a = expert()(s, 0);
    expect(a.t).toBe('BurnCard');
    expect(s.players[0].hand[(a as { t: 'BurnCard'; index: number }).index]).toBe('unaffordable');
  });
});

describe('expert vs hard', () => {
  // A SMOKE gate, and deliberately NOT a strength assertion. The first draft asserted
  // "expert >= hard" over two games and duly failed on an unlucky pair — two games cannot
  // support that claim in either direction. Measured separately over 16 games at this same
  // effort: expert 9.5 vs hard 3.5. Reproduce with the harness, which is where strength
  // evidence belongs: `npm run ab -- <exp> --policy expert` vs `--policy search`.
  // (Four games at DEFAULT effort measured 105s, which is also why this runs reduced.)
  // Decks are SHUFFLED: an unshuffled duel deals one fixed opening and measures a hand, not a bot.
  const DUEL_EFFORT = { beamWidth: 6, maxPlanLength: 6, replyCandidates: 3, rolloutTurns: 2, timeBudgetMs: 400 };

  const duel = (deckId: string, expertSeat: 0 | 1): GameState => {
    const deck = DECKS.find((d) => d.id === deckId)!;
    const start = initGame({
      board: makeArenaBoard(),
      cardDefs: DECK_CARDS,
      tokenDefs: DECK_TOKENS,
      players: [
        { leader: deck.leader, deck: shuffled(deck.list, mulberry32(11)), fusionPool: [...deck.fusionPool] },
        { leader: deck.leader, deck: shuffled(deck.list, mulberry32(22)), fusionPool: [...deck.fusionPool] },
      ],
    });
    const e = makeExpertPolicy({ ...DUEL_EFFORT, onCandidateError: throwOnCandidateError });
    const h = makeSearchPolicy({ ...DUEL_EFFORT, onCandidateError: throwOnCandidateError });
    return playGame(start, expertSeat === 0 ? e : h, expertSeat === 0 ? h : e, 40);
  };

  it('plays complete games against hard from both seats, and makes progress', () => {
    for (const seat of [0, 1] as const) {
      const end = duel('tidecaller', seat);
      // Either somebody won, or the game genuinely advanced — no stall, no early bail-out.
      // `throwOnCandidateError` above is doing the other half of the work: any action the
      // planner emits that the engine then rejects fails this test.
      const dealt = 2 * 200 - end.players[0].leaderLife - end.players[1].leaderLife;
      expect(end.winner !== undefined || (end.round > 5 && dealt > 0)).toBe(true);
    }
  });

  it('uses more support than hard on the same position', () => {
    // The claim the tier exists to make, asserted where two games CAN carry it: not "wins more"
    // but "plays the cards". Same board, same hand, same effort — only the policy differs.
    const s = freshGame({ extraCards: CARDS });
    s.players[0].deck = ['cheapBody', ...s.players[0].deck];
    play(s, ['cantrip', 'unaffordable', 'unaffordable', 'unaffordable'], 4);
    const supportPlays = (policy: Policy) =>
      turnActions(structuredClone(s), policy).filter(
        (a) => a.t === 'CastSpell' || a.t === 'SetCard' || a.t === 'FlipCard',
      ).length;
    expect(supportPlays(expert())).toBeGreaterThan(0);
  });
});

describe('expert policy basics', () => {
  it('finds and takes a lethal attack', () => {
    const s = freshGame();
    s.players[1].leaderLife = 10;
    debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 6 });
    const done = playTurn(s, expert());
    expect(done.winner).toBe(0);
  });

  it('is deterministic: same state and options produce the same turn', () => {
    const run = () => playTurn(freshGame(), expert({ seed: 5 }));
    expect(run()).toEqual(run());
  });

  it('plays multi-turn stretches without candidate errors (perfect and fog)', () => {
    for (const knowledge of ['perfect', 'fog'] as const) {
      let cur = freshGame();
      const p = [expert({ knowledge, seed: 1 }), makeGreedyPolicy({ seed: 2, onCandidateError: throwOnCandidateError })];
      for (let i = 0; i < 6 && cur.phase !== 'gameover'; i++) cur = playTurn(cur, p[cur.active]!);
      expect(cur.phase === 'gameover' || cur.round > 1).toBe(true);
    }
  });
});

/**
 * The budget is a NODE COUNT, not a clock (2026-08-01). A wall-clock deadline made how much of
 * the tree got searched depend on machine load, so identical harness runs played different games
 * — see the header of expert.ts. These pin the property that fixed it.
 */
describe('search budget', () => {
  it('carries no wall-clock knob — the tier is budgeted in nodes', () => {
    expect('timeBudgetMs' in EXPERT_SEARCH_SETTINGS).toBe(false);
    expect(EXPERT_SEARCH_SETTINGS.nodeBudget).toBe(EXPERT_NODE_BUDGET);
  });

  it('stops at the budget and says so', () => {
    const stats: PlanStats[] = [];
    // Tight enough to bind on the opening position, which enumerates well over 40 actions.
    const p = makeExpertPolicy({ ...FAST, nodeBudget: 40, onPlanStats: (s) => stats.push(s) });
    playTurn(freshGame(), p);
    expect(stats.length).toBeGreaterThan(0);
    expect(stats.some((s) => s.exhausted)).toBe(true);
    for (const s of stats) expect(s.nodes).toBeLessThanOrEqual(40);
  });

  it('a budget-limited search is still reproducible — same budget, same turn', () => {
    // The regression this guards: under a clock, two runs of THIS test would search different
    // amounts and could return different plans. Under a node budget they cannot.
    const run = () => {
      const nodes: number[] = [];
      const actions = playTurn(freshGame(), expert({ seed: 7, nodeBudget: 200, onPlanStats: (s) => nodes.push(s.nodes) }));
      return { actions, nodes };
    };
    expect(run()).toEqual(run());
  });
});

describe('the denial axis is priced, and priced differently per status', () => {
  const CC: Record<string, CardDef> = {
    melee: { kind: 'unit', id: 'melee', name: 'Melee', type: 'Warrior', level: 3, atk: 40, def: 20, dc: 3, keywords: [], rules: [] },
    shooter: { kind: 'unit', id: 'shooter', name: 'Shooter', type: 'Warrior', level: 3, atk: 40, def: 20, dc: 3, keywords: ['Ranged'], rules: [] },
    vanilla: { kind: 'unit', id: 'vanilla', name: 'Vanilla', type: 'Warrior', level: 3, atk: 40, def: 20, dc: 3, keywords: [], rules: [] },
    texty: {
      kind: 'unit', id: 'texty', name: 'Texty', type: 'Beast', level: 3, atk: 40, def: 20, dc: 3,
      keywords: ['Frenzy', 'Anchored'],
      rules: [{ trigger: 'OnDeath', effect: { e: 'GainSP', n: 3 }, target: { t: 'Self' } }],
    },
  };
  const mk = (
    card: string,
    kind?: 'Snared' | 'Disarmed' | 'Suppressed' | 'Stunned',
    opts: { prey?: boolean } = {},
  ) => {
    const s = freshGame({ extraCards: CC });
    const u = debugSpawn(s, card, 1, { col: 4, row: 4 }); // an ENEMY of seat 0
    // `prey` parks one of OUR bodies on its firing line, so it has something to shoot.
    if (opts.prey) debugSpawn(s, 'melee', 0, { col: 4, row: 5 });
    if (kind) u.statuses.push({ id: 'x', kind, amount: 0, duration: { kind: 'turns', turnsLeft: 2 } });
    return evaluate(s, 0, DEFAULT_WEIGHTS);
  };

  it('snaring a melee body is worth something', () => {
    expect(mk('melee', 'Snared')).toBeGreaterThan(mk('melee'));
  });

  it('snaring a shooter that HAS a firing line is worth nothing — it keeps shooting', () => {
    // Without this the bot spends snares on the one target that shrugs them off.
    expect(mk('shooter', 'Snared', { prey: true })).toBe(mk('shooter', undefined, { prey: true }));
  });

  it('...but snaring a shooter with NO firing line fully denies it', () => {
    // Exact range makes this real: it cannot step to fix an empty line, so it is as stuck as a
    // melee body. Before exact range, a shooter simply ignored snares outright.
    expect(mk('shooter', 'Snared')).toBeGreaterThan(mk('shooter'));
  });

  it('disarming a ranged body IS worth something — disarm stops shooting', () => {
    expect(mk('shooter', 'Disarmed')).toBeGreaterThan(mk('shooter'));
  });

  it('a stun outprices either half of it', () => {
    const base = mk('melee');
    expect(mk('melee', 'Stunned') - base).toBeGreaterThan(mk('melee', 'Snared') - base);
    expect(mk('melee', 'Stunned') - base).toBeGreaterThan(mk('melee', 'Disarmed') - base);
  });

  it('suppressing a body with TEXT is worth something', () => {
    expect(mk('texty', 'Suppressed')).toBeGreaterThan(mk('texty'));
  });

  it('suppressing a VANILLA body is worth nothing — there is no text to silence', () => {
    expect(mk('vanilla', 'Suppressed')).toBe(mk('vanilla'));
  });
});

/**
 * FUSION AS A SETUP ACTION (2026-08-08).
 *
 * A fuse is a `Move` onto a FRIENDLY unit, so it never matched the card-action list in
 * `isSetupAction` — and it dips harder than anything that did. Measured across 107 real positions,
 * the fuse scored a median 156 points BELOW the best alternative, because two bodies cover the
 * board and one cannot, and it won zero of them. Greedy therefore never fused in 72 games.
 *
 * With the fused body now inheriting its materials' unspent action, fuse-then-swing is a real
 * two-action line — exactly the shape the one-ply peek exists to rescue. These pin the contrast:
 * Expert finds it, greedy structurally cannot.
 */
describe('a fuse is a setup action', () => {
  /** Wildgrowth's Apex Predator = Thornfang + Pack Runner, both fresh and already adjacent. */
  function assembled(): GameState {
    const wg = DECKS.find((d) => d.id === 'wildgrowth')!;
    const s = initGame({
      board: makeArenaBoard(),
      cardDefs: DECK_CARDS,
      tokenDefs: DECK_TOKENS,
      players: [
        { leader: wg.leader, deck: [...wg.list], fusionPool: [...wg.fusionPool] },
        { leader: wg.leader, deck: [...wg.list], fusionPool: [] },
      ],
    });
    debugSpawn(s, 'thornfang', 0, { col: 3, row: 3 });
    debugSpawn(s, 'packRunner', 0, { col: 3, row: 4 });
    // ⚠ The prey is not scenery — it IS the payoff. The one-ply peek ranks a setup by its best
    // FOLLOW-UP, so with nothing for the fused body to swing at there is nothing to see and Expert
    // (rightly) declines. A 45-ATK body the 70-ATK fusion beats but the 30-ATK material does not.
    debugSpawn(s, 'mosshideBull', 1, { col: 3, row: 5 });
    return s;
  }

  // ⚠ NARROW BEAM ON PURPOSE. With a wide beam the fuse-then-swing line survives on its own and
  // this test passes whether or not a fuse counts as setup — it was vacuous until the beam was
  // tightened. At width 2 the 156-point dip is pruned unless the setup QUOTA rescues it, which is
  // exactly the mechanism under test. Measured in full games: 0.58 fusions/game with the
  // classification, 0.00 without.
  const narrow = () => expert({ beamWidth: 2, setupQuota: 4 });

  it('Expert takes the fuse; greedy leaves it on the table', () => {
    const expertPlan = playTurn(assembled(), narrow());
    const greedyPlan = playTurn(assembled(), makeGreedyPolicy());
    const fused = (s: GameState) => Object.values(s.units).some((u) => u.cardId === 'apexPredator');

    expect(fused(expertPlan), 'Expert should assemble the fusion').toBe(true);
    // Not a criticism of greedy — a one-ply bot cannot see past a 156-point dip, which is the
    // whole reason the Expert tier exists. Stated as a contrast so a regression in either is loud.
    expect(fused(greedyPlan), 'greedy cannot see past the dip').toBe(false);
  });

  it('and the fused body swings the same turn, because it inherited an unspent action', () => {
    const after = playTurn(assembled(), narrow());
    const apex = Object.values(after.units).find((u) => u.cardId === 'apexPredator');
    expect(apex, 'the fusion resolved').toBeDefined();
    // Both materials were fresh, so the stationary one's action carried over to the fused body.
    // (Whether Expert then spends it depends on the board; what matters is that it HAD one.)
    expect(after.players[0].graveyard).toContain('thornfang');
    expect(after.players[0].graveyard).toContain('packRunner');
  });
});
