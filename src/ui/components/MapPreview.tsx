import type { BoardLayout, Terrain } from '../../engine';
import { terrainVar } from '../theme';
import { Icon } from './Icon';

/**
 * A read-only render of a layout, so a map can be seen before it is committed to.
 *
 * Terrain colour comes from the CSS variables published by applyTerrainTokens, so
 * the preview and the real board can never drift apart. Both sizes declare explicit
 * grid ROWS: the tiles are empty elements, so auto-sized rows collapse to zero.
 */
export function MapPreview({ layout, thumb = false }: { layout: BoardLayout; thumb?: boolean }) {
  const springs = new Set(layout.springs.map((c) => `${c.col},${c.row}`));
  const rows = [7, 6, 5, 4, 3, 2, 1];
  const cols = [1, 2, 3, 4, 5, 6, 7];
  return (
    <div className={thumb ? 'map-thumb' : 'map-preview'} role="img" aria-label="Map layout">
      {rows.map((row) =>
        cols.map((col) => {
          const terrain: Terrain = layout.terrain[col - 1]![row - 1]!;
          return (
            <div
              key={`${col},${row}`}
              className="map-preview-tile"
              style={{ background: `var(${terrainVar(terrain)})` }}
              title={`(${col},${row}) ${terrain}`}
            >
              {!thumb && springs.has(`${col},${row}`) && <Icon name="springActive" size={10} />}
            </div>
          );
        }),
      )}
    </div>
  );
}

/** Thumbnail form, for a ChoiceCard figure. */
export function MapThumb({ layout }: { layout: BoardLayout }) {
  return <MapPreview layout={layout} thumb />;
}
