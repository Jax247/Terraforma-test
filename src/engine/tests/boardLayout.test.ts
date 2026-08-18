// Board layouts: round-trip, ranked-eligibility validator rules, and the engine
// playing correctly on a board with springs in non-standard positions.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, initGame } from '../engine';
import { arenaLayout, boardFromLayout, layoutFromBoard, validateBoardLayout } from '../boardLayout';
import type { BoardLayout } from '../boardLayout';
import { enumerateBoundActions } from '../targeting';
import { tileAt } from '../board';
import { DECK_CARDS, DECK_TOKENS, DECKS } from '../content/decks';
import type { Coord, Terrain } from '../types';

/** All-Normal, row-symmetric base with the classic spring pair. */
function plainLayout(overrides?: Partial<BoardLayout>): BoardLayout {
  return {
    terrain: Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => 'Normal' as Terrain)),
    springs: [{ col: 2, row: 4 }, { col: 6, row: 4 }],
    ...overrides,
  };
}

/** Paint one tile and its row-mirror (keeps layouts validator-symmetric). */
function paintMirrored(l: BoardLayout, c: Coord, t: Terrain): void {
  l.terrain[c.col - 1]![c.row - 1] = t;
  l.terrain[c.col - 1]![7 - c.row] = t;
}

describe('boardFromLayout / layoutFromBoard', () => {
  it('round-trips, including the arena template', () => {
    const arena = arenaLayout();
    expect(layoutFromBoard(boardFromLayout(arena))).toEqual(arena);
    const custom = plainLayout({ springs: [{ col: 3, row: 3 }, { col: 3, row: 5 }] });
    expect(layoutFromBoard(boardFromLayout(custom))).toEqual(custom);
  });

  it('the arena template is ranked-eligible', () => {
    expect(validateBoardLayout(arenaLayout())).toEqual([]);
  });

  it('throws on structural invalidity', () => {
    expect(() => boardFromLayout(plainLayout({ springs: [{ col: 8, row: 4 }] }))).toThrow(/out of bounds/);
    expect(() => boardFromLayout(plainLayout({ springs: [{ col: 2, row: 4 }, { col: 2, row: 4 }] }))).toThrow(/duplicate/);
    const short = plainLayout();
    short.terrain.pop();
    expect(() => boardFromLayout(short)).toThrow(/columns/);
    const alien = plainLayout();
    (alien.terrain[0] as string[])[0] = 'Lava';
    expect(() => boardFromLayout(alien)).toThrow(/unknown terrain/);
  });
});

describe('validateBoardLayout — ranked eligibility rules', () => {
  it('flags odd spring counts and missing mirrors', () => {
    expect(validateBoardLayout(plainLayout({ springs: [{ col: 4, row: 4 }] }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/odd spring count/)]),
    );
    const asym = validateBoardLayout(plainLayout({ springs: [{ col: 2, row: 3 }, { col: 6, row: 4 }] }));
    expect(asym.some((m) => /no mirror/.test(m))).toBe(true);
  });

  it('a lone center-row spring is even-count-ok only when paired', () => {
    // (4,4) mirrors to itself: passes the mirror check but fails odd count.
    const lone = validateBoardLayout(plainLayout({ springs: [{ col: 4, row: 4 }] }));
    expect(lone.some((m) => /odd spring count/.test(m))).toBe(true);
    expect(lone.some((m) => /no mirror/.test(m))).toBe(false);
  });

  it('flags springs inside a leader summon ring', () => {
    const v = validateBoardLayout(plainLayout({ springs: [{ col: 3, row: 2 }, { col: 3, row: 6 }] }));
    expect(v.some((m) => /summon ring/.test(m))).toBe(true);
  });

  it('flags non-Normal spring tiles and monochrome rings', () => {
    const onForest = plainLayout();
    paintMirrored(onForest, { col: 2, row: 4 }, 'Forest'); // row 4 self-mirrors
    expect(validateBoardLayout(onForest).some((m) => /sits on Forest/.test(m))).toBe(true);

    const mono = plainLayout();
    for (const col of [1, 2, 3]) {
      paintMirrored(mono, { col, row: 3 }, 'Desert'); // rows 3 and 5 via mirror
      paintMirrored(mono, { col, row: 4 }, 'Desert'); // row 4 self-mirrors
    }
    // Ring around (2,4) is now all Desert (spring tile itself untouched by ring check).
    const v = validateBoardLayout({ ...mono, springs: [{ col: 2, row: 4 }, { col: 6, row: 4 }] });
    expect(v.some((m) => /monochrome/.test(m) || /all Desert/.test(m))).toBe(true);
  });

  it('flags terrain that does not mirror across the center row', () => {
    const l = plainLayout();
    l.terrain[0]![0] = 'Shadow'; // (1,1) without (1,7)
    expect(validateBoardLayout(l).some((m) => /mirror across the center row/.test(m))).toBe(true);
  });

  it('reports bad shape without cascading', () => {
    const bad = plainLayout();
    bad.terrain.pop();
    expect(validateBoardLayout(bad)).toHaveLength(1);
  });
});

describe('engine on a custom board', () => {
  function customGame() {
    const layout = plainLayout({ springs: [{ col: 3, row: 3 }, { col: 3, row: 5 }] });
    const [a, b] = [DECKS[0]!, DECKS[1]!];
    return initGame({
      board: boardFromLayout(layout),
      cardDefs: DECK_CARDS,
      tokenDefs: DECK_TOKENS,
      players: [
        { leader: a.leader, deck: [...a.list], fusionPool: [...a.fusionPool] },
        { leader: b.leader, deck: [...b.list], fusionPool: [...b.fusionPool] },
      ],
    });
  }

  it('captures a spring at a non-standard position', () => {
    let s = customGame();
    const u = debugSpawn(s, 'thornfang', 0, { col: 3, row: 2 });
    const spBefore = s.players[0].sp;
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 3, row: 3 } });
    expect(s.players[0].sp).toBe(spBefore + 3);
    const tile = tileAt(s.board, { col: 3, row: 3 });
    expect(tile.springActive).toBe(false);
    expect(tile.springRelightRound).toBe(s.round + 3);
    // The classic spots are NOT springs on this board.
    expect(tileAt(s.board, { col: 2, row: 4 }).spring).toBe(false);
  });

  it('random bound-action playout stays clean', () => {
    let s = customGame();
    let x = 12345;
    const rnd = () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return x / 0x80000000;
    };
    for (let step = 0; step < 60 && s.phase !== 'gameover'; step++) {
      const actions = enumerateBoundActions(s);
      expect(actions.length).toBeGreaterThan(0);
      s = applyAction(s, actions[Math.floor(rnd() * actions.length)]!);
    }
  });
});
