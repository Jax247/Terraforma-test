// "Expert" policy: the Hard beam search, with the two structural flaws that made it blind to
// support cards fixed. Same Policy seam, same evaluator, same fingerprint/replan machinery.
//
// WHY A THIRD TIER RATHER THAN A BETTER `hard`
// Instrumented self-play (2026-08-01) showed the Hard bot skips support for two independent
// reasons, only one of which is a weights problem:
//
//   1. VALUE. Whole categories of card are worth nothing to `evaluate` — a Draw-1 cantrip is
//      ±0 cards and ±0 SP, so it is neutral BY CONSTRUCTION and can never clear actionEpsilon.
//      Fixed in evaluate.ts by the support terms, which default to 0 so Normal/Hard are
//      unchanged; EXPERT_WEIGHTS below is what turns them on.
//
//   2. TIMING. `search.ts` ranks its beam by STATIC eval (search.ts, `children.sort`). Every
//      setup action dips before it pays: Warcry Chant measured max +56.7 / median −6.0, because
//      it is only ever good as buff-then-swing. A −6 node is pruned out of an 8-wide beam long
//      before the +56.7 continuation is ever expanded. No weight can fix that; the SHAPE of the
//      search has to change. Two changes here do it:
//        * setupQuota — reserve beam slots for lines whose last action was a support action, so
//          they cannot be crowded out by a pile of ordinary moves.
//        * the one-ply peek — rank a setup child by what its BEST follow-up achieves, not by
//          the dip. Restricted to setup children because they are the ones that dip, which
//          keeps the extra cost proportional to how much support is actually in hand.
//
// Deliberately NOT MCTS/expectimax: `fingerprint` is JSON.stringify of the whole dynamic state,
// so thousands of rollouts are expensive, and the measured deficit was search shape, not node
// count. Hard's beam 8 × depth 8 ≈ 1150 nodes ≈ 80ms of its 4000ms budget — there was never a
// time problem to solve.

import { applyAction, enumerateBoundActions, mulberry32, tileAt } from '../engine';
import type { Action, GameState, PlayerId } from '../engine';
import { DEFAULT_WEIGHTS, evaluate } from './evaluate';
import type { EvalWeights } from './evaluate';
import { makeGreedyPolicy, playTurn } from './greedy';
import type { Policy } from './greedy';
import { fingerprint } from './search';
import type { SearchSettings } from './search';
import { sanitize } from './sanitize';
import type { AiKnowledge } from './sanitize';

/**
 * Weights with the support terms live. Sizes are anchored to the existing scale: a hand card is
 * worth `handCard` 10, so ±4 is a meaningful but not dominant adjustment to what a card is worth.
 *
 * `stunnedAtk` used to live here too. It moved into DEFAULT_WEIGHTS on 2026-08-02: sigils let the
 * BOARD stun a unit, so a bot blind to stuns walks onto marked ground at any tier — that is board
 * safety, not an Expert-tier reading of support cards.
 */
export const EXPERT_WEIGHTS: EvalWeights = {
  ...DEFAULT_WEIGHTS,
  // A live card is worth more than a dead one. The GAP is what matters, not the absolute
  // values: it is what makes cycling a clogged hand +EV and a cantrip worth its own slot.
  handPlayableBonus: 4,
  handDeadPenalty: 4,
  // Above `handCard` − `setCard` (the 1-point cost of setting), so moving a trap into a live
  // lane beats leaving it parked, without making the bot set its whole hand face-down.
  trapZoneThreat: 8,
  // A tile of reach is worth well under a point of ATK; this only needs to outweigh the
  // actionEpsilon so GrantMove stops reading as a strict loss.
  extraMoveTile: 3,
};

/**
 * Expert-tier search effort. Same knobs as Hard except the budget: Expert counts NODES where
 * Hard counts milliseconds.
 *
 * WHY (2026-08-01): a `Date.now()` deadline makes how much of the tree gets searched a function
 * of machine load, so the same seed can play a different game on a busy machine than on an idle
 * one. Hard gets away with it because its beam 8 × depth 8 ≈ 1150 nodes ≈ 80ms never comes near
 * its 4000ms — the check is effectively dead code. Expert's beam 16 × rollout 3 DOES hit a 2000ms
 * deadline once boards get large, and it was measured doing so: two identical
 * `ab defense --seeds 1 --policy expert` runs produced a byte-identical control arm and a variant
 * arm differing on nearly every metric. A node budget is a pure function of the position, so the
 * tier is reproducible run-to-run and comparable across machines. Latency floats instead — see
 * `EXPERT_NODE_BUDGET` for the sizing.
 */
export interface ExpertSearchSettings extends Omit<SearchSettings, 'timeBudgetMs'> {
  /** Max nodes expanded per `planTurn` — beam children AND one-ply peeks share the pool. */
  nodeBudget: number;
}

/**
 * Sized to clip the same tail the old 2000ms clock clipped, at the same latency ceiling — the
 * point of the swap is reproducibility, not a strength change.
 *
 * Measured over 313 searches of UNBUDGETED Expert self-play (probe-deck gauntlet + a registered
 * matchup, 2026-08-01): nodes median 1,489 / p90 20,970 / p95 30,886 / max 76,014; wall time
 * median 303ms / p95 1,882ms / max 4,381ms. So the old 2000ms deadline was already cutting
 * roughly the top 5% of searches short — it just cut them in a different place on every run.
 * 30,000 binds on about that same 5%, and at the ~58µs/node the large searches actually cost,
 * caps a turn near 1.7s — inside the old ceiling. The median turn is nowhere near the budget and
 * is unaffected. Raise it for a stronger, slower bot; the cost is linear and the play stays
 * reproducible at any value.
 */
export const EXPERT_NODE_BUDGET = 30000;

export const EXPERT_SEARCH_SETTINGS: ExpertSearchSettings = {
  beamWidth: 16,
  maxPlanLength: 10,
  replyCandidates: 10,
  // 3 (vs Hard's 2) is what lets a turn-ending be judged on OUR follow-up turn as well as
  // their reply — the horizon a "set up now, cash in next turn" line needs to be visible at all.
  rolloutTurns: 3,
  nodeBudget: EXPERT_NODE_BUDGET,
};

/** What one `planTurn` call actually cost. `exhausted` means the budget bound and the search was
 *  cut short — a run where this fires often is a run whose strength is budget-limited. */
export interface PlanStats {
  nodes: number;
  exhausted: boolean;
}

export interface ExpertOptions extends Partial<ExpertSearchSettings> {
  weights?: EvalWeights;
  seed?: number;
  /** Default 'fog' since 2026-08-02 — even Expert plans against the cards it could legally know. */
  knowledge?: AiKnowledge;
  maxActionsPerTurn?: number;
  onCandidateError?: (a: Action, e: unknown) => void;
  /** Beam slots reserved per depth for lines ending in a support action. Default 4. */
  setupQuota?: number;
  /** Called once per planTurn with what the search cost. For instrumentation only. */
  onPlanStats?: (stats: PlanStats) => void;
}

/**
 * Actions whose payoff is never in the resulting position — buffs, displacement, denial,
 * economy, arming a trap, changing stance. These are exactly the moves whose static eval
 * understates them, so they are the ones that get the quota and the lookahead peek.
 */
function isSetupAction(a: Action, before: GameState): boolean {
  if (a.t === 'CastSpell' || a.t === 'FlipCard' || a.t === 'SetCard' || a.t === 'MoveSet' || a.t === 'SetStance') {
    return true;
  }
  // ⚠ A FUSE IS A SETUP ACTION (2026-08-08), and the most extreme one in the game. It is a `Move`
  // onto a FRIENDLY unit, so it never matched the card-action list above — and it dips harder than
  // anything that did: measured, the fuse scores a median 156 points BELOW the best alternative,
  // because two bodies cover the board and one cannot. The payoff lands on the follow-up, now that
  // a fusion inherits its materials' unspent action and can swing the turn it forms. Ranking it by
  // the dip is exactly the failure this whole function exists to prevent.
  if (a.t !== 'Move') return false;
  const occ = tileAt(before.board, a.to).occupant;
  if (occ?.kind !== 'unit') return false;
  const target = before.units[occ.id];
  return target !== undefined && target.owner === before.active && !target.isLeader;
}

interface Node {
  state: GameState;
  plan: Action[];
  /** Static eval of `state`. */
  score: number;
  /** Whether the action that produced this node was a setup play — see `isSetupAction`. */
  isSetup: boolean;
  /** Ranking key: `score` for ordinary nodes, best-follow-up score for setup nodes. */
  rank: number;
}

/** One planTurn's node allowance. `spend()` charges a node and returns true when the budget is
 *  gone — call it at the point the old code checked the clock, i.e. before doing the work. */
interface Budget {
  spend(): boolean;
  readonly spent: number;
  readonly exhausted: boolean;
}

function makeBudget(limit: number): Budget {
  let spent = 0;
  let exhausted = false;
  return {
    spend(): boolean {
      if (spent >= limit) {
        exhausted = true;
        return true;
      }
      spent++;
      return false;
    },
    get spent(): number {
      return spent;
    },
    get exhausted(): boolean {
      return exhausted;
    },
  };
}

export function makeExpertPolicy(opts: ExpertOptions = {}): Policy {
  const weights = opts.weights ?? EXPERT_WEIGHTS;
  const knowledge = opts.knowledge ?? 'fog';
  const beamWidth = opts.beamWidth ?? EXPERT_SEARCH_SETTINGS.beamWidth;
  const maxPlanLength = opts.maxPlanLength ?? EXPERT_SEARCH_SETTINGS.maxPlanLength;
  const replyCandidates = opts.replyCandidates ?? EXPERT_SEARCH_SETTINGS.replyCandidates;
  const rolloutTurns = opts.rolloutTurns ?? EXPERT_SEARCH_SETTINGS.rolloutTurns;
  const nodeBudget = opts.nodeBudget ?? EXPERT_SEARCH_SETTINGS.nodeBudget;
  const setupQuota = opts.setupQuota ?? 4;
  const maxActionsPerTurn = opts.maxActionsPerTurn ?? 60;
  const onCandidateError =
    opts.onCandidateError ?? ((a, e) => console.warn('expert: candidate action threw', a, e));
  const onPlanStats = opts.onPlanStats;
  const rnd = opts.seed !== undefined ? mulberry32(opts.seed) : undefined;

  /**
   * Best score reachable one action after `node` — the payoff a setup action was played FOR.
   * Ranking setup children by this is what keeps `warcryChant → attack` alive in the beam
   * instead of pruning it on the buff's own −6.
   *
   * Peeks draw on the SAME node budget as the beam: a peek costs an applyAction + an evaluate,
   * the same work a beam child costs, and charging it keeps the budget a bound on total work
   * rather than on one half of it.
   */
  function bestFollowUp(node: Node, seat: PlayerId, budget: Budget): number {
    let best = node.score;
    for (const a of enumerateBoundActions(node.state)) {
      if (a.t === 'EndTurn') continue;
      if (budget.spend()) break;
      try {
        const s = applyAction(node.state, a);
        s.log = [];
        const v = evaluate(s, seat, weights);
        if (v > best) best = v;
      } catch (e) {
        onCandidateError(a, e);
      }
    }
    return best;
  }

  /** Score a turn-ending after simulating `rolloutTurns` greedy turns, from our seat.
   *  The stand-in uses OUR weights, so the opponent model is not blind to the same
   *  things we just stopped being blind to. */
  function afterReplyScore(node: Node, seat: PlayerId): number {
    // A line that already ENDED the game has no turn to end and no reply to model — its static
    // score is the whole truth. (Winning lines return early from `search`; this is the other
    // side of that: a line that ends in our own loss, e.g. walking a leader into lethal. Without
    // the guard the EndTurn below throws "game is over" into `onCandidateError`.)
    if (node.state.phase === 'gameover') return node.score;
    let cur: GameState;
    try {
      cur = applyAction(node.state, { t: 'EndTurn' });
    } catch (e) {
      onCandidateError({ t: 'EndTurn' }, e);
      return node.score;
    }
    cur.log = [];
    try {
      for (let i = 0; i < rolloutTurns && cur.phase !== 'gameover'; i++) {
        cur = playTurn(cur, makeGreedyPolicy({ weights, onCandidateError }));
      }
    } catch (e) {
      onCandidateError({ t: 'EndTurn' }, e);
      return node.score;
    }
    return evaluate(cur, seat, weights);
  }

  /** Keep the top `beamWidth` by rank, then top up with the best setup lines that missed the
   *  cut. Without the top-up a hand full of ordinary moves crowds support out entirely. */
  function selectBeam(children: Node[]): Node[] {
    const sorted = [...children].sort((a, b) => b.rank - a.rank);
    const keep = sorted.slice(0, beamWidth);
    if (setupQuota <= 0 || keep.length < beamWidth) return keep;
    const chosen = new Set(keep);
    for (const n of sorted) {
      if (chosen.size >= beamWidth + setupQuota) break;
      if (chosen.has(n)) continue;
      if (n.isSetup) chosen.add(n);
    }
    return [...chosen];
  }

  function planTurn(view: GameState, seat: PlayerId): Action[] {
    const budget = makeBudget(nodeBudget);
    try {
      return search(view, seat, budget);
    } finally {
      onPlanStats?.({ nodes: budget.spent, exhausted: budget.exhausted });
    }
  }

  function search(view: GameState, seat: PlayerId, budget: Budget): Action[] {
    const rootState: GameState = { ...view, log: [] };
    const rootScore = evaluate(rootState, seat, weights);
    const root: Node = { state: rootState, plan: [], score: rootScore, rank: rootScore, isSetup: false };

    const endpoints = new Map<string, Node>();
    const rootFp = fingerprint(rootState);
    if (!rootState.pendingBurn) endpoints.set(rootFp, root);

    const seen = new Set<string>([rootFp]);
    let frontier: Node[] = [root];

    expand: for (let depth = 0; depth < maxPlanLength && frontier.length > 0; depth++) {
      const children: Node[] = [];
      for (const node of frontier) {
        for (const a of enumerateBoundActions(node.state)) {
          if (a.t === 'EndTurn') continue;
          if (budget.spend()) break expand; // keep whatever endpoints we have
          let next: GameState;
          try {
            next = applyAction(node.state, a);
          } catch (e) {
            onCandidateError(a, e);
            continue;
          }
          next.log = [];
          const fp = fingerprint(next);
          if (seen.has(fp)) continue;
          seen.add(fp);
          const score = evaluate(next, seat, weights);
          const setup = isSetupAction(a, node.state);
          const child: Node = { state: next, plan: [...node.plan, a], score, rank: score, isSetup: setup };
          if (next.winner === seat) return child.plan;
          // Setup actions are ranked by their PAYOFF, not by the dip they cost.
          if (setup && !next.pendingBurn) child.rank = bestFollowUp(child, seat, budget);
          children.push(child);
          if (!next.pendingBurn) endpoints.set(fp, child);
        }
      }
      frontier = selectBeam(children);
    }

    // Rank turn-endings by their HONEST static score, not by `rank`. The peeked rank is a
    // keep-exploring signal — it asks "what could this line still become". A turn-ending has no
    // follow-up by definition, so judging one on a follow-up it will never get would promote
    // lines that end on an unpaid setup (a buff cast and then not swung) into the expensive
    // reply-sim pool, at the expense of endings that are actually good.
    const ranked = [...endpoints.values()].sort((a, b) => b.score - a.score);
    const pool = ranked.slice(0, replyCandidates);
    if (!rootState.pendingBurn && !pool.includes(root)) pool.push(root);
    if (pool.length === 0) {
      const partial = frontier[0] ?? ranked[0];
      return partial ? partial.plan : [];
    }

    let best: Node = pool[0]!;
    let bestScore = -Infinity;
    for (const node of pool) {
      let score = afterReplyScore(node, seat) - weights.actionEpsilon * node.plan.length;
      if (rnd) score += (rnd() - 0.5) * weights.actionEpsilon * 0.99;
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    return best.plan;
  }

  let pending: { queue: Action[]; expected: GameState } | null = null;
  let turnKey = '';
  let actionsThisTurn = 0;

  return (s: GameState, seat: PlayerId): Action => {
    if (s.active !== seat) throw new Error(`expert asked to act for seat ${seat} but it is seat ${s.active}'s turn`);

    const key = `${seat}:${s.players[seat].turnCount}`;
    if (key !== turnKey) {
      turnKey = key;
      actionsThisTurn = 0;
      pending = null;
    }

    const view = knowledge === 'fog' ? sanitize(s, seat) : s;

    if (actionsThisTurn >= maxActionsPerTurn) {
      pending = null;
      if (!view.pendingBurn) return { t: 'EndTurn' };
    }

    if (pending && fingerprint(view) !== fingerprint(pending.expected)) pending = null;

    if (!pending || pending.queue.length === 0) {
      const plan = planTurn(view, seat);
      if (plan.length === 0) {
        if (!view.pendingBurn) return { t: 'EndTurn' };
        const forced = enumerateBoundActions(view)[0];
        if (!forced) throw new Error('expert: forced choice with no legal actions');
        return forced;
      }
      pending = { queue: plan, expected: { ...view, log: [] } };
    }

    const act = pending.queue.shift()!;
    if (pending.queue.length > 0) {
      try {
        pending.expected = applyAction(pending.expected, act);
        pending.expected.log = [];
      } catch (e) {
        onCandidateError(act, e);
        pending = null;
      }
    } else {
      pending = null;
    }
    actionsThisTurn += 1;
    return act;
  };
}
