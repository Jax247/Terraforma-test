// Robustness smoke: drive whole games through enumerateBoundActions with a seeded RNG.
// Actions are fully bound (targets included), so ANY throw is a real engine or
// enumerator bug — there is no benign-error allowlist.
import { describe, expect, it } from 'vitest';
import { applyAction, cannotAttack, initGame, isPinnedByGuard, isSick } from '../engine';
import { enumerateBoundActions } from '../targeting';
import { DECK_CARDS, DECK_TOKENS, DECKS, DEFENSE_DECKS, makeArenaBoard } from '../content/decks';
import { freshGame } from './helpers';
import type { GameState } from '../types';

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

function playout(start: GameState, seed: number, steps: number, label: string): void {
  const rnd = mulberry32(seed);
  let s = start;
  for (let step = 0; step < steps && s.phase !== 'gameover'; step++) {
    const actions = enumerateBoundActions(s);
    expect(actions.length).toBeGreaterThan(0); // EndTurn is always available
    const pick = actions[Math.floor(rnd() * actions.length)]!;
    try {
      s = applyAction(s, pick);
    } catch (e) {
      const msg = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
      throw new Error(`${label} seed ${seed} step ${step} on ${JSON.stringify(pick)} -> ${msg}`);
    }
    // Invariants that must hold in every reachable state.
    for (const u of Object.values(s.units)) {
      const occ = s.board[u.pos.col - 1]![u.pos.row - 1]!.occupant;
      if (occ?.kind !== 'unit' || occ.id !== u.id) {
        throw new Error(`${label} seed ${seed} step ${step}: unit/board desync at ${u.name}`);
      }
    }
    for (const p of [0, 1] as const) {
      expect(s.players[p].sp).toBeGreaterThanOrEqual(0);
    }
  }
}

/** `playout` plus the Guard invariant: a pinned unit that can still act always has an action. */
function playoutPinSafe(start: GameState, seed: number, steps: number, label: string): void {
  const rnd = mulberry32(seed);
  let s = start;
  for (let step = 0; step < steps && s.phase !== 'gameover'; step++) {
    const actions = enumerateBoundActions(s);
    // ⚠ A pending hand-cap burn is a MODAL sub-phase: `legalActions` offers BurnCard and nothing
    // else, so every unit correctly has zero actions. Checking the pin invariant here reports a
    // lock that is not one. (Found the hard way — this gate's first two failures were both the
    // gate being wrong, not the rule.)
    if (s.pendingBurn) {
      s = applyAction(s, actions[Math.floor(rnd() * actions.length)]!);
      continue;
    }
    for (const u of Object.values(s.units)) {
      // Only the active player's un-acted units are entitled to an action. Two legitimate reasons
      // to have none, neither of which is Guard's doing: a unit denied its offence by CC (the
      // status system's business), and a SUMMONING-SICK unit, which cannot act at all on the turn
      // it arrives. ⚠ The sick case is not hypothetical — it was the first thing this gate flagged,
      // and it was the gate that was wrong, not the pin.
      if (u.owner !== s.active || u.hasActed || cannotAttack(u) || isSick(u)) continue;
      if (!isPinnedByGuard(s, u)) continue;
      const mine = actions.some((a) => 'unit' in a && a.unit === u.id);
      if (!mine) {
        throw new Error(
          `${label} seed ${seed} step ${step}: ${u.name} is PINNED WITH NO ACTIONS at ` +
            `(${u.pos.col},${u.pos.row}) — the pin has become a lock`,
        );
      }
    }
    const pick = actions[Math.floor(rnd() * actions.length)]!;
    try {
      s = applyAction(s, pick);
    } catch (e) {
      const msg = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
      throw new Error(`${label} seed ${seed} step ${step} on ${JSON.stringify(pick)} -> ${msg}`);
    }
  }
}

describe('fuzz — random playouts stay internally consistent', () => {
  it('30 seeded games, ~80 actions each, no errors', () => {
    for (let seed = 1; seed <= 30; seed++) {
      playout(freshGame(), seed, 80, 'poc');
    }
  });

  it('all 16 ordered deck matchups on the arena board, 3 seeds each', () => {
    for (const a of DECKS) {
      for (const b of DECKS) {
        for (let seed = 1; seed <= 3; seed++) {
          const s = initGame({
            board: makeArenaBoard(),
            cardDefs: DECK_CARDS,
            tokenDefs: DECK_TOKENS,
            players: [
              { leader: a.leader, deck: [...a.list], fusionPool: [...a.fusionPool] },
              { leader: b.leader, deck: [...b.list], fusionPool: [...b.fusionPool] },
            ],
          });
          playout(s, seed * 7 + a.id.length, 80, `${a.id} vs ${b.id}`);
        }
      }
    }
  });

  /**
   * GUARD SATURATION — the soft-lock gate for the 2026-08-09 pin.
   *
   * ⚠ THIS EXISTS BECAUSE A CLEAN FUZZ RUN WOULD OTHERWISE BE A LIE. Guard is the first rule in
   * the game that can remove a unit's legal moves, so fuzz is exactly the right gate — but the
   * keyword only bites if a card carries it, and running the normal matchups proves nothing while
   * the registered pool has none. That is precisely how the retired `guard` A/B managed to report
   * 0/3840 outcome changes and mean it.
   *
   * So: stamp Guard onto EVERY unit in both decks — far more saturated than any real deck will be
   * — and drive random legal play through it.
   *
   * ⚠ AND CHECK THE RIGHT PROPERTY. `playout`'s own "actions.length > 0" cannot be the gate: EndTurn
   * is always enumerable, so that assertion passes even under a total movement lock (verified — a
   * mutation making the pin restrict ATTACKS too, which really does lock units, sailed through it).
   * The property that actually says "a pin is not a lock" is per-unit: every pinned unit that is
   * still able to act must have at least one action of its own, which is guaranteed because the
   * Guard holding it is adjacent and therefore always attackable.
   */
  it('⚠ GATE: every unit carries Guard and no pinned unit is ever left with nothing to do', () => {
    const saturate = (defs: typeof DECK_CARDS): typeof DECK_CARDS =>
      Object.fromEntries(
        Object.entries(defs).map(([id, d]) => [
          id,
          d.kind === 'unit' && !d.keywords.includes('Guard')
            ? { ...d, keywords: [...d.keywords, 'Guard' as const] }
            : d,
        ]),
      );
    const cards = saturate(DECK_CARDS);
    for (const a of DECKS) {
      for (const b of DECKS) {
        for (let seed = 1; seed <= 2; seed++) {
          const s = initGame({
            board: makeArenaBoard(),
            cardDefs: cards,
            tokenDefs: DECK_TOKENS,
            players: [
              { leader: a.leader, deck: [...a.list], fusionPool: [...a.fusionPool] },
              { leader: b.leader, deck: [...b.list], fusionPool: [...b.fusionPool] },
            ],
          });
          playoutPinSafe(s, seed * 31 + a.id.length, 80, `${a.id} vs ${b.id} (all-Guard)`);
        }
      }
    }
  });

  /**
   * The DEF-heavy probe decks — the only place their cards, the two leader actives
   * (Aegis / Sunder) and the deepest DEF stacks get driven through real play. They are not in
   * DECKS, so nothing else here touches them, which is how eleven vanilla statlines went
   * unnoticed for a month.
   */
  describe('two-stat probe decks', () => {
    it('all 9 ordered probe matchups, 2 seeds each', () => {
      for (const a of DEFENSE_DECKS) {
        for (const b of DEFENSE_DECKS) {
          for (let seed = 1; seed <= 2; seed++) {
            const s = initGame({
              board: makeArenaBoard(),
              cardDefs: { ...DECK_CARDS, ...a.cards, ...b.cards },
              tokenDefs: DECK_TOKENS,
              players: [
                { leader: a.leader, deck: [...a.list], fusionPool: [] },
                { leader: b.leader, deck: [...b.list], fusionPool: [] },
              ],
            });
            playout(s, seed * 13 + a.id.length, 80, `${a.id} vs ${b.id} (defense)`);
          }
        }
      }
    });
  });
});
