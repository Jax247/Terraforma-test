import { useMemo, useState } from 'react';
import {
  activationReach,
  applyAction,
  cardCandidates,
  cardRequest,
  combinedRequest,
  enumerateBoundActions,
  enumerateTargetSets,
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

/**
 * The tile half of an in-flight activation.
 *
 * `effects` is carried rather than a snapshot of the enumerated tiles: the board re-derives
 * the legal targets from the engine on every render, so what it outlines is what
 * `applyAction` will accept. Stashing coordinates here would be a second copy of engine
 * state to keep honest, for no gain — nothing applies while a pick is in flight, so the
 * enumeration is stable anyway.
 */
type Aimed = { needed: number; picked: Coord[]; effects: SpellEffectLine[] };

type Targeting =
  | { kind: 'summon'; card: string }
  // `stance` is carried through targeting because a face-down UNIT now picks its posture on the
  // way down — since 2026-08-16 that is the only way a hidden unit can fight on DEF.
  | { kind: 'set'; card: string; stance?: 'attack' | 'defense' }
  | ({ kind: 'cast'; card: string } & Aimed & CardPick)
  | ({ kind: 'flip'; set: string } & Aimed & CardPick)
  | ({ kind: 'ability' } & Aimed & CardPick)
  | { kind: 'moveset'; set: string };

/** Dedupe coords — several enumerations reach the same tile by more than one route. */
function uniqueCoords(cs: Coord[]): Coord[] {
  const seen = new Set<string>();
  return cs.filter((c) => {
    const key = `${c.col},${c.row}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The tile sets the PICKER will accept, which is not quite the set `enumerateTargetSets`
 * returns.
 *
 * A Line3 is enumerated in one canonical direction per line, because binding an action only
 * needs one representative of each. A player clicking that same line the other way round is
 * choosing the same three tiles and the engine takes it — `isStraightContiguousLine` reads
 * the direction off the first two — so without the reverse the outline would go dark after
 * the first click on any line drawn right-to-left. A fusePair is already emitted both ways
 * round, and every other request is a single tile, so this is a no-op for them.
 */
function pickableSets(sets: Coord[][]): Coord[][] {
  return sets.flatMap((set) => (set.length > 1 ? [set, [...set].reverse()] : [set]));
}

/**
 * The card an in-flight activation is placing or resolving.
 *
 * Exists because the detail panel used to go blank at exactly the moment "what am I putting
 * down?" is the live question: starting a summon clears the hover and selects nothing, so the
 * player picks a tile for a card they can no longer see.
 *
 * ⚠ `moveset` is deliberately absent. Walking a face-down card must not name it — nothing else
 * in the UI does, and hotseat shares a screen. A `flip` DOES name its spell, because the leader
 * panel the player just clicked to start it already listed the card by name.
 */
function targetingSubject(view: GameState, viewer: PlayerId, t: Targeting | null): DetailSubject | null {
  if (!t) return null;
  switch (t.kind) {
    case 'summon':
    case 'set':
    case 'cast': {
      const def = view.cardDefs[t.card];
      return def ? { kind: 'card', def } : null;
    }
    case 'flip': {
      const sc = view.setCards[t.set];
      const def = sc ? view.cardDefs[sc.cardId] : undefined;
      return def ? { kind: 'card', def } : null;
    }
    case 'ability':
      // Not a card at all — the leader whose ability is mid-resolution.
      return { kind: 'leader', def: view.leaders[viewer] };
    case 'moveset':
      return null;
  }
}

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
  // The tile holding keyboard/mouse focus, as a COORD rather than a resolved subject: the
  // occupant changes under it (a unit moves off, dies, is fused away) and a captured subject
  // would go on describing a piece that is no longer there.
  const [focusedTile, setFocusedTile] = useState<Coord | null>(null);
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
    setTargeting({ ...base, needed, picked: [], req, effects });
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

  /**
   * Every tile that is legal to click RIGHT NOW, whatever the board is currently asking for.
   *
   * A selected unit's moves and shots always had their own markers, but every OTHER flow that
   * wants a tile — summoning, setting face-down, walking a face-down card, and each target of a
   * spell, flip or leader ability — asked in prose and marked nothing, so a wrong guess was only
   * discovered as a thrown engine error. All of it is enumerated by the engine rather than
   * re-derived here, so the board cannot outline a tile `applyAction` would refuse.
   */
  const availableTargets: Coord[] = (() => {
    if (!targeting) return uniqueCoords([...moveTargets, ...shotTargets]);
    switch (targeting.kind) {
      case 'summon':
        return uniqueCoords(
          legal
            .filter((a): a is Extract<Action, { t: 'Summon' }> => a.t === 'Summon' && a.card === targeting.card)
            .map((a) => a.tile),
        );
      case 'set':
        // Not filtered by stance: both stances are offered on the same ring of tiles, and a set
        // spell or trap carries no stance at all.
        return uniqueCoords(
          legal
            .filter((a): a is Extract<Action, { t: 'SetCard' }> => a.t === 'SetCard' && a.card === targeting.card)
            .map((a) => a.tile),
        );
      case 'moveset':
        return uniqueCoords(
          legal
            .filter((a): a is Extract<Action, { t: 'MoveSet' }> => a.t === 'MoveSet' && a.set === targeting.set)
            .map((a) => a.to),
        );
      default: {
        // Multi-tile requests are picked one tile at a time, so what is legal next depends on what
        // is already down: keep the sets still matching `picked`, and offer their next tile.
        const { picked } = targeting;
        const sets = pickableSets(
          enumerateTargetSets(game, viewer, combinedRequest(targeting.effects), activationReach(game, viewer, targeting)),
        );
        return uniqueCoords(
          sets
            .filter((set) => picked.every((p, i) => set[i] !== undefined && sameCoord(p, set[i]!)))
            .map((set) => set[picked.length])
            .filter((c): c is Coord => c !== undefined),
        );
      }
    }
  })();

  const selectedUnit = selected ? game.units[selected] : undefined;

  /**
   * What the detail panel is describing.
   *
   * Four sources, most transient first: the pointer, the focused tile, the card an activation
   * is placing, then the standing selection. Hover wins because it is the deliberate "what is
   * this?" gesture and ends the moment the pointer leaves; the rest persist, so they are the
   * floor the panel falls back to rather than going blank. Focusing an empty tile contributes
   * nothing and drops through, which is what makes arrowing around the board while holding a
   * unit selected still describe the unit.
   *
   * An in-flight activation outranks the SELECTION even though it is the newer source: while a
   * pick is in flight `clickTile` handles it first and the selection is inert, so describing the
   * selected unit there would be describing the one thing a click cannot currently act on.
   *
   * A face-down card is deliberately not a source, exactly as it is not one for hover: its
   * identity is hidden information, and both players share a screen in hotseat.
   */
  const focusedOccupant = focusedTile ? tileAt(view.board, focusedTile).occupant : undefined;
  const focusedUnit = focusedOccupant?.kind === 'unit' ? view.units[focusedOccupant.id] : undefined;
  const detail: DetailSubject | null =
    hovered ??
    (focusedUnit ? inspectUnit(focusedUnit.id) : null) ??
    targetingSubject(view, viewer, targeting) ??
    (selectedUnit ? inspectUnit(selectedUnit.id) : null);

  const stanceActions: Extract<Action, { t: 'SetStance' }>[] = selected
    ? legal.filter((a): a is Extract<Action, { t: 'SetStance' }> => a.t === 'SetStance' && a.unit === selected)
    : [];

  /**
   * Which hand cards each play is actually available on right now.
   *
   * Off the engine's own enumeration rather than re-checking SP and the caps in the hand, for
   * the same reason the board's target outline is: a second derivation of a rule drifts from
   * the first. Every play used to be offered on every card unconditionally, so an unaffordable
   * one took the player into tile-targeting and only then failed on the click.
   *
   * ⚠ The FULLY BOUND enumeration, not `legalActions`. Two reasons, both about casting:
   * `legalActions` emits `CastSpell` for GLOBAL spells only — a located spell's face-up cast is
   * added by `enumerateBoundActions` — so the cheaper list would grey out every located spell in
   * the deck. And the bound list drops a spell whose targets cannot be satisfied at all, which is
   * the same dead end this is here to close. Summon and Set pass through it unchanged, so they
   * read identically either way.
   */
  const playable = useMemo(() => {
    const summon = new Set<string>();
    const cast = new Set<string>();
    const set = new Set<string>();
    for (const a of enumerateBoundActions(game)) {
      if (a.t === 'Summon') summon.add(a.card);
      else if (a.t === 'CastSpell') cast.add(a.card);
      else if (a.t === 'SetCard') set.add(a.card);
    }
    return { summon, cast, set };
  }, [game]);

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
            ? 'Click an outlined tile to move / attack, or a ringed tile to shoot.'
            : 'Click an outlined tile to move / attack / fuse.'
        : ''
      : cardPick
        // The card step runs first, so the tile prompts must not front-run it.
        ? cardPick.kind === 'graveyard'
          ? `Choose which ${cardPick.type} to raise.`
          : 'Choose a card to search for.'
        : availableTargets.length === 0
          // Reachable, and from more than one direction: an activation can want a tile and find
          // none (a Raise with the ring walled off, a ChosenEnemy on a board holding nothing but
          // leaders), and the hand offers `set` on a card the player cannot currently afford.
          // Deliberately does not guess which — it says what the board can show, which is nothing.
          ? 'No legal tile for this — click any tile to cancel.'
          : targeting.kind === 'summon'
            ? 'Click an outlined tile to summon.'
            : targeting.kind === 'set'
              ? `Click an outlined tile to set face-down${targeting.stance === 'defense' ? ' in defense' : ''}.`
              : targeting.kind === 'moveset'
                ? 'Click an outlined tile to move the face-down card (1 tile).'
                : `Pick ${targeting.needed - targeting.picked.length} more target tile(s) from the outlined ones.`;

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
          {detail ? (
            <CardDetailBody subject={detail} names={names} />
          ) : (
            <div className="detail-empty">
              Hover, focus or select a card to see its details here.
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
          availableTargets={availableTargets}
          onTile={clickTile}
          onHover={setHovered}
          onFocusTile={setFocusedTile}
          onInspect={onInspect}
          inspectUnit={inspectUnit}
        />

        <Hand
          view={view}
          viewer={viewer}
          myTurn={myTurn}
          pendingBurn={pendingBurn !== undefined}
          playable={playable}
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
