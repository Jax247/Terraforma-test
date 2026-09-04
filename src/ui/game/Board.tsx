import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { describeSigil, sameCoord, tileAt } from '../../engine';
import type { Coord, GameState, PlayerId } from '../../engine';
import { keyLabel, matchBoardCommand } from '../keybinds';
import type { Keybinds } from '../keybinds';
import { terrainVar } from '../theme';
import { Icon } from '../components/Icon';
import { UnitToken } from './UnitToken';
import { ActionMenu, ActionMenuButton } from './ActionMenu';
import type { MenuPage } from './ActionMenu';
import type { DetailSubject } from '../CardDetail';

export interface BoardProps {
  /** The state to RENDER — the fogged view online, the real state in hotseat. */
  view: GameState;
  /** The real state, for effective-stat lookups on units the viewer can see. */
  game: GameState;
  viewer: PlayerId;
  /** Row/column render order — reversed for online seat 1, who sits at the far end. */
  rowOrder: number[];
  colOrder: number[];
  selected: string | null;
  moveTargets: Coord[];
  shotTargets: Coord[];
  pickedTargets: Coord[];
  /**
   * Every tile that is legal to click right now, for whatever the board is currently asking —
   * a move, a shot, a summon, a set, or one target of a spell / flip / leader ability. The
   * outline it drives is the affordance ("you may click here"); the markers below stay the
   * one that says what the click will DO.
   */
  availableTargets: Coord[];
  onTile: (c: Coord) => void;
  /**
   * The action menu each tile offers, keyed `"col,row"`. A tile with no entry has nothing to
   * offer and shows no ⋯ button — which is most of them, most of the time.
   */
  menus: ReadonlyMap<string, MenuPage>;
  /** Which key runs which board command. Player-configurable; see src/ui/keybinds.ts. */
  keybinds: Keybinds;
  /** The `cancel` command: back out of whatever the board is currently asking for. */
  onCancel: () => void;
  onHover: (s: DetailSubject | null) => void;
  /**
   * Which tile holds focus, or null when the board has lost it. The coord, not the piece on
   * it — GameView resolves the occupant live, so the detail panel cannot go on describing a
   * unit that has since moved or died.
   */
  onFocusTile: (c: Coord | null) => void;
  onInspect: (s: DetailSubject) => void;
  inspectUnit: (unitId: string) => DetailSubject;
  /**
   * Put the grid cursor here whenever `focusKey` changes — the board's answer to
   * "a new turn just started, where am I?".
   *
   * Two props rather than one because the COORD is not the trigger: a leader that
   * has not moved has the same position two turns running, and a leader that moves
   * mid-turn must not drag the cursor along behind it. The key is what says "this
   * is a new turn", and the coord is only where to land.
   */
  focusOn?: Coord | null;
  focusKey?: string | null;
}

export function Board({
  view,
  game,
  rowOrder,
  colOrder,
  selected,
  moveTargets,
  shotTargets,
  pickedTargets,
  availableTargets,
  onTile,
  menus,
  keybinds,
  onCancel,
  onHover,
  onFocusTile,
  onInspect,
  inspectUnit,
  focusOn,
  focusKey,
}: BoardProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  // Roving tabindex: the grid is ONE tab stop, and arrow keys move within it.
  // 49 individually tabbable tiles would be unusable.
  const [cursor, setCursor] = useState(0);
  /**
   * The open action menu: which tile it belongs to (`"col,row"`), and the element it hangs off.
   * Held here rather than in GameView because it is pure board chrome — nothing outside the
   * grid needs to know a menu is open, and keeping it local is what lets `closeMenu` hand the
   * grid cursor back without a round trip.
   */
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  /**
   * Drop a menu whose piece is no longer there — an opponent's move online can dissolve it
   * under an open menu. Deliberately does NOT pull focus back: the player did not ask for
   * this, and yanking their cursor mid-thought because the other seat moved would be worse
   * than the menu simply going away.
   */
  useEffect(() => {
    if (menuAt !== null && !menus.has(menuAt)) {
      setMenuAt(null);
      setMenuAnchor(null);
    }
  }, [menus, menuAt]);

  function openMenu(coord: string, anchor: HTMLElement) {
    if (!menus.has(coord)) return;
    setMenuAnchor(anchor);
    setMenuAt(coord);
  }

  /**
   * Close, and put the cursor back on the tile the menu belonged to — not on the ⋯ button that
   * opened it, which may not exist any more once the action has been taken.
   */
  function closeMenu() {
    const coord = menuAt;
    setMenuAt(null);
    setMenuAnchor(null);
    if (coord) gridRef.current?.querySelector<HTMLElement>(`[data-coord="${coord}"]`)?.focus();
  }

  /**
   * Land the cursor on the leader when the turn passes to this player, so the board
   * is already where the turn begins instead of wherever the last one left off.
   *
   * The focus is real, not just a moved tabindex: it is what the roving cursor,
   * the focus ring and a screen reader all read from, so a keyboard player can
   * arrow away from their leader immediately without hunting for the grid first.
   *
   * ⚠ Deliberately skipped while a dialog or an action menu is open — a zone picker,
   * the card detail modal or a piece's own menu owns focus at that point, and yanking
   * it to the board mid-choice would be a trap rather than a convenience.
   */
  useEffect(() => {
    if (!focusKey || !focusOn) return;
    if (document.querySelector('[role="dialog"], [role="menu"]')) return;
    // Focus only. The cursor follows via the tile's own onFocus, which keeps this
    // from being a second, independently-wrong idea of where the player is.
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-coord="${focusOn.col},${focusOn.row}"]`);
    el?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key IS the trigger; see the prop docs.
  }, [focusKey]);

  /**
   * Arrow-key traversal. Tiles are rendered in `rowOrder`/`colOrder` sequence, so a
   * step is an index shift in the flattened array — which stays correct under the
   * seat-1 board flip without any special-casing.
   */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Back out of whatever the board is asking for — until now the only way to abandon a
    // half-picked spell was to click a tile and hope it was refused. The menu handles its own
    // Escape and stops it before it reaches here.
    if (matchBoardCommand(e, keybinds) === 'cancel') {
      e.preventDefault();
      onCancel();
      return;
    }
    const cols = colOrder.length;
    const total = cols * rowOrder.length;
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -cols,
      ArrowDown: cols,
    };
    let next: number | undefined;
    if (e.key in deltas) next = cursor + deltas[e.key]!;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = total - 1;
    if (next === undefined || next < 0 || next >= total) return;
    // Don't wrap across a row edge on left/right.
    if (e.key === 'ArrowLeft' && cursor % cols === 0) return;
    if (e.key === 'ArrowRight' && cursor % cols === cols - 1) return;
    e.preventDefault();
    setCursor(next);
    gridRef.current?.querySelectorAll<HTMLElement>('.tile')[next]?.focus();
  }

  let index = -1;

  return (
    <div ref={gridRef} className="board" role="grid" aria-label="Battlefield" onKeyDown={onKeyDown}>
      {rowOrder.map((row) => (
        <div key={row} role="row" style={{ display: 'contents' }}>
          {colOrder.map((col) => {
            index += 1;
            const at = index;
            const c = { col, row };
            const coord = `${col},${row}`;
            const menu = menus.get(coord);
            const tile = tileAt(view.board, c);
            const occ = tile.occupant;
            const unit = occ?.kind === 'unit' ? view.units[occ.id] : undefined;

            const isSel = unit !== undefined && selected === unit.id;
            const isMove = moveTargets.some((m) => sameCoord(m, c));
            const isShot = shotTargets.some((m) => sameCoord(m, c));
            const isPicked = pickedTargets.some((p) => sameCoord(p, c));
            const isAvailable = availableTargets.some((a) => sameCoord(a, c));

            const describe = [
              `${col},${row}`,
              tile.terrain,
              tile.terrain === 'Wall' ? 'impassable' : null,
              tile.spring ? (tile.springActive ? 'active spring' : 'dormant spring') : null,
              tile.sigil ? `sigil: ${describeSigil(tile.sigil)}` : null,
              occ?.kind === 'set' ? 'face-down card' : null,
              isMove ? (occ ? 'attackable' : 'reachable') : null,
              isShot ? 'in firing range' : null,
              // The outline is the only cue for the flows that carry no marker of their own
              // (summon, set, spell targets), so it has to reach a screen reader too.
              isAvailable && !isMove && !isShot ? 'available target' : null,
              // The menu is the only route to half this piece's moves, so its existence has to
              // be announced — the ⋯ button is a 14px glyph and says nothing on its own.
              menu ? `has actions, press ${keyLabel(keybinds.actions)}` : null,
            ]
              .filter(Boolean)
              .join(', ');

            return (
              // A gridcell, not a <button>: the unit inside carries its own inspect
              // button, and a button inside a button is invalid — browsers hoist the
              // inner one out, which breaks both the markup and the click target.
              <div
                key={`${col},${row}`}
                role="gridcell"
                // SPIKE (throwaway): the 3D probe gives terrain height, and needs to
                // select on it. Nothing else reads this. See styles/_spike3d.scss.
                data-terrain={tile.terrain}
                // Addresses a tile by coordinate without depending on render order or on
                // parsing the aria-label — used by the turn-start focus, and by tests.
                data-coord={`${col},${row}`}
                tabIndex={at === cursor ? 0 : -1}
                className={clsx(
                  'tile',
                  isMove && 'tile-move',
                  occ && 'tile-occupied',
                  isShot && 'tile-shoot',
                  isSel && 'tile-selected',
                  isPicked && 'tile-picked',
                  isAvailable && 'tile-available',
                )}
                style={
                  {
                    '--tile-bg': `var(${terrainVar(tile.terrain)})`,
                    '--tile-edge': `var(${terrainVar(tile.terrain)}-edge)`,
                    '--tile-ink': `var(${terrainVar(tile.terrain)}-ink)`,
                  } as CSSProperties
                }
                onClick={(e) => {
                  // End the click path in a REAL focus, exactly as the arrow keys do, so the
                  // grid cursor and the focus ring never disagree about where the player is.
                  // The focus below is what moves the cursor now (see onFocus).
                  // Most browsers focus a tabindex="-1" div on click by themselves; not all do,
                  // and the ring must not depend on which one this is. Before `onTile`, which
                  // may dispatch and re-render.
                  e.currentTarget.focus();
                  onTile(c);
                }}
                // Right-click is what a player tries first for a context menu. Only claimed on
                // a tile that HAS one — anywhere else the browser's own menu still opens, so
                // "inspect element" and "open image in new tab" are not taken away.
                onContextMenu={(e) => {
                  if (!menu) return;
                  e.preventDefault();
                  // Same as the click path: end in a real focus so the grid cursor and the
                  // focus ring agree about where the player is.
                  e.currentTarget.focus();
                  openMenu(coord, e.currentTarget);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onTile(c);
                    return;
                  }
                  // Whatever the player bound to `actions`, plus the two platform gestures
                  // that always mean "context menu" — see src/ui/keybinds.ts.
                  if (matchBoardCommand(e, keybinds) !== 'actions' || !menu) return;
                  e.preventDefault();
                  openMenu(coord, e.currentTarget);
                }}
                onMouseEnter={unit ? () => onHover(inspectUnit(unit.id)) : undefined}
                onMouseLeave={unit ? () => onHover(null) : undefined}
                // React's focus events bubble, so focusing the unit's own info button counts as
                // focusing its tile — which is what a player would expect it to mean. Blur fires
                // before the next focus, so moving between tiles settles on the new one.
                //
                // This is also the ONE place the roving cursor is synced from, because focus is
                // the thing that actually moved. Setting it only where focus is *initiated* left
                // the cursor stale whenever focus arrived by any other route: the turn-start jump
                // to the leader moved the ring but not the cursor, so the first arrow key stepped
                // from wherever the previous turn had ended and threw focus across the board.
                onFocus={() => {
                  setCursor(at);
                  onFocusTile(c);
                }}
                onBlur={() => onFocusTile(null)}
                aria-label={describe}
                aria-selected={isSel}
              >
                <span className="tile-coord">
                  {col},{row}
                </span>
                {tile.terrain === 'Wall' && <span className="tile-wall" />}
                {tile.spring && (
                  <span className={clsx('tile-marker', 'tile-spring', !tile.springActive && 'tile-spring-dormant')}>
                    <Icon name="springActive" size={11} />
                  </span>
                )}
                {tile.sigil && (
                  <span className="tile-marker tile-sigil">
                    <Icon name="sigil" size={11} />
                  </span>
                )}

                {unit && (
                  <UnitToken game={game} unit={unit} onInspect={() => onInspect(inspectUnit(unit.id))} />
                )}
                {occ?.kind === 'set' && (
                  <span className="facedown" aria-hidden="true">
                    <Icon name="decks" size={16} />
                  </span>
                )}

                {/* Mouse and touch parity for the Actions key. Rendered as tile chrome rather
                    than inside UnitToken so a face-down card — which has no token — gets one
                    on exactly the same terms. */}
                {menu && (
                  <ActionMenuButton
                    label={menu.title}
                    open={menuAt === coord}
                    onOpen={(anchor) => openMenu(coord, anchor)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}

      {menuAt !== null && menus.get(menuAt) && (
        <ActionMenu page={menus.get(menuAt)!} anchor={menuAnchor} onClose={closeMenu} />
      )}
    </div>
  );
}
