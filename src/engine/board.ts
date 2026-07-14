import type { Board, Coord, GameState, Occupant, Terrain, Tile, Unit } from './types';

export const BOARD_SIZE = 7;

export function inBounds(c: Coord): boolean {
  return c.col >= 1 && c.col <= BOARD_SIZE && c.row >= 1 && c.row <= BOARD_SIZE;
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.col === b.col && a.row === b.row;
}

export function tileAt(board: Board, c: Coord): Tile {
  const col = board[c.col - 1];
  if (!col) throw new Error(`col out of bounds: ${c.col}`);
  const tile = col[c.row - 1];
  if (!tile) throw new Error(`row out of bounds: ${c.row}`);
  return tile;
}

/** Orthogonal neighbours (movement / attack adjacency). */
export function orthAdjacent(c: Coord): Coord[] {
  return [
    { col: c.col + 1, row: c.row },
    { col: c.col - 1, row: c.row },
    { col: c.col, row: c.row + 1 },
    { col: c.col, row: c.row - 1 },
  ].filter(inBounds);
}

/** The surrounding 8 (summon zone / trap zone / "adjacent" for reach). */
export function mooreAdjacent(c: Coord): Coord[] {
  const out: Coord[] = [];
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue;
      const n = { col: c.col + dc, row: c.row + dr };
      if (inBounds(n)) out.push(n);
    }
  }
  return out;
}

export function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

export function occupantAt(s: GameState, c: Coord): Occupant | undefined {
  return tileAt(s.board, c).occupant;
}

export function unitAt(s: GameState, c: Coord): Unit | undefined {
  const occ = occupantAt(s, c);
  if (occ?.kind !== 'unit') return undefined;
  return s.units[occ.id];
}

export function isEmpty(s: GameState, c: Coord): boolean {
  return occupantAt(s, c) === undefined;
}

export function leaderOf(s: GameState, p: 0 | 1): Unit {
  const leader = Object.values(s.units).find((u) => u.isLeader && u.owner === p);
  if (!leader) throw new Error(`no leader for player ${p}`);
  return leader;
}

/** Deep-clone the state. Throwaway-POC simplicity: structured clone beats manual structural sharing. */
export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}

export function makeBoard(terrainFn?: (c: Coord) => Terrain): Board {
  const board: Board = [];
  for (let col = 1; col <= BOARD_SIZE; col++) {
    const colTiles: Tile[] = [];
    for (let row = 1; row <= BOARD_SIZE; row++) {
      colTiles.push({
        terrain: terrainFn ? terrainFn({ col, row }) : 'Normal',
        spring: false,
        springActive: false,
      });
    }
    board.push(colTiles);
  }
  // Springs at (2,4) and (6,4), neutral terrain, active from the start.
  const s1 = board[1]![3]!;
  const s2 = board[5]![3]!;
  s1.spring = true;
  s1.springActive = true;
  s1.terrain = 'Normal';
  s2.spring = true;
  s2.springActive = true;
  s2.terrain = 'Normal';
  return board;
}

/** A straight, contiguous line of tiles (for Line3 validation). */
export function isStraightContiguousLine(tiles: Coord[]): boolean {
  if (tiles.length < 2) return true;
  const [a, b] = [tiles[0]!, tiles[1]!];
  const dc = b.col - a.col;
  const dr = b.row - a.row;
  if (Math.abs(dc) + Math.abs(dr) !== 1 && !(Math.abs(dc) === 1 && Math.abs(dr) === 1)) return false;
  for (let i = 1; i < tiles.length; i++) {
    const prev = tiles[i - 1]!;
    const cur = tiles[i]!;
    if (cur.col - prev.col !== dc || cur.row - prev.row !== dr) return false;
  }
  return true;
}
