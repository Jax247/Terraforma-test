// Greedy one-ply policy: simulate every bound action, keep the best-scoring one,
// end the turn when nothing beats the current position by actionEpsilon.
// The Policy seam is the upgrade path — a search bot can replace makeGreedyPolicy
// without touching the enumerator, evaluator, drivers, or UI.

import { applyAction, enumerateBoundActions, isEmpty, leaderOf, mulberry32, orthAdjacent, sameCoord } from '../engine';
import type { Action, Coord, GameState, PlayerId } from '../engine';
import { DEFAULT_WEIGHTS, evaluate } from './evaluate';
import type { EvalWeights } from './evaluate';
import { sanitize } from './sanitize';
import type { AiKnowledge } from './sanitize';

export type Policy = (s: GameState, seat: PlayerId) => Action;

export interface GreedyOptions {
  weights?: EvalWeights;
  /** Seeded tie-jitter (mulberry32) for variety. Omit for strictly deterministic play. */
  seed?: number;
  /**
   * 'fog' masks opponent hand/deck/face-down cards before the bot looks ahead. **Default 'fog'
   * since 2026-08-02** — a bot that reads face-downs dodges every trap, which makes trap and
   * bluff playtesting meaningless and flatters the human. 'perfect' is still available and is
   * what every A/B number recorded before that date was measured with.
   */
  knowledge?: AiKnowledge;
  /** Hard cap on non-EndTurn actions per turn (loop guard). Default 40. */
  maxActionsPerTurn?: number;
  /** Called when a candidate action throws in simulation (enumerator/engine drift). Default: console.warn. */
  onCandidateError?: (a: Action, e: unknown) => void;
}

export function makeGreedyPolicy(opts: GreedyOptions = {}): Policy {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const knowledge = opts.knowledge ?? 'fog';
  const maxActionsPerTurn = opts.maxActionsPerTurn ?? 40;
  const onCandidateError =
    opts.onCandidateError ?? ((a, e) => console.warn('greedy: candidate action threw', a, e));
  const rnd = opts.seed !== undefined ? mulberry32(opts.seed) : undefined;

  // Loop guard: count decisions within one (seat, own-turn) window.
  let turnKey = '';
  let actionsThisTurn = 0;

  return (s: GameState, seat: PlayerId): Action => {
    if (s.active !== seat) throw new Error(`greedy asked to act for seat ${seat} but it is seat ${s.active}'s turn`);

    const key = `${seat}:${s.players[seat].turnCount}`;
    if (key !== turnKey) {
      turnKey = key;
      actionsThisTurn = 0;
    }

    const view = knowledge === 'fog' ? sanitize(s, seat) : s;
    // The log grows without bound over a game and applyAction deep-clones the
    // whole state per candidate — simulate with an emptied log to keep one-ply cheap.
    const sim: GameState = { ...view, log: [] };

    // Never place a new piece on the leader's LAST empty orthogonal neighbour:
    // a self-walled leader can't step away from chip attacks, and the one-ply
    // eval can't see the trap forming (self-play showed greedy summoning its
    // leader into a corner it then got chipped to death in).
    const escapes = orthAdjacent(leaderOf(view, seat).pos).filter((c) => isEmpty(view, c));
    const lastEscape: Coord | undefined = escapes.length === 1 ? escapes[0] : undefined;

    const baseline = evaluate(view, seat, weights);
    let best: Action | undefined;
    let bestScore = -Infinity;
    let endTurnLegal = false;
    for (const a of enumerateBoundActions(view)) {
      if (a.t === 'EndTurn') {
        endTurnLegal = true; // post-EndTurn states are not comparable to same-turn states
        continue;
      }
      if (lastEscape && (a.t === 'Summon' || a.t === 'SetCard') && sameCoord(a.tile, lastEscape)) continue;
      let score: number;
      try {
        score = evaluate(applyAction(sim, a), seat, weights);
      } catch (e) {
        onCandidateError(a, e);
        continue;
      }
      if (rnd) score += (rnd() - 0.5) * weights.actionEpsilon * 0.99; // tie-jitter, below the epsilon threshold
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }

    // Forced choice (e.g. a pending hand-cap burn): EndTurn is illegal, take the best option.
    if (!endTurnLegal && best) return best;
    if (actionsThisTurn >= maxActionsPerTurn) return { t: 'EndTurn' };
    if (best && bestScore > baseline + weights.actionEpsilon) {
      actionsThisTurn += 1;
      return best;
    }
    return { t: 'EndTurn' };
  };
}

// ---------------------------------------------------------------------------
// Drivers (shared by tests, tooling, and the UI's autoplay mode)
// ---------------------------------------------------------------------------

/** Let `policy` play out the active player's turn on the real state. Returns after EndTurn (or gameover). */
export function playTurn(s: GameState, policy: Policy): GameState {
  let cur = s;
  const seat = cur.active;
  // Independent safety net around the policy's own loop guard.
  for (let i = 0; i < 200; i++) {
    if (cur.phase === 'gameover') return cur;
    const a = policy(cur, seat);
    cur = applyAction(cur, a);
    if (a.t === 'EndTurn') return cur;
  }
  throw new Error(`playTurn: seat ${seat} never ended its turn`);
}

/** Play whole games policy-vs-policy. Stops at gameover or after maxPlayerTurns total turns. */
export function playGame(s: GameState, p0: Policy, p1: Policy, maxPlayerTurns = 120): GameState {
  let cur = s;
  for (let turn = 0; turn < maxPlayerTurns && cur.phase !== 'gameover'; turn++) {
    cur = playTurn(cur, cur.active === 0 ? p0 : p1);
  }
  return cur;
}
