import { useMemo, useState } from 'react';
import {
  boardById,
  boardFromLayout,
  BOARDS,
  deckCost,
  DECKS,
  makeArenaBoard,
  STANDARD_DC_CAP,
  validateBoardLayout,
  validateDeck,
} from '../engine';
import type { Board, DeckDef, PlayerId } from '../engine';
import type { LobbyState } from '../net/protocol';
import type { NetStatus } from '../net/client';
import type { DetailSubject } from './CardDetail';
import { saveOnlineSetup, loadOnlineSetup, toDeckDef } from './storage';
import type { StoredBoard, StoredDeck } from './storage';
import { Button } from './components/Button';
import { CardPortrait } from './components/CardFrame';
import { ChoiceCard } from './components/ChoiceCard';
import { StatChip, Tag } from './components/Chip';
import { Icon } from './components/Icon';
import { MapThumb } from './components/MapPreview';
import { Panel } from './components/Panel';
import { StageHead } from './components/StageHead';

export type OnlinePhase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'desync';

const STATUS_LABEL: Record<NetStatus, string> = {
  connecting: 'Connecting…',
  open: '',
  reconnecting: 'Connection lost — reconnecting…',
  closed: '',
};

/** Entry (create/join a room) + lobby (decks, board, ready, start) for online play. */
export function OnlineSetup({
  phase,
  status,
  errorMsg,
  lobby,
  seat,
  initialCode,
  customDecks,
  customBoards,
  onInspect,
  onCreate,
  onJoin,
  onSetDeck,
  onSetBoard,
  onReady,
  onStart,
  onLeave,
}: {
  phase: OnlinePhase;
  status: NetStatus;
  errorMsg: string;
  lobby: LobbyState | null;
  seat: PlayerId | null;
  /** Prefill for the join field (from a ?room= invite link). */
  initialCode: string;
  customDecks: StoredDeck[];
  customBoards: StoredBoard[];
  onInspect: (s: DetailSubject) => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onSetDeck: (deck: DeckDef) => void;
  onSetBoard: (board: Board, boardName: string) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const [joinInput, setJoinInput] = useState(initialCode);
  const [copied, setCopied] = useState(false);
  const [boardId, setBoardId] = useState(() => loadOnlineSetup().boardId ?? 'arena');

  const pickable = useMemo(
    () => [
      ...DECKS.map((def) => ({ def, custom: false, violations: [] as string[] })),
      ...customDecks.map((d) => {
        const def = toDeckDef(d);
        return { def, custom: true, violations: validateDeck(def) };
      }),
    ],
    [customDecks],
  );

  // ---- Desync: an honest dead end with one way out ------------------------
  if (phase === 'desync') {
    return (
      <div className="online-entry">
        <Icon name="warning" size={32} />
        <div className="online-title">Out of sync</div>
        <div className="online-error">{errorMsg}</div>
        <Button variant="accent" size="lg" block onClick={onLeave}>
          Leave room
        </Button>
      </div>
    );
  }

  // ---- Connecting: say what is happening, don't just disable the buttons ---
  if (phase === 'connecting') {
    return (
      <div className="online-entry">
        <span className="spinner" />
        <div className="online-title">Connecting</div>
        <div className="online-lede">{STATUS_LABEL[status] || 'Reaching the room server…'}</div>
        {errorMsg && <div className="online-error">{errorMsg}</div>}
        <Button size="lg" onClick={onLeave}>
          Cancel
        </Button>
      </div>
    );
  }

  // ---- Idle: create or join -----------------------------------------------
  if (phase !== 'lobby' || !lobby || seat === null) {
    return (
      <div className="online-entry">
        <div className="online-title">Play online</div>
        <div className="online-lede">
          Create a room and send the invite link to your opponent, or enter a code you were given.
        </div>

        <div className="online-actions">
          <Button variant="accent" size="lg" block onClick={onCreate}>
            Create a room
          </Button>

          <div className="online-or">or</div>

          <div className="join-row">
            <input
              className="code-input"
              value={joinInput}
              placeholder="Room code"
              aria-label="Room code"
              maxLength={5}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && joinInput.length === 5) onJoin(joinInput);
              }}
            />
            <Button size="lg" disabled={joinInput.length !== 5} onClick={() => onJoin(joinInput)}>
              Join
            </Button>
          </div>
        </div>

        {STATUS_LABEL[status] && (
          <div className="online-status">
            <Icon name={status === 'open' ? 'connected' : 'disconnected'} size={13} />
            {STATUS_LABEL[status]}
          </div>
        )}
        {errorMsg && <div className="online-error">{errorMsg}</div>}
      </div>
    );
  }

  const isHost = seat === 0;
  const me = lobby.seats[seat];
  const other = lobby.seats[seat === 0 ? 1 : 0];
  const bothReady = lobby.seats[0].ready && lobby.seats[1].ready;
  const inviteLink = `${location.origin}${location.pathname}?room=${lobby.code}`;

  function copyInvite() {
    navigator.clipboard?.writeText(inviteLink).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => prompt('Copy the invite link:', inviteLink),
    );
  }

  function chooseBoard(id: string) {
    setBoardId(id);
    saveOnlineSetup({ ...loadOnlineSetup(), boardId: id });
    // The full Board travels in the start payload, so built-in and custom maps are equally safe
    // here. (The random modes are local-only: both clients must agree on one concrete map.)
    const builtIn = boardById(id);
    if (builtIn) return onSetBoard(boardFromLayout(builtIn.layout), builtIn.name);
    const stored = customBoards.find((b) => b.id === id);
    onSetBoard(stored ? boardFromLayout(stored.layout) : makeArenaBoard(), stored?.name ?? 'Arena');
  }

  function chooseDeck(def: DeckDef) {
    saveOnlineSetup({ ...loadOnlineSetup(), deckId: def.id });
    onSetDeck(def);
  }

  const seatCard = (label: string, index: 0 | 1, s: (typeof lobby.seats)[number], you: boolean) => (
    <div className={`seat-card${you ? ' seat-you' : ''}`}>
      <div className="seat-head">
        <span className={`seat-badge seat-badge-${index}`}>P{index + 1}</span>
        <span className="seat-role">
          {label}
          {you && ' (you)'}
        </span>
        <Tag tone={s.ready ? 'ok' : 'default'}>
          {s.ready ? <Icon name="check" size={11} /> : null}
          {s.ready ? 'Ready' : 'Not ready'}
        </Tag>
      </div>
      <div className="seat-detail">
        <Tag tone={s.connected ? 'ok' : 'warn'}>
          <Icon name={s.connected ? 'connected' : 'disconnected'} size={11} />
          {s.connected ? 'Connected' : 'Offline'}
        </Tag>
        <span>{s.deck ? s.deck.name : 'choosing a deck…'}</span>
      </div>
    </div>
  );

  return (
    <div className="lobby">
      <Panel title="Room" as="section">
        <div className="room-code">{lobby.code}</div>
        <div className="lobby-buttons">
          <Button size="sm" block onClick={copyInvite}>
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            {copied ? 'Link copied' : 'Copy invite link'}
          </Button>
        </div>

        <div className="seat-list">
          {seatCard('Host', 0, lobby.seats[0], seat === 0)}
          {seatCard('Guest', 1, lobby.seats[1], seat === 1)}
        </div>

        <div className="lobby-buttons">
          <Button
            active={me.ready}
            disabled={!me.deck}
            title={me.deck ? '' : 'Pick a deck first'}
            onClick={() => onReady(!me.ready)}
          >
            {me.ready ? 'Ready' : 'Ready?'}
          </Button>
          {isHost && (
            <Button
              variant="accent"
              disabled={!bothReady || !other.connected}
              title={bothReady ? '' : 'Both players must be ready'}
              onClick={onStart}
            >
              Start game
            </Button>
          )}
          <Button variant="ghost" onClick={onLeave}>
            Leave
          </Button>
        </div>

        {!isHost && <div className="lobby-hint">Waiting for the host to start…</div>}
        {!me.deck && <div className="lobby-hint">Pick a deck to become ready.</div>}
        {STATUS_LABEL[status] && (
          <div className="online-status">
            <Icon name={status === 'open' ? 'connected' : 'disconnected'} size={13} />
            {STATUS_LABEL[status]}
          </div>
        )}
        {errorMsg && <div className="online-error">{errorMsg}</div>}
      </Panel>

      <section className="stage" aria-label="Your deck">
        <StageHead step={1} title="Your deck" />
        <div className="choice-list" role="radiogroup" aria-label="Your deck">
          {pickable.map(({ def, custom, violations }) => (
            <ChoiceCard
              key={def.id}
              role="radio"
              selected={me.deck?.id === def.id}
              onSelect={() => chooseDeck(def)}
              title={def.name}
              tag={custom ? 'custom' : undefined}
              figure={<CardPortrait id={def.leader.id} name={def.leader.name} type={def.leader.type} />}
              blurb={`${def.leader.name} · ${def.leader.type}`}
              badges={
                <>
                  <StatChip
                    label="DC"
                    value={`${deckCost(def)}/${STANDARD_DC_CAP}`}
                    tone={deckCost(def) > STANDARD_DC_CAP ? 'warn' : 'accent'}
                  />
                  {violations.length > 0 && (
                    <Tag tone="warn">
                      <Icon name="warning" size={11} />
                      {violations.length}
                    </Tag>
                  )}
                </>
              }
              aside={
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Details for ${def.leader.name}`}
                  onClick={() => onInspect({ kind: 'leader', def: def.leader })}
                >
                  <Icon name="info" size={15} />
                </Button>
              }
            />
          ))}
        </div>
      </section>

      <section className="stage" aria-label="Battlefield">
        <StageHead step={2} title="Battlefield" note={isHost ? undefined : 'host’s choice'} />
        {isHost ? (
          <div className="choice-list" role="radiogroup" aria-label="Map">
            {BOARDS.map((b) => (
              <ChoiceCard
                key={b.id}
                role="radio"
                selected={boardId === b.id}
                onSelect={() => chooseBoard(b.id)}
                title={b.name}
                blurb={b.blurb}
                figure={<MapThumb layout={b.layout} />}
              />
            ))}
            {customBoards.map((b) => {
              const warns = validateBoardLayout(b.layout);
              return (
                <ChoiceCard
                  key={b.id}
                  role="radio"
                  selected={boardId === b.id}
                  onSelect={() => chooseBoard(b.id)}
                  title={b.name}
                  tag="custom"
                  blurb={`${b.layout.springs.length} springs`}
                  figure={<MapThumb layout={b.layout} />}
                  badges={
                    warns.length > 0 ? (
                      <Tag tone="warn">
                        <Icon name="warning" size={11} />
                        {warns.length}
                      </Tag>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        ) : (
          <Panel>
            <div className="board-locked">
              <Icon name="map" size={16} />
              {lobby.boardName ?? 'Arena'}
            </div>
          </Panel>
        )}
      </section>
    </div>
  );
}
