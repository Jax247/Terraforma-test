import { describe, expect, it } from 'vitest';
import { applyAction, cloneState, enumerateBoundActions, tileAt } from '../../engine';
import { freshGame } from '../../engine/tests/helpers';
import { sanitize, UNKNOWN_CARD_ID } from '../sanitize';
import type { GameState } from '../../engine';

/** Plant an enemy (P1) face-down card directly, bypassing turn order. */
function withEnemySet(base: GameState, cardId: string): GameState {
  const s = cloneState(base);
  const def = s.cardDefs[cardId]!;
  if (def.kind === 'unit') throw new Error('use a spell/trap');
  const sc = {
    id: 'scX',
    owner: 1 as const,
    cardId,
    kind: def.kind,
    pos: { col: 5, row: 5 },
    hasActed: false,
    setTurnCount: 0,
    stance: 'attack' as const, // inert on a spell/trap; see SetCard.stance
  };
  s.setCards[sc.id] = sc;
  tileAt(s.board, sc.pos).occupant = { kind: 'set', id: sc.id };
  return s;
}

describe('sanitize', () => {
  it('states differing only in hidden info are indistinguishable after sanitizing', () => {
    const base = freshGame();
    // Different face-down enemy cards...
    const trapWorld = withEnemySet(base, 'snareVine');
    const spellWorld = withEnemySet(base, 'scorchMine');
    expect(sanitize(trapWorld, 0)).toEqual(sanitize(spellWorld, 0));
    // ...and different opponent hands.
    const handA = cloneState(base);
    const handB = cloneState(base);
    handA.players[1].hand = ['graveTyrant', 'carrionSwarm'];
    handB.players[1].hand = ['duneshambler', 'scorchMine'];
    expect(sanitize(handA, 0)).toEqual(sanitize(handB, 0));
  });

  it('masks opponent zones but not our own, and registers the placeholder def', () => {
    const s = withEnemySet(freshGame(), 'snareVine');
    const clean = sanitize(s, 0);
    expect(clean.players[1].hand.every((id) => id === UNKNOWN_CARD_ID)).toBe(true);
    expect(clean.players[1].deck.every((id) => id === UNKNOWN_CARD_ID)).toBe(true);
    expect(clean.setCards.scX!.cardId).toBe(UNKNOWN_CARD_ID);
    expect(clean.cardDefs[UNKNOWN_CARD_ID]).toBeDefined();
    expect(clean.players[0].hand).toEqual(s.players[0].hand);
    expect(clean.players[0].deck).toEqual(s.players[0].deck);
    // Counts preserved so hand/deck advantage still evaluates.
    expect(clean.players[1].hand).toHaveLength(s.players[1].hand.length);
    expect(clean.players[1].deck).toHaveLength(s.players[1].deck.length);
  });

  it('every action enumerated on the sanitized view applies cleanly to the REAL state', () => {
    const s = withEnemySet(freshGame(), 'snareVine');
    const view = sanitize(s, s.active);
    const actions = enumerateBoundActions(view);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(() => applyAction(s, a), JSON.stringify(a)).not.toThrow();
    }
  });
});
