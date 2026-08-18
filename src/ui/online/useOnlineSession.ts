// The online session: WebSocket lifecycle, lobby state, and the shared action log
// that both clients replay to stay in lockstep.
//
// Lifted out of App.tsx as-is. The only behavioural change is that leaving no longer
// pokes history.replaceState directly — the caller supplies an `onLeave` so the router
// owns the URL.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyAction,
  boardFromLayout,
  DECK_CARDS,
  DECK_TOKENS,
  initGame,
  makeArenaBoard,
  shuffled,
} from '../../engine';
import type { Action, Board, DeckDef, GameState, PlayerConfig, PlayerId } from '../../engine';
import { NetClient } from '../../net/client';
import type { NetStatus } from '../../net/client';
import { stateFingerprint } from '../../net/protocol';
import type { ClientMsg, LobbyState, ServerMsg, StartPayload } from '../../net/protocol';
import { resetExperiments } from '../experiments';
import { clearOnlineSession, loadOnlineSession, loadOnlineSetup, saveOnlineSession } from '../storage';
import type { StoredBoard } from '../storage';

/** Live games shuffle off Math.random; the headless harness seeds it instead (see engine/rng.ts). */
const shuffle = <T,>(xs: T[]): T[] => shuffled(xs, Math.random);

export type OnlinePhase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'desync';

/** Everything about the current online session; null = offline (hotseat flows). */
export interface OnlineState {
  phase: OnlinePhase;
  status: NetStatus;
  code: string | null;
  seat: PlayerId | null;
  lobby: LobbyState | null;
  peerConnected: boolean;
  errorMsg: string;
  /** Prefill for the join field (from an invite link). */
  initialCode: string;
}

export function freshOnline(initialCode = '', errorMsg = ''): OnlineState {
  return {
    phase: 'idle',
    status: 'closed',
    code: null,
    seat: null,
    lobby: null,
    peerConnected: true,
    errorMsg,
    initialCode,
  };
}

export interface OnlineSessionOptions {
  /** The app's game state — the session replays into it. */
  game: GameState | null;
  setGame: (g: GameState | null) => void;
  /** Needed by the host to publish its remembered board on room creation. */
  customBoards: StoredBoard[];
  /** Room code from the URL, if the player arrived on an invite link. */
  inviteCode?: string | undefined;
  /** Called when the session ends, so the router can return to a non-online route. */
  onLeave: () => void;
}

export interface OnlineSession {
  online: OnlineState | null;
  /** Enter the online flow (from an offline screen). */
  begin: (initialCode?: string) => void;
  createRoom: () => void;
  joinRoom: (code: string) => void;
  leave: (message?: string) => void;
  hostStart: () => void;
  /** GameView applied an action locally; relay it with the resulting fingerprint. */
  sendAction: (a: Action, next: GameState) => void;
  setDeck: (deck: DeckDef) => void;
  setBoard: (board: Board, boardName: string) => void;
  setReady: (ready: boolean) => void;
}

export function useOnlineSession({
  game,
  setGame,
  customBoards,
  inviteCode,
  onLeave,
}: OnlineSessionOptions): OnlineSession {
  const [online, setOnline] = useState<OnlineState | null>(null);

  const onlineRef = useRef(online);
  onlineRef.current = online;
  const gameRef = useRef(game);
  gameRef.current = game;
  const actionsRef = useRef<Action[]>([]); // the applied action log (online only)
  const netRef = useRef<NetClient | null>(null);
  // Latest-closure relay so the long-lived NetClient always calls fresh handlers.
  const handlerRef = useRef<(m: ServerMsg) => void>(() => {});
  const boardsRef = useRef(customBoards);
  boardsRef.current = customBoards;
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  function openNet(): NetClient {
    if (!netRef.current) {
      netRef.current = new NetClient(
        (m) => handlerRef.current(m),
        (s) => setOnline((o) => (o ? { ...o, status: s } : o)),
      );
    }
    return netRef.current;
  }

  function createRoom() {
    setOnline((o) => o && { ...o, phase: 'connecting', errorMsg: '' });
    openNet().connect({ t: 'create' });
  }

  function joinRoom(code: string) {
    setOnline((o) => o && { ...o, phase: 'connecting', errorMsg: '' });
    openNet().connect({ t: 'join', code });
  }

  /** Tear down the online session; a `message` reopens the entry screen with a notice. */
  function leave(message?: string) {
    netRef.current?.send({ t: 'leave' });
    netRef.current?.close();
    netRef.current = null;
    clearOnlineSession();
    actionsRef.current = [];
    setGame(null);
    setOnline(message !== undefined ? freshOnline('', message) : null);
    if (message === undefined) onLeaveRef.current();
  }

  function buildOnlineGame(cfg: StartPayload): GameState {
    // Online play is a shared action log replayed on both clients; none of the experiment
    // state travels in the start payload, so a client carrying a tweak over from a local game
    // would desync. Shipping ruleset always, whatever the setup screen was last set to.
    resetExperiments();
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

  /** Build from the shared start payload and replay the canonical action log. */
  function startOnline(config: StartPayload, actions: Action[]) {
    try {
      let g = buildOnlineGame(config);
      for (const a of actions) g = applyAction(g, a);
      actionsRef.current = [...actions];
      gameRef.current = g;
      setGame(g);
      setOnline((o) => o && { ...o, phase: 'playing', errorMsg: '' });
    } catch (e) {
      console.error('online replay failed', e);
      setOnline(
        (o) =>
          o && {
            ...o,
            phase: 'desync',
            errorMsg:
              'Could not rebuild the game — the two clients are probably running different builds. Leave and start a new match.',
          },
      );
    }
  }

  function applyRemote(seq: number, action: Action, hash?: number) {
    const len = actionsRef.current.length;
    if (seq < len) return; // echo of an action we already applied locally
    if (seq > len || !gameRef.current) {
      netRef.current?.send({ t: 'resync' });
      return;
    }
    try {
      const next = applyAction(gameRef.current, action);
      if (hash !== undefined && stateFingerprint(next) !== hash) {
        console.warn('state fingerprint mismatch — resyncing from the server log');
        netRef.current?.send({ t: 'resync' });
        return;
      }
      actionsRef.current.push(action);
      gameRef.current = next;
      setGame(next);
    } catch (e) {
      console.error('remote action failed to apply — resyncing', e);
      netRef.current?.send({ t: 'resync' });
    }
  }

  function sendAction(a: Action, next: GameState) {
    const seq = actionsRef.current.length;
    actionsRef.current.push(a);
    gameRef.current = next;
    netRef.current?.send({ t: 'action', seq, action: a, hash: stateFingerprint(next) });
  }

  /** Host only: fix both draw orders here so the two clients build identical games. */
  function hostStart() {
    const lobby = onlineRef.current?.lobby;
    const d0 = lobby?.seats[0].deck;
    const d1 = lobby?.seats[1].deck;
    if (!d0 || !d1) return;
    netRef.current?.send({ t: 'start', orders: [shuffle(d0.list), shuffle(d1.list)] });
  }

  handlerRef.current = (m: ServerMsg) => {
    switch (m.t) {
      case 'created':
      case 'joined': {
        saveOnlineSession({ code: m.code, seat: m.seat, token: m.token });
        setOnline((o) => o && { ...o, phase: 'lobby', code: m.code, seat: m.seat, errorMsg: '' });
        if (m.t === 'created') {
          // Host: publish the remembered board right away so the lobby always has one.
          const stored = boardsRef.current.find((b) => b.id === loadOnlineSetup().boardId);
          netRef.current?.send({
            t: 'setBoard',
            board: stored ? boardFromLayout(stored.layout) : makeArenaBoard(),
            boardName: stored?.name ?? 'Arena',
          });
        }
        return;
      }
      case 'lobby':
        setOnline((o) => o && { ...o, phase: o.phase === 'playing' ? o.phase : 'lobby', lobby: m.lobby });
        return;
      case 'start':
        startOnline(m.config, []);
        return;
      case 'sync':
        if (m.phase === 'lobby') {
          setGame(null);
          setOnline((o) => o && { ...o, phase: 'lobby', lobby: m.lobby, errorMsg: '' });
        } else {
          startOnline(m.config, m.actions);
        }
        return;
      case 'action':
        applyRemote(m.seq, m.action, m.hash);
        return;
      case 'peer':
        setOnline((o) => o && { ...o, peerConnected: m.connected });
        return;
      case 'roomClosed':
        leave(m.reason);
        return;
      case 'error':
        if (m.code === 'bad-seq') return; // the server follows up with a sync
        if (m.code === 'room-not-found' || m.code === 'bad-token' || m.code === 'room-full') {
          // We can't be in that room: back to the entry screen.
          clearOnlineSession();
          setGame(null);
          setOnline((o) => o && { ...freshOnline(o.initialCode, m.message) });
          return;
        }
        setOnline((o) => o && { ...o, errorMsg: m.message });
        return;
    }
  };

  // Resume a per-tab session after a refresh, or auto-join from an invite link.
  useEffect(() => {
    const sess = loadOnlineSession();
    const room = inviteCode?.toUpperCase();
    if (sess) {
      setGame(null);
      setOnline({ ...freshOnline(), phase: 'connecting', code: sess.code, seat: sess.seat });
      openNet().connect({ t: 'rejoin', ...sess });
    } else if (room) {
      setGame(null);
      setOnline({ ...freshOnline(room), phase: 'connecting' });
      openNet().connect({ t: 'join', code: room });
    }
    return () => {
      netRef.current?.close();
      netRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (msg: ClientMsg) => netRef.current?.send(msg);

  return useMemo<OnlineSession>(
    () => ({
      online,
      begin: (initialCode = '') => setOnline(freshOnline(initialCode)),
      createRoom,
      joinRoom,
      leave,
      hostStart,
      sendAction,
      setDeck: (deck) => send({ t: 'setDeck', deck }),
      setBoard: (board, boardName) => send({ t: 'setBoard', board, boardName }),
      setReady: (ready) => send({ t: 'ready', ready }),
    }),
    // The closures above read everything through refs, so they stay correct across
    // renders; only `online` needs to re-trigger consumers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [online],
  );
}
