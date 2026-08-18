import { useMemo, useState } from 'react';
import {
  applyAction,
  cardCandidates,
  cardRequest,
  legalActions,
  sameCoord,
  targetsNeeded,
  tileAt,
} from '../engine';
import type { Action, CardRequest, Coord, GameState, NameResolver, PlayerId, SpellCardDef, SpellEffectLine } from '../engine';
import { sanitize } from '../ai';
import { Button } from './components/Button';
import { Panel } from './components/Panel';
import { CardDetailBody } from './CardDetail';
import type { DetailSubject } from './CardDetail';
import { describeExperiments, liveExperiments } from './experiments';
import { Modal } from './Modal';
import { ZoneModal } from './ZoneModal';
import { Board } from './game/Board';
import { Hand } from './game/Hand';
import { FullLog, groupLogByTurn, LogPanel } from './game/LogPanel';
import { LeaderPanel, StancePanel } from './game/SidePanels';
import { StatusHud } from './game/StatusHud';
import { WinnerOverlay } from './game/WinnerOverlay';
import { ZonesPanel } from './game/ZonesPanel';

/**
 * The two axes an activation can ask for. `picked` collects TILES off the board; `chosenCard`
 * collects a CARD from a zone (the 2026-08-08 card-choice pass — a chosen Raise, or a `Search` in
 * 'choose' mode). The card is picked FIRST when both are wanted: "what am I raising" reads better
 * than "where does the thing I have not chosen yet go", and it lets the tile prompt name the card.
 */
type CardPick = { req: CardRequest; chosenCard?: string };

type Targeting =
  | { kind: 'summon'; card: string }
  // `stance` is carried through targeting because a face-down UNIT now picks its posture on the
  // way down — since 2026-08-16 that is the only way a hidden unit can fight on DEF.
  | { kind: 'set'; card: string; stance?: 'attack' | 'defense' }
  | ({ kind: 'cast'; card: string; needed: number; picked: Coord[] } & CardPick)
  | ({ kind: 'flip'; set: string; needed: number; picked: Coord[] } & CardPick)
  | ({ kind: 'ability'; needed: number; picked: Coord[] } & CardPick)
  | { kind: 'moveset'; set: string };

export function GameView({
  game,
  names,
  onUpdate,
  onInspect,
  onNewGame,
  seat,
  onAction,
  boardName,
}: {
  game: GameState;
  names: NameResolver;
  onUpdate: (g: GameState) => void;
  onInspect: (s: DetailSubject) => void;
  onNewGame: () => void;
  /** Online mode: the fixed local seat. Undefined = hotseat (render as the active player). */
  seat?: PlayerId;
  /** Online mode: called after an action applied cleanly, so it can be sent to the relay. */
  onAction?: (a: Action, next: GameState) => void;
  /** Which map this game is on. Worth showing when the picker rolled it for you. */
  boardName?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null); // unit id
  const [targeting, setTargeting] = useState<Targeting | null>(null);
  const [error, setError] = useState('');
  const [zoneView, setZoneView] = useState<{ player: PlayerId; zone: 'deck' | 'graveyard' } | null>(null);
  const [showFullLog, setShowFullLog] = useState(false);
  const logTurns = useMemo(() => groupLogByTurn(game.log), [game.log]);
  const [hovered, setHovered] = useState<DetailSubject | null>(null); // card under the cursor
  // Below xl the command rail is a drawer under the board, so the board owns the screen.
  const [drawerOpen, setDrawerOpen] = useState(true);

  const legal = useMemo(() => legalActions(game), [game]);
  const active = game.active;
  // What this game is actually running, so a tweak can never be forgotten mid-playtest.
  const activeRules = describeExperiments(liveExperiments());
  // Online: render everything through the fog-of-war view for the fixed local
  // seat; actions still validate/apply against the real state. Hotseat renders
  // the real state as the active player, exactly as before.
  const view = useMemo(() => (seat === undefined ? game : sanitize(game, seat)), [game, seat]);
  const viewer: PlayerId = seat ?? active;
  const myTurn = seat === undefined || active === seat;
  const ps = view.players[viewer];
  const leader = view.leaders[viewer];
  // Online seat 1 sits at the far end (row 7), so rotate the board 180° — both
  // axes flip — to render it from their end, own side at the bottom. Hotseat and
  // seat 0 keep the canonical orientation (row 7 top, col 1 left).
  const flip = seat === 1;
  const rowOrder = flip ? [1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1];
  const colOrder = flip ? [7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7];

  function dispatch(a: Action) {
    if (!myTurn) {
      setError('Waiting for your opponent…');
      setSelected(null);
      setTargeting(null);
      return;
    }
    try {
      const next = applyAction(game, a);
      onUpdate(next);
      onAction?.(a, next);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSelected(null);
    setTargeting(null);
  }

  /**
   * Begin a cast / flip / ability. Resolves both axes up front: how many TILES it wants, and
   * whether it wants a CARD from a zone. With neither, it fires immediately — which is what keeps
   * every no-target spell a single click, exactly as before card choice existed.
   */
  function beginActivation(base: { kind: 'cast'; card: string } | { kind: 'flip'; set: string } | { kind: 'ability' }, effects: SpellEffectLine[]) {
    const needed = targetsNeeded(effects);
    const req = cardRequest(effects);
    if (needed === 0 && req.kind === 'none') {
      if (base.kind === 'cast') return dispatch({ t: 'CastSpell', card: base.card });
      if (base.kind === 'flip') return dispatch({ t: 'FlipCard', set: base.set });
      return dispatch({ t: 'ActivateAbility' });
    }
    setTargeting({ ...base, needed, picked: [], req });
  }

  /** The card-pick step, if the in-flight activation is waiting on one. */
  const cardPick = targeting && 'req' in targeting && targeting.req.kind !== 'none' && !targeting.chosenCard
    ? targeting.req
    : null;

  function pickCard(cardId: string) {
    if (!targeting || !('req' in targeting)) return;
    const next = { ...targeting, chosenCard: cardId };
    // A chosen Search wants no tile at all — it is complete the moment the card is named.
    if (next.needed === 0) {
      const chosenCards = [cardId];
      if (next.kind === 'cast') return dispatch({ t: 'CastSpell', card: next.card, chosenCards });
      if (next.kind === 'flip') return dispatch({ t: 'FlipCard', set: next.set, chosenCards });
      return dispatch({ t: 'ActivateAbility', chosenCards });
    }
    setTargeting(next);
  }

  function inspectUnit(unitId: string): DetailSubject {
    const unit = game.units[unitId]!;
    if (unit.isLeader) return { kind: 'leader', def: game.leaders[unit.owner] };
    if (unit.isToken) return { kind: 'token', def: game.tokenDefs[unit.cardId]! };
    return { kind: 'card', def: game.cardDefs[unit.cardId]! };
  }

  function clickTile(c: Coord) {
    if (game.phase === 'gameover') return;
    // Target-picking flows first.
    if (targeting) {
      if (targeting.kind === 'summon') return dispatch({ t: 'Summon', card: targeting.card, tile: c });
      if (targeting.kind === 'set') return dispatch({ t: 'SetCard', card: targeting.card, tile: c, stance: targeting.stance });
      if (targeting.kind === 'moveset') return dispatch({ t: 'MoveSet', set: targeting.set, to: c });
      const picked = [...targeting.picked, c];
      if (picked.length < targeting.needed) {
        setTargeting({ ...targeting, picked });
        return;
      }
      const chosenCards = targeting.chosenCard ? [targeting.chosenCard] : undefined;
      if (targeting.kind === 'cast') return dispatch({ t: 'CastSpell', card: targeting.card, targets: picked, chosenCards });
      if (targeting.kind === 'flip') return dispatch({ t: 'FlipCard', set: targeting.set, targets: picked, chosenCards });
      if (targeting.kind === 'ability') return dispatch({ t: 'ActivateAbility', targets: picked, chosenCards });
      return;
    }
    const occ = tileAt(game.board, c).occupant;
    // Select own unit / set card.
    if (occ?.kind === 'unit' && game.units[occ.id]!.owner === viewer && selected !== occ.id) {
      setSelected(occ.id);
      return;
    }
    if (occ?.kind === 'set' && game.setCards[occ.id]!.owner === viewer) {
      setTargeting({ kind: 'moveset', set: occ.id });
      setSelected(null);
      return;
    }
    // Act with the selected unit. A shot is offered on its own tiles, so a ranged unit whose
    // target sits outside melee has a way to attack at all — without this a range-2 shooter is
    // simply unplayable by hand.
    if (selected) {
      if (shotTargets.some((t) => sameCoord(t, c))) {
        dispatch({ t: 'RangedAttack', unit: selected, target: c });
        return;
      }
      dispatch({ t: 'Move', unit: selected, to: c });
      return;
    }
    setSelected(null);
  }

  const moveTargets: Coord[] = selected
    ? legal.filter((a): a is Extract<Action, { t: 'Move' }> => a.t === 'Move' && a.unit === selected).map((a) => a.to)
    : [];
  const shotTargets: Coord[] = selected
    ? legal
        .filter((a): a is Extract<Action, { t: 'RangedAttack' }> => a.t === 'RangedAttack' && a.unit === selected)
        .map((a) => a.target)
    : [];

  const selectedUnit = selected ? game.units[selected] : undefined;
  const stanceActions: Extract<Action, { t: 'SetStance' }>[] = selected
    ? legal.filter((a): a is Extract<Action, { t: 'SetStance' }> => a.t === 'SetStance' && a.unit === selected)
    : [];

  const selectedSetForFlip = Object.values(view.setCards).filter(
    (sc) => sc.owner === viewer && view.cardDefs[sc.cardId]!.kind === 'spell',
  );

  const pendingBurn = game.pendingBurn?.player === viewer ? game.pendingBurn : undefined;

  const prompt = pendingBurn
    ? `Hand over ${ps.hand.length - 1} cards — burn one to the void to make room for the new draw.`
    : targeting === null
      ? selected
        ? selectedUnit?.stance === 'defense'
          ? 'This unit is defending — it can only switch back to attack stance.'
          : shotTargets.length > 0
            ? 'Click a highlighted tile to move / attack, or a ringed tile to shoot.'
            : 'Click a highlighted tile to move / attack / fuse.'
        : ''
      : targeting.kind === 'summon'
        ? 'Click an empty tile in the leader ring to summon.'
        : targeting.kind === 'set'
          ? `Click an empty tile in the leader ring to set face-down${targeting.stance === 'defense' ? ' in defense' : ''}.`
          : targeting.kind === 'moveset'
            ? 'Click an adjacent empty tile to move the face-down card (1 tile).'
            : cardPick
              // The card step runs first, so the tile count must not front-run it.
              ? cardPick.kind === 'graveyard'
                ? `Choose which ${cardPick.type} to raise.`
                : 'Choose a card to search for.'
              : `Pick ${targeting.needed - targeting.picked.length} more target tile(s).`;

  const pickedTargets = targeting && 'picked' in targeting ? targeting.picked : [];

  return (
    <div className="game-layout">
      {game.winner !== undefined && (
        <WinnerOverlay
          game={game}
          winner={game.winner}
          online={seat !== undefined}
          onNewGame={onNewGame}
          onViewLog={() => setShowFullLog(true)}
        />
      )}

      {showFullLog && (
        <Modal title="Full log" wide onClose={() => setShowFullLog(false)}>
          <FullLog turns={logTurns} />
        </Modal>
      )}

      {/* Hover inspector. Hidden below xl, where there is no hover to speak of. */}
      <div className="detail-col">
        <Panel title="Card detail">
          {hovered ? (
            <CardDetailBody subject={hovered} names={names} />
          ) : (
            <div className="detail-empty">
              Hover a card in hand or a unit on the board to see its details here.
            </div>
          )}
        </Panel>
      </div>

      <div className="board-col">
        <Board
          view={view}
          game={game}
          viewer={viewer}
          rowOrder={rowOrder}
          colOrder={colOrder}
          selected={selected}
          moveTargets={moveTargets}
          shotTargets={shotTargets}
          pickedTargets={pickedTargets}
          onTile={clickTile}
          onHover={setHovered}
          onInspect={onInspect}
          inspectUnit={inspectUnit}
        />

        <Hand
          view={view}
          viewer={viewer}
          myTurn={myTurn}
          pendingBurn={pendingBurn !== undefined}
          onInspect={onInspect}
          onHover={setHovered}
          onBurn={(index) => dispatch({ t: 'BurnCard', index })}
          onSummon={(card) => setTargeting({ kind: 'summon', card })}
          onCast={(card, def) => beginActivation({ kind: 'cast', card }, (def as SpellCardDef).effects)}
          onSet={(card, stance) => setTargeting({ kind: 'set', card, stance })}
        />

        {/* Below xl the command rail folds into a drawer under the board. */}
        <div className="drawer-tabs" role="tablist" aria-label="Game panels">
          <Button
            className="drawer-tab"
            size="sm"
            variant="ghost"
            role="tab"
            aria-selected={drawerOpen}
            active={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            {drawerOpen ? 'Hide' : 'Show'} status, zones & log
          </Button>
        </div>
      </div>

      <div className={`side${drawerOpen ? '' : ' side-collapsed'}`}>
        <StatusHud
          game={game}
          active={active}
          viewer={viewer}
          sp={ps.sp}
          turnCount={ps.turnCount}
          boardName={boardName}
          seat={seat}
          myTurn={myTurn}
          canEndTurn={!game.pendingBurn && myTurn}
          onEndTurn={() => dispatch({ t: 'EndTurn' })}
        />

        <div className="prompt" role="status">{prompt}</div>
        <div className="error" role="alert">{error}</div>

        {activeRules.length > 0 && (
          <Panel title="Experimental ruleset" className="experiment-banner">
            {activeRules.map((line, i) => (
              <div key={i}>· {line}</div>
            ))}
          </Panel>
        )}

        {selectedUnit && !selectedUnit.isLeader && selectedUnit.owner === viewer && (
          <StancePanel
            game={game}
            unit={selectedUnit}
            actions={stanceActions}
            myTurn={myTurn}
            onDispatch={dispatch}
          />
        )}

        <LeaderPanel
          leader={leader}
          sp={ps.sp}
          myTurn={myTurn}
          setSpells={selectedSetForFlip}
          cardDefs={view.cardDefs}
          onActivate={() => beginActivation({ kind: 'ability' }, leader.ability.effects)}
          onFlip={(setId, def) => beginActivation({ kind: 'flip', set: setId }, def.effects)}
          onInspect={onInspect}
        />

        <ZonesPanel
          view={view}
          seat={seat}
          onOpenZone={(player, zone) => setZoneView({ player, zone })}
          onInspect={onInspect}
        />

        <LogPanel log={game.log} onOpenFull={() => setShowFullLog(true)} />
      </div>

      {zoneView && (
        <ZoneModal
          game={view}
          player={zoneView.player}
          zone={zoneView.zone}
          onClose={() => setZoneView(null)}
          onInspect={onInspect}
        />
      )}

      {cardPick && (
        <ZoneModal
          game={game}
          player={viewer}
          zone={cardPick.kind === 'graveyard' ? 'graveyard' : 'deck'}
          onClose={() => setTargeting(null)}
          onInspect={onInspect}
          pick={{
            prompt: cardPick.kind === 'graveyard' ? `Raise which ${cardPick.type}?` : 'Search for which card?',
            // Own-zone candidates from the real state, never the fogged view: this is the
            // player's own graveyard/deck, which they are entitled to see in full.
            only: cardCandidates(game, viewer, cardPick),
            onPick: pickCard,
          }}
        />
      )}
    </div>
  );
}
