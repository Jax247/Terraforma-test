// "Hard" policy: plan a WHOLE turn, not one action. Beam search over action
// sequences finds multi-step lines a one-ply bot can't (setup actions that pay
// off later in the same turn), and every candidate turn-ending is scored AFTER
// simulating the opponent's best greedy reply — so the bot never ends a turn
// walking into lethal or a free blowout it could have prevented.
//
// It plugs into the same Policy seam as the greedy bot: the chosen plan is
// cached and replayed one action per call, with a state fingerprint check that
// forces a replan the moment reality diverges from the simulation (e.g. a
// fogged trap fired that the masked lookahead couldn't see).

import { applyAction, enumerateBoundActions, mulberry32 } from '../engine';
import type { Action, GameState, PlayerId } from '../engine';
import { DEFAULT_WEIGHTS, evaluate } from './evaluate';
import type { EvalWeights } from './evaluate';
import { makeGreedyPolicy, playTurn } from './greedy';
import type { Policy } from './greedy';
import { sanitize } from './sanitize';
import type { AiKnowledge } from './sanitize';

/** Search-effort knobs, separate from EvalWeights so behavior presets apply to both difficulties. */
export interface SearchSettings {
  /** Candidate lines kept per search depth. Wider = stronger and slower. */
  beamWidth: number;
  /** Max non-EndTurn actions planned ahead in one turn. */
  maxPlanLength: number;
  /** How many of the best turn-endings get a full opponent-reply simulation. */
  replyCandidates: number;
  /** Greedy turns simulated after each candidate turn-ending (1 = opponent's reply,
   *  2 = + our follow-up, 3 = + their second turn). Deeper sees past horizon effects. */
  rolloutTurns: number;
  /** Soft wall-clock budget (ms) for expanding the beam; the reply sims always run. */
  timeBudgetMs: number;
}

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  beamWidth: 8,
  maxPlanLength: 8,
  replyCandidates: 6,
  rolloutTurns: 2,
  timeBudgetMs: 4000,
};

export interface SearchOptions extends Partial<SearchSettings> {
  weights?: EvalWeights;
  /** Seeded tie-jitter (same generator as greedy) for variety. Omit for deterministic play. */
  seed?: number;
  /** 'fog' masks opponent hand/deck/face-down cards before planning. Default 'fog' — see `GreedyOptions`. */
  knowledge?: AiKnowledge;
  /** Hard cap on actions issued per turn (guard against replan churn). Default 60. */
  maxActionsPerTurn?: number;
  /** Called when a candidate action throws in simulation (enumerator/engine drift). Default: console.warn. */
  onCandidateError?: (a: Action, e: unknown) => void;
}

/**
 * Identity of a position for plan validation and transposition pruning.
 * Excludes the log (cosmetic) and the shared content registries (immutable).
 * Comparable across real and predicted states because both evolve through the
 * exact same applyAction calls when nothing diverged.
 */
export function fingerprint(s: GameState): string {
  const { cardDefs: _c, tokenDefs: _t, leaders: _l, log: _log, ...dynamic } = s;
  return JSON.stringify(dynamic);
}

interface Node {
  state: GameState;
  plan: Action[];
  /** Static eval — used to rank the beam; final choice uses the after-reply score. */
  score: number;
}

export function makeSearchPolicy(opts: SearchOptions = {}): Policy {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const knowledge = opts.knowledge ?? 'fog';
  const beamWidth = opts.beamWidth ?? DEFAULT_SEARCH_SETTINGS.beamWidth;
  const maxPlanLength = opts.maxPlanLength ?? DEFAULT_SEARCH_SETTINGS.maxPlanLength;
  const replyCandidates = opts.replyCandidates ?? DEFAULT_SEARCH_SETTINGS.replyCandidates;
  const rolloutTurns = opts.rolloutTurns ?? DEFAULT_SEARCH_SETTINGS.rolloutTurns;
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_SEARCH_SETTINGS.timeBudgetMs;
  const maxActionsPerTurn = opts.maxActionsPerTurn ?? 60;
  const onCandidateError =
    opts.onCandidateError ?? ((a, e) => console.warn('search: candidate action threw', a, e));
  const rnd = opts.seed !== undefined ? mulberry32(opts.seed) : undefined;

  /** Score a turn-ending: apply EndTurn, then let a fresh greedy stand-in play the
   *  next `rolloutTurns` whole turns (opponent's reply, our follow-up, …) with the
   *  same weights, and evaluate the aftermath from our seat. (Under fog the sim
   *  state already masks their hidden cards, so the reply model fights with their
   *  board but not their hand — the honest human-like bound.) */
  function afterReplyScore(node: Node, seat: PlayerId): number {
    // Terminal line: no turn to end, no reply to model. See the same guard in expert.ts.
    if (node.state.phase === 'gameover') return node.score;
    let cur: GameState;
    try {
      cur = applyAction(node.state, { t: 'EndTurn' });
    } catch (e) {
      onCandidateError({ t: 'EndTurn' }, e);
      return node.score; // engine drift: degrade to the static score
    }
    cur.log = [];
    try {
      for (let i = 0; i < rolloutTurns && cur.phase !== 'gameover'; i++) {
        // Fresh policy per turn: greedy keeps per-turn counters, and every rollout
        // replays the same turn numbers.
        cur = playTurn(cur, makeGreedyPolicy({ weights, onCandidateError }));
      }
    } catch (e) {
      onCandidateError({ t: 'EndTurn' }, e);
      return node.score;
    }
    return evaluate(cur, seat, weights);
  }

  /** Plan a chunk of the current turn from `view` (up to maxPlanLength actions).
   *  Returns [] when passing immediately beats every found line. The executor
   *  replans after the chunk runs out, so turns can extend past maxPlanLength
   *  as long as each extension keeps beating "end the turn here". */
  function planTurn(view: GameState, seat: PlayerId): Action[] {
    const deadline = Date.now() + timeBudgetMs;
    const rootState: GameState = { ...view, log: [] };
    const root: Node = { state: rootState, plan: [], score: evaluate(rootState, seat, weights) };

    // fp -> best node reaching that position; only legal turn-endings qualify
    // (a pendingBurn state cannot EndTurn, so it can't be where the turn stops).
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
          if (Date.now() > deadline) break expand; // keep whatever endpoints we have
          let next: GameState;
          try {
            next = applyAction(node.state, a);
          } catch (e) {
            onCandidateError(a, e);
            continue;
          }
          next.log = []; // keep clones lean; fingerprint ignores it anyway
          const fp = fingerprint(next);
          if (seen.has(fp)) continue; // transposition: same position via another order
          seen.add(fp);
          const child: Node = { state: next, plan: [...node.plan, a], score: evaluate(next, seat, weights) };
          if (next.winner === seat) return child.plan; // won mid-turn: commit immediately
          children.push(child);
          if (!next.pendingBurn) endpoints.set(fp, child);
        }
      }
      children.sort((a, b) => b.score - a.score);
      frontier = children.slice(0, beamWidth);
    }

    // Rank turn-endings statically, then let the top few (always including "pass
    // right away", when legal) prove themselves against the opponent's reply.
    const ranked = [...endpoints.values()].sort((a, b) => b.score - a.score);
    const pool = ranked.slice(0, replyCandidates);
    if (!rootState.pendingBurn && !pool.includes(root)) pool.push(root);
    if (pool.length === 0) {
      // Only reachable if every line is still mid-forced-choice at max depth;
      // fall back to the best partial line so the forced choice still resolves.
      const partial = frontier[0] ?? ranked[0];
      return partial ? partial.plan : [];
    }

    let best: Node = pool[0]!;
    let bestScore = -Infinity;
    for (const node of pool) {
      // Per-action laziness penalty: same "must be worth the bother" knob as greedy,
      // and it breaks ties toward the shortest plan that achieves the score.
      let score = afterReplyScore(node, seat) - weights.actionEpsilon * node.plan.length;
      if (rnd) score += (rnd() - 0.5) * weights.actionEpsilon * 0.99;
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    return best.plan;
  }

  // Cached plan for the current turn, replayed one action per policy call.
  let pending: { queue: Action[]; expected: GameState } | null = null;
  let turnKey = '';
  let actionsThisTurn = 0;

  return (s: GameState, seat: PlayerId): Action => {
    if (s.active !== seat) throw new Error(`search asked to act for seat ${seat} but it is seat ${s.active}'s turn`);

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

    // Continue the cached plan only while reality matches the simulation.
    if (pending && fingerprint(view) !== fingerprint(pending.expected)) pending = null;

    if (!pending || pending.queue.length === 0) {
      const plan = planTurn(view, seat);
      if (plan.length === 0) {
        // No plan at all: pass, or resolve a forced choice with any legal action.
        if (!view.pendingBurn) return { t: 'EndTurn' };
        const forced = enumerateBoundActions(view)[0];
        if (!forced) throw new Error('search: forced choice with no legal actions');
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
        // The plan's own next step no longer applies — drop it; next call replans.
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
