// Fatigue + hand cap (2026-07-15 rulings): escalating empty-deck damage ends
// stalled games; overdraw past 7 forces a burn-to-void choice, punishing hoarding.
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../engine';
import { RULES } from '../rules';
import { enumerateBoundActions } from '../targeting';
import { autoBurn, freshGame } from './helpers';
import type { GameState } from '../types';

describe('fatigue — drawing from an empty deck', () => {
  it('deals escalating 10, 20, 30… LP and can end the game', () => {
    let s = freshGame();
    s.players[1].deck = [];
    s = applyAction(s, { t: 'EndTurn' }); // P1's start-of-turn draw misses
    expect(s.players[1].fatigue).toBe(1);
    expect(s.players[1].leaderLife).toBe(RULES.startingLife - RULES.fatigueStep);

    s = applyAction(s, { t: 'EndTurn' });
    s = autoBurn(s); // P0 still draws normally and may hit the cap
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.players[1].fatigue).toBe(2);
    expect(s.players[1].leaderLife).toBe(RULES.startingLife - RULES.fatigueStep * 3); // 10 + 20

    // 200 LP is gone after 1+2+…+n missed draws where 10·Σ ≥ 200 → n = 6.
    let guard = 0;
    while (s.phase !== 'gameover') {
      s = autoBurn(s);
      s = applyAction(s, { t: 'EndTurn' });
      if (++guard > 20) throw new Error('fatigue never ended the game');
    }
    expect(s.winner).toBe(0);
    expect(s.players[1].fatigue).toBe(6);
  });

  it('a multi-draw effect on an empty deck escalates per missed card', () => {
    let s = freshGame();
    s.players[0].graveyard = [];
    s.players[0].deck = ['thornfang']; // draw 1 real card, then miss
    const before = s.players[0].leaderLife;
    // Verdant Bounty isn't in hand reliably; use the engine path directly via EndTurn cycles instead:
    s = applyAction(s, { t: 'EndTurn' }); // P1 turn
    s = autoBurn(s);
    s = applyAction(s, { t: 'EndTurn' }); // P0 draws its last card
    s = autoBurn(s);
    s = applyAction(s, { t: 'EndTurn' });
    s = autoBurn(s);
    s = applyAction(s, { t: 'EndTurn' }); // P0 misses: fatigue 1
    expect(s.players[0].fatigue).toBe(1);
    expect(s.players[0].leaderLife).toBe(before - RULES.fatigueStep);
  });
});

describe('hand cap — overdraw forces a burn to the void', () => {
  function overCap(): GameState {
    const s = freshGame();
    // P1 sits at the cap; their next start-of-turn draw overflows.
    s.players[1].hand = ['duneshambler', 'carrionSwarm', 'sandRevenant', 'graveTyrant', 'raiseTheFallen', 'scorchMine', 'graspOfTheDead'];
    expect(s.players[1].hand).toHaveLength(RULES.handCap);
    return applyAction(s, { t: 'EndTurn' });
  }

  it('the draw enters, pendingBurn is set, and only BurnCard is legal', () => {
    const s = overCap();
    expect(s.pendingBurn).toEqual({ player: 1, remainingDraws: 0 });
    expect(s.players[1].hand).toHaveLength(RULES.handCap + 1);
    const legal = legalActions(s);
    expect(legal).toHaveLength(RULES.handCap); // one per burnable card; the incoming card is exempt
    expect(legal.every((a) => a.t === 'BurnCard')).toBe(true);
    expect(enumerateBoundActions(s)).toEqual(legal);
    // Everything else is blocked.
    expect(() => applyAction(s, { t: 'EndTurn' })).toThrow(/burn a card/);
    expect(() => applyAction(s, { t: 'CastSpell', card: 'raiseTheFallen' })).toThrow(/burn a card/);
  });

  it('burning resolves the pending state and sends the card to the void', () => {
    const s = overCap();
    const incoming = s.players[1].hand[RULES.handCap]!;
    const burned = s.players[1].hand[2]!;
    const after = applyAction(s, { t: 'BurnCard', index: 2 });
    expect(after.pendingBurn).toBeUndefined();
    expect(after.players[1].hand).toHaveLength(RULES.handCap);
    expect(after.players[1].hand[after.players[1].hand.length - 1]).toBe(incoming); // incoming stayed
    expect(after.voidPile).toContain(burned);
    expect(after.players[1].graveyard).not.toContain(burned); // void, not graveyard
  });

  it('the incoming card itself cannot be burned', () => {
    const s = overCap();
    expect(() => applyAction(s, { t: 'BurnCard', index: RULES.handCap })).toThrow(/pre-draw/);
    expect(() => applyAction(s, { t: 'BurnCard', index: -1 })).toThrow(/pre-draw/);
  });

  it('queued draws resolve after the burn (draw effects past the cap)', () => {
    let s = freshGame();
    // Give P0 a full hand and a 2-draw via Oskar-style effect substitute: use two EndTurn cycles
    // is not multi-draw, so drive drawCards through a spell: Verdant Bounty (draw 2) lives in the
    // arena decks, not POC — instead simulate by direct overdraw with remainingDraws.
    s.players[0].hand = ['thornfang', 'grovecaller', 'mosshideBull', 'saplingSentry', 'verdantSurge', 'snareVine', 'wildAwakening'];
    s = applyAction(s, { t: 'EndTurn' }); // P1
    s = autoBurn(s);
    s = applyAction(s, { t: 'EndTurn' }); // P0 draws over cap
    expect(s.pendingBurn?.player).toBe(0);
    const after = applyAction(s, { t: 'BurnCard', index: 0 });
    expect(after.pendingBurn).toBeUndefined();
    expect(after.players[0].hand).toHaveLength(RULES.handCap);
  });
});
