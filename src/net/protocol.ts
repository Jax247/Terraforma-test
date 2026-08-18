/**
 * Shared client/server message protocol for online play.
 *
 * Imported by both the browser client and the Node relay server. Keep this
 * module type-only apart from the small helpers below — the server runs it
 * through Node's type-stripping, so no enums/namespaces/decorators, and only
 * `import type` from the engine.
 */
import type { Action, Board, DeckDef, GameState, PlayerId } from '../engine';

/** Everything both clients need to build the identical initial GameState. */
export interface StartPayload {
  /** Resolved deck definitions; index = seat (0 = host, 1 = guest). */
  decks: [DeckDef, DeckDef];
  board: Board;
  /** Host-shuffled draw orders per seat (index 0 = top of deck). */
  orders: [string[], string[]];
}

export interface LobbySeat {
  connected: boolean;
  ready: boolean;
  deck?: DeckDef;
}

export interface LobbyState {
  code: string;
  seats: [LobbySeat, LobbySeat];
  board?: Board;
  boardName?: string;
}

export type ErrorCode =
  | 'room-not-found'
  | 'room-full'
  | 'bad-token'
  | 'bad-seq'
  | 'not-host'
  | 'not-ready'
  | 'bad-msg';

export type ClientMsg =
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'rejoin'; code: string; seat: PlayerId; token: string }
  | { t: 'setDeck'; deck: DeckDef }
  | { t: 'setBoard'; board: Board; boardName: string } // host only
  | { t: 'ready'; ready: boolean }
  | { t: 'start'; orders: [string[], string[]] } // host only; both ready
  | { t: 'action'; seq: number; action: Action; hash?: number }
  | { t: 'resync' }
  | { t: 'leave' };

export type ServerMsg =
  | { t: 'created'; code: string; seat: 0; token: string }
  | { t: 'joined'; code: string; seat: PlayerId; token: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'start'; config: StartPayload }
  // Broadcast to both seats; the sender recognises its own echo by seq.
  | { t: 'action'; seq: number; action: Action; hash?: number }
  | { t: 'sync'; phase: 'lobby'; lobby: LobbyState }
  | { t: 'sync'; phase: 'game'; config: StartPayload; actions: Action[] }
  | { t: 'peer'; seat: PlayerId; connected: boolean }
  | { t: 'roomClosed'; reason: string }
  | { t: 'error'; code: ErrorCode; message: string };

/** WS endpoint on the current origin (Vite proxies /ws to the relay in dev). */
export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/**
 * FNV-1a hash over the dynamic game state (log excluded — it's cosmetic).
 * Cheap desync tripwire: attached to action messages so the receiver can
 * detect divergence instead of playing on silently.
 */
export function stateFingerprint(s: GameState): number {
  const json = JSON.stringify({ ...s, log: undefined });
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
