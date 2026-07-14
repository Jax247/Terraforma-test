// Robustness smoke: drive whole games through legalActions with a seeded RNG.
// Validation errors are fine (target-bearing actions are listed unbound); internal
// errors (TypeError etc.) mean the engine reached a broken state.
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../engine';
import { freshGame } from './helpers';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fuzz — random playouts stay internally consistent', () => {
  it('30 seeded games, ~80 actions each, no internal errors', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rnd = mulberry32(seed);
      let s = freshGame();
      for (let step = 0; step < 80 && s.phase !== 'gameover'; step++) {
        const actions = legalActions(s);
        expect(actions.length).toBeGreaterThan(0); // EndTurn is always available
        const pick = actions[Math.floor(rnd() * actions.length)]!;
        try {
          s = applyAction(s, pick);
        } catch (e) {
          const msg = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
          // Unbound targets on spells/abilities are expected; anything else is a real bug.
          const benign = /target required|needs a destination|needs two unit targets|Line3|no .* in graveyard|not enough SP/;
          if (!(e instanceof Error) || e.constructor.name !== 'Error' || !benign.test(e.message)) {
            throw new Error(`seed ${seed} step ${step} on ${JSON.stringify(pick)} -> ${msg}`);
          }
        }
        // Invariants that must hold in every reachable state.
        for (const u of Object.values(s.units)) {
          const occ = s.board[u.pos.col - 1]![u.pos.row - 1]!.occupant;
          if (occ?.kind !== 'unit' || occ.id !== u.id) {
            throw new Error(`seed ${seed} step ${step}: unit/board desync at ${u.name}`);
          }
        }
        for (const p of [0, 1] as const) {
          expect(s.players[p].sp).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
