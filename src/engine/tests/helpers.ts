import { applyAction, initGame, type GameConfig } from '../engine';
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

/** End turns until it is the given player's action phase. */
export function endUntil(s: GameState, player: 0 | 1): GameState {
  let cur = s;
  let guard = 0;
  while (cur.active !== player) {
    cur = applyAction(cur, { t: 'EndTurn' });
    if (++guard > 10) throw new Error('endUntil runaway');
  }
  return cur;
}

/** Skip N full rounds (both players pass). */
export function passRounds(s: GameState, n: number): GameState {
  let cur = s;
  for (let i = 0; i < n * 2; i++) cur = applyAction(cur, { t: 'EndTurn' });
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

export { GRAVEMARCH_CARDS };
