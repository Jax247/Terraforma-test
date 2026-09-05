/**
 * The server's own copy of a game.
 *
 * This is the first half of making the server authoritative, and it is deliberately the half
 * that changes nothing on the wire. The server materialises a GameState from the same
 * {config, actions} it already persists, runs each incoming action through the real engine,
 * and refuses the ones the engine refuses. Clients still simulate and still render from their
 * own state, so there is no UI risk in this step — but a modified client can no longer
 * fabricate an illegal move, and every action is now checked by something the player does not
 * control.
 *
 * It also turns `stateFingerprint` into a canary. Before the server can be the SOURCE of
 * truth it has to be shown to agree with the clients on real games, and a mismatch logged
 * here is that evidence arriving while the clients are still authoritative and nothing is at
 * stake. That is why the fingerprint survives this phase rather than being deleted with the
 * rest of the lockstep machinery.
 */
import type { Action, GameState, PlayerConfig, PlayerId } from '../src/engine/index.ts';
import type { StartPayload } from '../src/net/protocol.ts';
import { applyAction, DECK_CARDS, DECK_TOKENS, initGame, resetRules } from './engine.ts';

export interface Match {
  state: GameState;
  /** How many actions are folded into `state`; always equals the room's log length. */
  applied: number;
}

/**
 * Build the initial state exactly as the client does in `buildOnlineGame`.
 *
 * ⚠ Any divergence here shows up as a fingerprint mismatch on the very first action, so this
 * must stay in step with useOnlineSession.ts. `resetRules()` mirrors the client's
 * `resetExperiments()`: RULES is process-global and an online game is always the shipping
 * ruleset, whatever anything else set it to.
 */
export function buildMatch(cfg: StartPayload): GameState {
  resetRules();
  return initGame({
    board: cfg.board,
    cardDefs: { ...DECK_CARDS, ...cfg.decks[0].cards, ...cfg.decks[1].cards },
    tokenDefs: DECK_TOKENS,
    players: ([0, 1] as const).map((i) => ({
      leader: cfg.decks[i].leader,
      deck: [...cfg.orders[i]],
      fusionPool: [...cfg.decks[i].fusionPool],
    })) as [PlayerConfig, PlayerConfig],
  });
}

/** Rebuild from the durable record. Replaying a few hundred actions costs milliseconds. */
export function materialize(cfg: StartPayload, actions: Action[]): Match {
  let state = buildMatch(cfg);
  for (const a of actions) state = applyAction(state, a);
  return { state, applied: actions.length };
}

/**
 * Whose action this is.
 *
 * Not simply `active`: a forced burn belongs to `pendingBurn.player`, who may not be the
 * active player. Getting this wrong would reject legal play, which is far worse than the
 * cheating it is meant to stop.
 */
export const turnOwner = (s: GameState): PlayerId => (s.pendingBurn ? s.pendingBurn.player : s.active);

export type IntentResult = { ok: true; state: GameState } | { ok: false; reason: string };

/**
 * Validate and apply one action.
 *
 * `applyAction` in a try/catch is the authority — NOT membership of `legalActions`. That
 * enumeration is deliberately partial: it emits `CastSpell` for global spells only and leaves
 * located spells' targets unbound (see the comment at GameView.tsx's action menu), so
 * comparing against it would reject most legal casts. The engine's own refusal is the only
 * complete answer to "is this legal".
 */
export function applyIntent(m: Match, seat: PlayerId, action: Action): IntentResult {
  if (turnOwner(m.state) !== seat) return { ok: false, reason: 'It is not your turn.' };
  try {
    return { ok: true, state: applyAction(m.state, action) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
