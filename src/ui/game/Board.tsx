import clsx from 'clsx';
import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { describeSigil, sameCoord, tileAt } from '../../engine';
import type { Coord, GameState, PlayerId } from '../../engine';
import { terrainVar } from '../theme';
import { Icon } from '../components/Icon';
import { UnitToken } from './UnitToken';
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
  onTile: (c: Coord) => void;
  onHover: (s: DetailSubject | null) => void;
  onInspect: (s: DetailSubject) => void;
  inspectUnit: (unitId: string) => DetailSubject;
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
  onTile,
  onHover,
  onInspect,
  inspectUnit,
}: BoardProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  // Roving tabindex: the grid is ONE tab stop, and arrow keys move within it.
  // 49 individually tabbable tiles would be unusable.
  const [cursor, setCursor] = useState(0);

  /**
   * Arrow-key traversal. Tiles are rendered in `rowOrder`/`colOrder` sequence, so a
   * step is an index shift in the flattened array — which stays correct under the
   * seat-1 board flip without any special-casing.
   */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
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
            const tile = tileAt(view.board, c);
            const occ = tile.occupant;
            const unit = occ?.kind === 'unit' ? view.units[occ.id] : undefined;

            const isSel = unit !== undefined && selected === unit.id;
            const isMove = moveTargets.some((m) => sameCoord(m, c));
            const isShot = shotTargets.some((m) => sameCoord(m, c));
            const isPicked = pickedTargets.some((p) => sameCoord(p, c));

            const describe = [
              `${col},${row}`,
              tile.terrain,
              tile.terrain === 'Wall' ? 'impassable' : null,
              tile.spring ? (tile.springActive ? 'active spring' : 'dormant spring') : null,
              tile.sigil ? `sigil: ${describeSigil(tile.sigil)}` : null,
              occ?.kind === 'set' ? 'face-down card' : null,
              isMove ? (occ ? 'attackable' : 'reachable') : null,
              isShot ? 'in firing range' : null,
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
                tabIndex={at === cursor ? 0 : -1}
                className={clsx(
                  'tile',
                  isMove && 'tile-move',
                  occ && 'tile-occupied',
                  isShot && 'tile-shoot',
                  isSel && 'tile-selected',
                  isPicked && 'tile-picked',
                )}
                style={
                  {
                    '--tile-bg': `var(${terrainVar(tile.terrain)})`,
                    '--tile-edge': `var(${terrainVar(tile.terrain)}-edge)`,
                    '--tile-ink': `var(${terrainVar(tile.terrain)}-ink)`,
                  } as CSSProperties
                }
                onClick={() => {
                  setCursor(at);
                  onTile(c);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onTile(c);
                }}
                onMouseEnter={unit ? () => onHover(inspectUnit(unit.id)) : undefined}
                onMouseLeave={unit ? () => onHover(null) : undefined}
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
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
