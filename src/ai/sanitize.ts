// Fog-of-war sanitizer: mask what `me` could not legally know before handing the
// state to a policy. Without this, a bot that simulates moves onto face-down
// cards SEES trap outcomes and dodges every trap — distorting trap playtesting.

import { cloneState } from '../engine';
import type { GameState, PlayerId, SpellCardDef } from '../engine';

export type AiKnowledge = 'perfect' | 'fog';

/** Placeholder id masking hidden opponent cards. Registered into the sanitized state's cardDefs. */
export const UNKNOWN_CARD_ID = '__unknown';

const UNKNOWN_DEF: SpellCardDef = {
  kind: 'spell',
  id: UNKNOWN_CARD_ID,
  name: 'Unknown card',
  dc: 0,
  scope: 'located',
  effects: [], // inert: resolves to nothing, triggers nothing
};

/**
 * Clone `s` with the opponent's hidden information masked:
 * - opponent hand and deck entries become UNKNOWN_CARD_ID (lengths preserved,
 *   so hand/deck counts still evaluate correctly),
 * - opponent face-down set cards become inert unknown spells, so a simulated
 *   move onto one behaves like attacking an unrevealed card and their traps
 *   never fire inside the bot's lookahead.
 * Own-side info is untouched (known deck order is a residual, minor leak: the
 * greedy bot only touches it via Draw effects). Graveyards and fusion pools are
 * public zones. Actions a policy picks on the sanitized state only ever
 * reference `me`'s own cards and units, so they stay valid on the real state.
 */
export function sanitize(s: GameState, me: PlayerId): GameState {
  const out = cloneState(s);
  const opp: PlayerId = me === 0 ? 1 : 0;
  // cloneState shares the registry by reference — replace, never mutate.
  out.cardDefs = { ...out.cardDefs, [UNKNOWN_CARD_ID]: structuredClone(UNKNOWN_DEF) };
  out.players[opp].hand = out.players[opp].hand.map(() => UNKNOWN_CARD_ID);
  out.players[opp].deck = out.players[opp].deck.map(() => UNKNOWN_CARD_ID);
  for (const sc of Object.values(out.setCards)) {
    if (sc.owner !== opp) continue;
    sc.cardId = UNKNOWN_CARD_ID;
    sc.kind = 'spell'; // the universal card back: kind is hidden too
  }
  return out;
}
