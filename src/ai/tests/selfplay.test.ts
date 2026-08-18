// Self-play drift alarm: greedy-vs-greedy across every ordered deck matchup.
// A rule change that makes the bot crash, stall into pass-pass loops, or desync
// the board fails here by matchup name.
import { describe, expect, it } from 'vitest';
import { initGame, RULES } from '../../engine';
import { DECK_CARDS, DECK_TOKENS, DECKS, makeArenaBoard } from '../../engine/content/decks';
import { makeGreedyPolicy, playGame } from '../greedy';
import type { Action, GameState } from '../../engine';

function assertProgressAndConsistency(end: GameState, label: string): void {
  // Progress: either somebody won, or blood was drawn AND units hit the board.
  const lpDealt =
    RULES.startingLife - end.players[0].leaderLife + (RULES.startingLife - end.players[1].leaderLife);
  const boardActivity =
    Object.values(end.units).filter((u) => !u.isLeader).length +
    end.players[0].graveyard.length +
    end.players[1].graveyard.length;
  if (end.phase !== 'gameover') {
    expect(lpDealt, `${label}: no LP dealt in a full game`).toBeGreaterThan(0);
    expect(boardActivity, `${label}: no unit ever hit the board`).toBeGreaterThan(0);
  }
  // Unit/board desync invariant on the final state.
  for (const u of Object.values(end.units)) {
    const occ = end.board[u.pos.col - 1]![u.pos.row - 1]!.occupant;
    expect(occ?.kind === 'unit' && occ.id === u.id, `${label}: unit/board desync at ${u.name}`).toBe(true);
  }
}

describe('self-play — all 16 ordered deck matchups, greedy vs greedy', () => {
  for (const a of DECKS) {
    for (const b of DECKS) {
      it(`${a.id} vs ${b.id}`, () => {
        const throwing = (act: Action, e: unknown) => {
          throw new Error(`${a.id} vs ${b.id}: candidate ${JSON.stringify(act)} threw: ${e instanceof Error ? e.message : e}`);
        };
        const start = initGame({
          board: makeArenaBoard(),
          cardDefs: DECK_CARDS,
          tokenDefs: DECK_TOKENS,
          players: [
            { leader: a.leader, deck: [...a.list], fusionPool: [...a.fusionPool] },
            { leader: b.leader, deck: [...b.list], fusionPool: [...b.fusionPool] },
          ],
        });
        const end = playGame(
          start,
          makeGreedyPolicy({ seed: 1, onCandidateError: throwing }),
          makeGreedyPolicy({ seed: 2, onCandidateError: throwing }),
          60,
        );
        assertProgressAndConsistency(end, `${a.id} vs ${b.id}`);
      });
    }
  }
});
