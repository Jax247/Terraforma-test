// The built-in map pool and the procedural generator.
//
// A map's whole job is to be fair and playable, and both are checkable — so these are not
// "does it parse" tests. Every shipped map must be ranked-eligible by the same validator a
// player's custom map is judged by, must keep the spring anchors the vault fixes across the
// pool, and must actually be traversable. The generator is held to the identical bar.

import { describe, expect, it } from 'vitest';
import { BOARDS, parseMap, randomBoardLayout, SPRINGS } from '../content/boards';
import { boardFromLayout, validateBoardLayout } from '../boardLayout';
import { BOARD_SIZE, orthAdjacent, tileAt } from '../board';
import type { BoardLayout } from '../boardLayout';
import type { Coord, Terrain } from '../types';

const LEADER_STARTS: Coord[] = [{ col: 4, row: 1 }, { col: 4, row: 7 }];
const at = (l: BoardLayout, c: Coord): Terrain => l.terrain[c.col - 1]![c.row - 1]!;

/** Tiles reachable from a leader start over non-Wall terrain. */
function reachable(layout: BoardLayout, from: Coord): Set<string> {
  const seen = new Set([`${from.col},${from.row}`]);
  const queue = [from];
  while (queue.length > 0) {
    for (const n of orthAdjacent(queue.shift()!)) {
      const k = `${n.col},${n.row}`;
      if (seen.has(k) || at(layout, n) === 'Wall') continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return seen;
}

/** How many distinct non-Wall tiles sit on the centre row — the crossing width. */
const crossings = (l: BoardLayout) =>
  Array.from({ length: BOARD_SIZE }, (_, i) => ({ col: i + 1, row: 4 })).filter((c) => at(l, c) !== 'Wall');

describe('the built-in map pool', () => {
  it('ships more than one map, each with a unique id and name', () => {
    expect(BOARDS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(BOARDS.map((b) => b.id)).size).toBe(BOARDS.length);
    expect(new Set(BOARDS.map((b) => b.name)).size).toBe(BOARDS.length);
  });

  for (const board of BOARDS) {
    describe(board.name, () => {
      it('is ranked-eligible (symmetric, spring-legal, unsealed)', () => {
        expect(validateBoardLayout(board.layout)).toEqual([]);
      });

      it('builds into a playable Board', () => {
        const b = boardFromLayout(board.layout);
        expect(tileAt(b, { col: 2, row: 4 }).spring).toBe(true);
        expect(tileAt(b, { col: 6, row: 4 }).spring).toBe(true);
      });

      it('keeps the pool-wide spring anchors so the spring meta stays learnable', () => {
        expect(board.layout.springs).toEqual(SPRINGS.map((c) => ({ ...c })));
        for (const sp of SPRINGS) expect(at(board.layout, sp)).toBe('Normal');
      });

      it('mirrors across the centre row', () => {
        for (let col = 1; col <= BOARD_SIZE; col++) {
          for (let row = 1; row <= 3; row++) {
            expect(at(board.layout, { col, row })).toBe(at(board.layout, { col, row: BOARD_SIZE + 1 - row }));
          }
        }
      });

      it('leaves both leaders standing and able to deploy', () => {
        for (const start of LEADER_STARTS) {
          expect(at(board.layout, start)).not.toBe('Wall');
          const ring = orthAdjacent(start).filter((c) => at(board.layout, c) !== 'Wall');
          expect(ring.length).toBeGreaterThan(0);
        }
      });

      it('connects the two halves by more than one route', () => {
        const seen = reachable(board.layout, LEADER_STARTS[0]!);
        expect(seen.has('4,7')).toBe(true); // traversable at all
        // A single crossing tile would let one body shut the game down.
        expect(crossings(board.layout).length).toBeGreaterThanOrEqual(2);
      });

      it('reaches both springs from both sides', () => {
        for (const start of LEADER_STARTS) {
          const seen = reachable(board.layout, start);
          for (const sp of SPRINGS) expect(seen.has(`${sp.col},${sp.row}`)).toBe(true);
        }
      });
    });
  }
});

describe('map pictures', () => {
  it('rejects a malformed picture rather than producing a broken board', () => {
    expect(() => parseMap(['. . .'])).toThrow(/7 rows/);
    expect(() => parseMap(Array(7).fill('. . .'))).toThrow(/7 cells/);
    expect(() => parseMap(Array(7).fill('Z . . . . . .'))).toThrow(/unknown map glyph/);
  });

  it('reads top-down, so the literal matches what the board renders', () => {
    const l = parseMap([
      'M . . . . . .', // row 7
      '. . . . . . .',
      '. . . . . . .',
      '. . . . . . .',
      '. . . . . . .',
      '. . . . . . .',
      'F . . . . . .', // row 1
    ]);
    expect(at(l, { col: 1, row: 7 })).toBe('Mountain');
    expect(at(l, { col: 1, row: 1 })).toBe('Forest');
  });
});

describe('the procedural generator', () => {
  it('only ever returns ranked-eligible maps', () => {
    for (let i = 0; i < 200; i++) {
      const layout = randomBoardLayout();
      expect(validateBoardLayout(layout)).toEqual([]);
    }
  });

  it('always leaves the two leader starts connected', () => {
    for (let i = 0; i < 100; i++) {
      const layout = randomBoardLayout();
      expect(reachable(layout, LEADER_STARTS[0]!).has('4,7')).toBe(true);
    }
  });

  it('never walls a leader in or paves over a spring', () => {
    for (let i = 0; i < 100; i++) {
      const layout = randomBoardLayout();
      for (const sp of SPRINGS) expect(at(layout, sp)).toBe('Normal');
      for (const start of LEADER_STARTS) {
        expect(at(layout, start)).not.toBe('Wall');
        expect(orthAdjacent(start).some((c) => at(layout, c) !== 'Wall')).toBe(true);
      }
    }
  });

  it('actually varies — 30 rolls are not the same map', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(JSON.stringify(randomBoardLayout().terrain));
    expect(seen.size).toBeGreaterThan(20);
  });

  it('is deterministic for a given random source', () => {
    const seeded = () => {
      let x = 42;
      return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
    };
    expect(randomBoardLayout(seeded())).toEqual(randomBoardLayout(seeded()));
  });
});
