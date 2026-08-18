import { useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { DECK_CARDS, DECK_TOKENS, DECKS, DEFENSE_DECKS, defaultResolver, initGame, shuffled } from '../engine';
import type { Board, DeckDef, GameState } from '../engine';
import { makeExpertPolicy, makeGreedyPolicy, makeSearchPolicy } from '../ai';
import type { Policy } from '../ai';
import type { AiConfig } from './AiSettings';
import { AppBar } from './components/AppBar';
import { BoardEditor } from './BoardEditor';
import { CardDetailModal } from './CardDetail';
import type { DetailSubject } from './CardDetail';
import { DeckBuilder } from './DeckBuilder';
import { applyExperiments } from './experiments';
import type { ExperimentConfig } from './experiments';
import { DeckPage } from './DeckPage';
import { GameView } from './GameView';
import { OnlineSetup } from './OnlineSetup';
import { SetupScreen } from './SetupScreen';
import { SettingsDialog } from './SettingsDialog';
import { motionConfigProps, useMotionMode } from './motion';
import { useOnlineSession } from './online/useOnlineSession';
import { isAiThinking, useAiDriver } from './useAiDriver';
import { useStoredBoards, useStoredDecks, useStoredSettings } from './storage';
import type { Controller } from './storage';

/** Live games shuffle off Math.random; the headless harness seeds it instead (see engine/rng.ts). */
const shuffle = <T,>(xs: T[]): T[] => shuffled(xs, Math.random);

function newGame(a: DeckDef, b: DeckDef, board: Board): GameState {
  return initGame({
    board,
    // Each DeckDef carries every def it references (incl. tweaked variants),
    // so merging both decks over the base registry covers custom cards.
    cardDefs: { ...DECK_CARDS, ...a.cards, ...b.cards },
    tokenDefs: DECK_TOKENS,
    players: [
      { leader: a.leader, deck: shuffle(a.list), fusionPool: [...a.fusionPool] },
      { leader: b.leader, deck: shuffle(b.list), fusionPool: [...b.fusionPool] },
    ],
  });
}

/**
 * Invite code from the URL, read once at load. Both the current route form
 * (/online/ABCD) and the original query form (/?room=ABCD) are accepted — links
 * from before the router existed are still in circulation.
 */
function readInviteCode(): string | undefined {
  const fromPath = /^\/online\/([A-Za-z0-9]+)/.exec(window.location.pathname)?.[1];
  const fromQuery = new URLSearchParams(window.location.search).get('room');
  return (fromPath ?? fromQuery ?? undefined)?.toUpperCase();
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const [game, setGame] = useState<GameState | null>(null);
  const [detail, setDetail] = useState<DetailSubject | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controllers, setControllers] = useState<[Controller, Controller]>(['human', 'human']);
  const [aiSpeed, setAiSpeed] = useState(350);
  // Which map this game is on — the random board modes make this worth showing.
  const [boardName, setBoardName] = useState('Arena');
  const [customBoards, setCustomBoards] = useStoredBoards();
  const [customDecks, setCustomDecks] = useStoredDecks();
  const policiesRef = useRef<[Policy, Policy]>([makeGreedyPolicy(), makeGreedyPolicy()]);

  // Animations. Resolves the ?motion param, navigator.webdriver, the saved setting
  // and prefers-reduced-motion, then stamps data-motion on <html> (which is what
  // zeroes the CSS duration tokens). See src/ui/motion.ts.
  const [settings, setSettings] = useStoredSettings();
  const motionMode = useMotionMode(settings.motion);

  // --- Online play ---
  const inviteRef = useRef<string | undefined>(undefined);
  if (inviteRef.current === undefined) inviteRef.current = readInviteCode() ?? '';
  const session = useOnlineSession({
    game,
    setGame,
    customBoards,
    inviteCode: inviteRef.current || undefined,
    onLeave: () => navigate('/'),
  });
  const { online } = session;

  // An invite link may arrive on any path (the legacy form was /?room=CODE).
  // Normalise to /online once, so the address bar matches the screen.
  useEffect(() => {
    if (inviteRef.current && !location.pathname.startsWith('/online')) navigate('/online', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onlineRef = useRef(online);
  onlineRef.current = online;
  const isOnlineRef = useRef(false);
  isOnlineRef.current = online !== null;

  // The AI drives hotseat games only, and only while the game screen is showing.
  const onGameRoute = location.pathname === '/';
  useAiDriver({
    game,
    setGame,
    controllers,
    policiesRef,
    speedMs: aiSpeed,
    enabled: onGameRoute && online === null,
    isOnlineRef,
  });
  const aiThinking = isAiThinking(game, controllers, online === null);

  // Per-game resolver so tweaked custom cards resolve in the log/detail views.
  const names = useMemo(
    () => (game ? defaultResolver(game.cardDefs, game.tokenDefs) : defaultResolver(DECK_CARDS, DECK_TOKENS)),
    [game?.cardDefs, game?.tokenDefs],
  );

  function startGame(
    a: DeckDef,
    b: DeckDef,
    board: Board,
    ctrl: [Controller, Controller],
    aiConfigs: [AiConfig, AiConfig],
    aiSpeedMs: number,
    experiments: ExperimentConfig,
    nextBoardName: string,
  ) {
    // Rules flags first: legalActions/eval read them globally, so they must be settled before
    // any state exists. Constant for the life of this game — changing it means a new game.
    applyExperiments(experiments);
    // Fresh per-seat policies each game (built for both seats so a mid-game
    // Human→AI toggle works even for a seat that started human). Seeded for variety.
    policiesRef.current = [0, 1].map((i) => {
      const cfg = aiConfigs[i as 0 | 1];
      const base = {
        weights: cfg.weights,
        knowledge: cfg.knowledge,
        seed: Math.floor(Math.random() * 1e9),
      };
      // `default:` on purpose — a difficulty persisted by an older build (normalizeAiConfig
      // back-fills fields but never validates this string) falls back to greedy rather than crashing.
      switch (cfg.difficulty) {
        case 'expert':
          return makeExpertPolicy({ ...base, ...cfg.search });
        case 'hard':
          return makeSearchPolicy({ ...base, ...cfg.search });
        default:
          return makeGreedyPolicy(base);
      }
    }) as [Policy, Policy];
    setAiSpeed(aiSpeedMs);
    setBoardName(nextBoardName);
    setControllers(ctrl);
    setGame(newGame(a, b, board));
  }

  const hotseatGame = online === null && game !== null;

  return (
    // One switch for every motion.* component in the app: `off` also forces
    // zero-duration transitions, so nothing animates under automation.
    <MotionConfig {...motionConfigProps(motionMode)}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <AppBar
        online={
          online && {
            status: online.status,
            code: online.code,
            peerConnected: online.peerConnected,
            playing: online.phase === 'playing',
          }
        }
        onLeaveOnline={() => session.leave()}
        hotseat={
          hotseatGame
            ? {
                controllers,
                onToggleAi: (seat, ai) =>
                  setControllers((prev) =>
                    seat === 0 ? [ai ? 'ai' : 'human', prev[1]] : [prev[0], ai ? 'ai' : 'human'],
                  ),
                onNewGame: () => setGame(null),
                aiThinking,
                activeSeat: game.active,
              }
            : null
        }
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main id="main">
        <Routes>
          <Route
            path="/"
            element={
              game && online === null ? (
                <GameView
                  game={game}
                  names={names}
                  onUpdate={setGame}
                  onInspect={setDetail}
                  onNewGame={() => setGame(null)}
                  boardName={boardName}
                />
              ) : (
                <SetupScreen
                  onStart={startGame}
                  onInspect={setDetail}
                  customDecks={customDecks}
                  customBoards={customBoards}
                />
              )
            }
          />
          <Route path="/decks" element={<DeckPage decks={DECKS} experimentalDecks={DEFENSE_DECKS} onInspect={setDetail} />} />
          <Route path="/build" element={<DeckBuilder decks={customDecks} onSave={setCustomDecks} onInspect={setDetail} />} />
          <Route path="/boards" element={<BoardEditor boards={customBoards} onSave={setCustomBoards} />} />
          <Route
            path="/online/*"
            element={
              <OnlineRoute
                session={session}
                game={game}
                names={names}
                setGame={setGame}
                onInspect={setDetail}
                customDecks={customDecks}
                customBoards={customBoards}
              />
            }
          />
          {/* Unknown path: fall back to the game screen rather than a blank page. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {detail && <CardDetailModal subject={detail} names={names} onClose={() => setDetail(null)} />}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={setSettings}
          resolved={motionMode}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </MotionConfig>
  );
}

/**
 * The /online branch. Entering the route starts a session if there isn't one, so a
 * bookmarked /online (or an invite link) behaves the same as clicking Online.
 */
function OnlineRoute({
  session,
  game,
  names,
  setGame,
  onInspect,
  customDecks,
  customBoards,
}: {
  session: ReturnType<typeof useOnlineSession>;
  game: GameState | null;
  names: ReturnType<typeof defaultResolver>;
  setGame: (g: GameState | null) => void;
  onInspect: (d: DetailSubject) => void;
  customDecks: ReturnType<typeof useStoredDecks>[0];
  customBoards: ReturnType<typeof useStoredBoards>[0];
}) {
  const { code } = useParams();
  const { online, begin } = session;

  useEffect(() => {
    if (online === null) {
      setGame(null);
      begin(code ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online === null]);

  if (!online) return null;

  if (online.phase === 'playing' && game && online.seat !== null) {
    return (
      <GameView
        game={game}
        names={names}
        onUpdate={setGame}
        onInspect={onInspect}
        onNewGame={() => session.leave()}
        seat={online.seat}
        onAction={session.sendAction}
      />
    );
  }

  return (
    <OnlineSetup
      phase={online.phase}
      status={online.status}
      errorMsg={online.errorMsg}
      lobby={online.lobby}
      seat={online.seat}
      initialCode={online.initialCode}
      customDecks={customDecks}
      customBoards={customBoards}
      onInspect={onInspect}
      onCreate={session.createRoom}
      onJoin={session.joinRoom}
      onSetDeck={session.setDeck}
      onSetBoard={session.setBoard}
      onReady={session.setReady}
      onStart={session.hostStart}
      onLeave={() => session.leave()}
    />
  );
}
