import { afterEach, beforeEach } from 'vitest';
import { applyAction, initGame, type GameConfig } from '../engine';
import { resetRules, setRules } from '../rules';
import {
  BRIAR,
  GRAVEMARCH_CARDS,
  makePocBoard,
  OSKAR,
  POC_CARDS,
  POC_TOKENS,
  wildgrowthDeck,
  gravemarchDeck,
} from '../content/poc';
import type { Board, CardDef, GameState, LeaderDef, TokenDef } from '../types';

export interface FixtureOverrides {
  board?: Board;
  extraCards?: Record<string, CardDef>;
  extraTokens?: Record<string, TokenDef>;
  leaders?: [LeaderDef | undefined, LeaderDef | undefined];
  decks?: [string[], string[]];
  fusionPools?: [string[], string[]];
}

/** Wildgrowth (P1) vs Gravemarch (P2) on the suggested sim map, unless overridden. */
export function freshGame(o: FixtureOverrides = {}): GameState {
  const cfg: GameConfig = {
    board: o.board ?? makePocBoard(),
    cardDefs: { ...POC_CARDS, ...(o.extraCards ?? {}) },
    tokenDefs: { ...POC_TOKENS, ...(o.extraTokens ?? {}) },
    players: [
      {
        leader: o.leaders?.[0] ?? BRIAR,
        deck: o.decks?.[0] ?? wildgrowthDeck(),
        fusionPool: o.fusionPools?.[0] ?? ['apexPredator'],
      },
      {
        leader: o.leaders?.[1] ?? OSKAR,
        deck: o.decks?.[1] ?? gravemarchDeck(),
        fusionPool: o.fusionPools?.[1] ?? ['dreadColossus'],
      },
    ],
  };
  return initGame(cfg);
}

/** Resolve any pending hand-cap burn (fixtures burn the oldest card). */
export function autoBurn(s: GameState): GameState {
  let cur = s;
  let guard = 0;
  while (cur.pendingBurn) {
    cur = applyAction(cur, { t: 'BurnCard', index: 0 });
    if (++guard > 10) throw new Error('autoBurn runaway');
  }
  return cur;
}

/** End turns until it is the given player's action phase (auto-burning at the hand cap). */
export function endUntil(s: GameState, player: 0 | 1): GameState {
  let cur = autoBurn(s);
  let guard = 0;
  while (cur.active !== player) {
    cur = autoBurn(applyAction(cur, { t: 'EndTurn' }));
    if (++guard > 10) throw new Error('endUntil runaway');
  }
  return cur;
}

/** Skip N full rounds (both players pass, auto-burning at the hand cap). */
export function passRounds(s: GameState, n: number): GameState {
  let cur = autoBurn(s);
  for (let i = 0; i < n * 2; i++) cur = autoBurn(applyAction(cur, { t: 'EndTurn' }));
  return cur;
}

/** Fixture-only: relocate a unit ignoring movement rules. */
export function teleport(s: GameState, unitId: string, pos: { col: number; row: number }): void {
  const u = s.units[unitId];
  if (!u) throw new Error(`no unit ${unitId}`);
  const from = s.board[u.pos.col - 1]![u.pos.row - 1]!;
  const to = s.board[pos.col - 1]![pos.row - 1]!;
  if (to.occupant) throw new Error('teleport destination occupied');
  from.occupant = undefined;
  to.occupant = { kind: 'unit', id: u.id };
  u.pos = { ...pos };
}

/**
 * Pin summoning sickness ON for the enclosing suite. The tester's default became 0 on
 * 2026-08-01, but the sim suites transcribe vault narratives that were played under the 1-turn
 * rule, and a few engine tests exist specifically to cover sickness interactions — both want the
 * rule they were written for, not whatever the current default happens to be. Call inside a
 * `describe`; RULES is global, so the reset is what keeps it from leaking to other files.
 */
export function withSummoningSickness(): void {
  beforeEach(() => setRules({ summoningSickTurns: 1 }));
  afterEach(() => resetRules());
}

/**
 * Pin the pre-2026-08-09 SP curve (4/7/8, `spStep: 3`). The shipping step is now 1, so the curve
 * runs 4/5/6/7/8 and the top end arrives on turn 5 instead of turn 3 — a deliberate feel change.
 * The sim transcripts were RECORDED against the old curve, so they keep testing what they recorded,
 * exactly as `withSummoningSickness` does for the sickness rule.
 */
export function withLegacySpCurve(): void {
  beforeEach(() => setRules({ spStep: 3 }));
  afterEach(() => resetRules());
}

export { GRAVEMARCH_CARDS };
