// The built-in competitive map pool.
//
// Design constraints come from the vault (Board & Grid, Terrain System, Springs) and are all
// enforced by `validateBoardLayout` — every map here is required by test to be ranked-eligible:
//
//   · 7x7, leaders at (4,1)/(4,7), mirrored across the centre row — the player-fairness axis.
//     Fairness must be VISIBLE, not merely balanced, so the mirror is non-negotiable.
//   · Springs fixed at (2,4)/(6,4) on every map, so the spring meta is learnable across the
//     pool; terrain is the layer that varies. Spring tiles are Normal (a camper fights at base
//     stats — "first grab isn't first keep") and their rings are mixed, never a monochrome
//     favourable ring that would make a spring un-attackable.
//   · Walls may not seal the two halves apart, and never wall in a leader.
//
// On top of that, standard competitive-map practice: multiple routes between the halves (never
// a single corridor), chokepoints that create hotspots rather than dead ends, and a fast centre
// lane that is deliberately unrewarded — the vault's "committing there is pure aggression with
// no economic payoff". Each map then takes ONE clear identity so the pool reads as a set of
// different questions rather than one map with reskins.
//
// Terrain identity is drawn from the type chart: Sea and Sanctuary are the two "weakener"
// terrains (they punish rather than reward), Mountain/Desert/Forest are home ground for whole
// type clusters, and Grassland favours Warriors alone — which makes it the natural surface for
// a neutral highway.

import { BOARD_SIZE } from '../board';
import { boardFromLayout, layoutFromBoard } from '../boardLayout';
import type { BoardLayout } from '../boardLayout';
import { makeArenaBoard } from './decks';
import type { Board, Coord, Terrain } from '../types';

/** Fixed spring anchors — identical on every map in the pool (vault: Springs). */
export const SPRINGS: readonly Coord[] = [
  { col: 2, row: 4 },
  { col: 6, row: 4 },
];

const LEGEND: Record<string, Terrain> = {
  '.': 'Normal',
  F: 'Forest',
  M: 'Mountain',
  S: 'Sea',
  G: 'Grassland',
  D: 'Desert',
  H: 'Shadow',
  Y: 'Sanctuary',
  '#': 'Wall',
};

/**
 * Parse a map picture into a layout. Rows are given TOP-DOWN — row 7 (P2's back line) first,
 * row 1 (P1's back line) last — so the string literal reads the way the board renders.
 */
export function parseMap(picture: string[]): BoardLayout {
  if (picture.length !== BOARD_SIZE) throw new Error(`map picture must have ${BOARD_SIZE} rows`);
  const terrain: Terrain[][] = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill('Normal') as Terrain[]);
  picture.forEach((line, i) => {
    const cells = line.trim().split(/\s+/);
    if (cells.length !== BOARD_SIZE) throw new Error(`map row '${line}' must have ${BOARD_SIZE} cells`);
    const row = BOARD_SIZE - i; // first line is the top row
    cells.forEach((ch, c) => {
      const t = LEGEND[ch];
      if (!t) throw new Error(`unknown map glyph '${ch}'`);
      terrain[c]![row - 1] = t;
    });
  });
  return { terrain, springs: SPRINGS.map((c) => ({ ...c })) };
}

export interface BoardDef {
  id: string;
  name: string;
  /** One line on what question this map asks — shown in the picker. */
  blurb: string;
  layout: BoardLayout;
}

/**
 * Crossroads — the baseline. No walls, four terrain quadrants meeting at a Grassland spine.
 * Every route is open, so nothing is decided by geometry: it is the control map the others are
 * read against. The flanks are deliberately NOT identical to each other (Forest left, Mountain
 * right) — both players have equal access to both, so it is fair, and it turns "which spring do
 * I contest" into a real question about your type cluster rather than a coin flip.
 */
const CROSSROADS = [
  'F F . G . M M',
  'F . . G . . M',
  '. . D G D . .',
  '. . G G G . .',
  '. . D G D . .',
  'F . . G . . M',
  'F F . G . M M',
];

/**
 * Highlands — terrain warfare, still no walls. Mountain corners are home to the heavy cluster
 * (Dragon/Avian/Machine/Terra); the Sea channel down the centre weakens exactly those types.
 * So the flanks belong to heavy decks and the fast lane is the one place they cannot fight
 * well — pressure gets pushed outward onto the springs without a single wall doing it.
 */
const HIGHLANDS = [
  'M M . . . M M',
  'M . . S . . M',
  '. . G S G . .',
  '. . S S S . .',
  '. . G S G . .',
  'M . . S . . M',
  'M M . . . M M',
];

/**
 * Twin Passes — a walled spine across the centre row with three gaps: the two springs and the
 * centre tile. Every crossing is therefore a chokepoint, and two of the three are the economy.
 * This is the one map where a spring is genuinely holdable (walls cut its attack angles from
 * four to two), which deliberately inverts the pool's usual "first grab isn't first keep" —
 * worth one map out of five, and the reason the centre gap exists is so a hold can be answered
 * rather than sealing the game.
 */
const TWIN_PASSES = [
  '. . F G F . .',
  '. F . G . F .',
  'D . . . . . D',
  '# . # . # . #',
  'D . . . . . D',
  '. F . G . F .',
  '. . F G F . .',
];

/**
 * The Gauntlet — the inverse of Twin Passes: the centre is a wide-open Grassland highway and
 * the walls run alongside it, splitting the board into three lanes that only interconnect on
 * the centre row. Picking a lane is a commitment you cannot cheaply undo, which is the classic
 * chokepoint-and-flank structure; the highway is fast but bare (Grassland favours Warriors and
 * nobody else) while the flank lanes hold the Mountain ground and both springs.
 */
const GAUNTLET = [
  '. . . G . . .',
  '. . # G # . .',
  'M . # . # . M',
  '. . . G . . .',
  'M . # . # . M',
  '. . # G # . .',
  '. . . G . . .',
];

/**
 * Sanctum — the weakener map. A Sanctuary spine runs the centre (punishing Insect, Spellcaster,
 * Fiend and Undead), Shadow corners give the dark cluster its home, and Desert bands connect
 * them. A dark deck owns the edges but cannot take the short road; a light or Warrior deck can
 * march straight up it. Four pillar walls around the centre give cover without gating movement,
 * so the map asks a deckbuilding question rather than a pathing one.
 */
const SANCTUM = [
  'H . . . . . H',
  '. . D Y D . .',
  '. D # Y # D .',
  '. . . Y . . .',
  '. D # Y # D .',
  '. . D Y D . .',
  'H . . . . . H',
];

export const BOARDS: BoardDef[] = [
  {
    id: 'arena',
    name: 'Arena',
    blurb: 'The standard ranked map — every archetype’s terrain, seeded symmetrically.',
    layout: layoutFromBoard(makeArenaBoard()),
  },
  {
    id: 'crossroads',
    name: 'Crossroads',
    blurb: 'Open maneuver map. No walls; Forest flank vs Mountain flank, Grassland spine.',
    layout: parseMap(CROSSROADS),
  },
  {
    id: 'highlands',
    name: 'Highlands',
    blurb: 'Mountain corners for the heavy cluster, a Sea channel that punishes them mid-board.',
    layout: parseMap(HIGHLANDS),
  },
  {
    id: 'twinPasses',
    name: 'Twin Passes',
    blurb: 'Walled centre row: every crossing is a chokepoint, and two of the three are springs.',
    layout: parseMap(TWIN_PASSES),
  },
  {
    id: 'gauntlet',
    name: 'The Gauntlet',
    blurb: 'Three lanes joined only at the centre row. Pick a side and live with it.',
    layout: parseMap(GAUNTLET),
  },
  {
    id: 'sanctum',
    name: 'Sanctum',
    blurb: 'Sanctuary highway vs Shadow corners — the anti-dark map, with pillar cover.',
    layout: parseMap(SANCTUM),
  },
];

export const boardById = (id: string): BoardDef | undefined => BOARDS.find((b) => b.id === id);

export function makeBoardFrom(def: BoardDef): Board {
  return boardFromLayout(def.layout);
}

// ---------------------------------------------------------------------------
// Procedural maps
// ---------------------------------------------------------------------------

/** Terrain drawn for random maps. Wall is added separately and sparingly. */
const RANDOM_TERRAINS: Terrain[] = ['Normal', 'Forest', 'Mountain', 'Sea', 'Grassland', 'Desert', 'Shadow', 'Sanctuary'];

const key = (c: Coord) => `${c.col},${c.row}`;
const inB = (c: Coord) => c.col >= 1 && c.col <= BOARD_SIZE && c.row >= 1 && c.row <= BOARD_SIZE;

function orth(c: Coord): Coord[] {
  return [
    { col: c.col, row: c.row - 1 },
    { col: c.col, row: c.row + 1 },
    { col: c.col - 1, row: c.row },
    { col: c.col + 1, row: c.row },
  ].filter(inB);
}

/**
 * Generate a symmetric map. Terrain is grown in blobs rather than sprinkled per tile, because
 * per-tile noise produces confetti that plays as uniform mush — clusters are what create ground
 * worth standing on. Rows 1..3 are generated and mirrored onto 5..7; row 4 is its own mirror.
 * Springs, their rings, and the leader starts are then repaired, and the result is validated —
 * `randomBoardLayout` rejects and retries anything that fails, so callers always get a map that
 * would pass ranked eligibility.
 */
function attemptRandomLayout(rand: () => number): BoardLayout {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const terrain: Terrain[][] = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill('Normal') as Terrain[]);
  const set = (c: Coord, t: Terrain) => {
    terrain[c.col - 1]![c.row - 1] = t;
    terrain[c.col - 1]![BOARD_SIZE - c.row] = t; // mirror across the centre row
  };

  // 3-5 terrain blobs, each grown from a seed tile in the lower half (rows 1..4).
  const blobs = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < blobs; i++) {
    const t = pick(RANDOM_TERRAINS);
    let cur: Coord = { col: 1 + Math.floor(rand() * BOARD_SIZE), row: 1 + Math.floor(rand() * 4) };
    const size = 3 + Math.floor(rand() * 5);
    for (let n = 0; n < size; n++) {
      set(cur, t);
      const next = orth(cur).filter((c) => c.row <= 4);
      if (next.length === 0) break;
      cur = pick(next);
    }
  }

  // A few walls, in short segments so they read as structure rather than litter. Kept off the
  // centre column so the fast lane always exists, and off row 1 so a leader is never boxed in.
  const wallSegments = Math.floor(rand() * 3); // 0-2
  for (let i = 0; i < wallSegments; i++) {
    let cur: Coord = { col: 1 + Math.floor(rand() * BOARD_SIZE), row: 2 + Math.floor(rand() * 3) };
    const len = 1 + Math.floor(rand() * 3);
    for (let n = 0; n < len; n++) {
      if (cur.col !== 4) set(cur, 'Wall');
      const next = orth(cur).filter((c) => c.row >= 2 && c.row <= 4);
      if (next.length === 0) break;
      cur = pick(next);
    }
  }

  // --- Repairs: the invariants the pool guarantees. ---
  for (const start of [{ col: 4, row: 1 }, { col: 4, row: 7 }]) {
    set(start, 'Normal'); // never strand a leader
    for (const c of orth(start)) if (terrain[c.col - 1]![c.row - 1] === 'Wall') set(c, 'Normal');
  }
  for (const sp of SPRINGS) {
    set(sp, 'Normal'); // spring tiles are neutral ground
    // Ring must be mixed: if every ring tile came out the same non-Normal terrain, break it up.
    const ring: Coord[] = [];
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const c = { col: sp.col + dc, row: sp.row + dr };
        if ((dc !== 0 || dr !== 0) && inB(c)) ring.push(c);
      }
    }
    const kinds = new Set(ring.map((c) => terrain[c.col - 1]![c.row - 1]));
    if (kinds.size === 1 && !kinds.has('Normal')) set(ring[0]!, 'Normal');
  }

  return { terrain, springs: SPRINGS.map((c) => ({ ...c })) };
}

/** Are the two leader starts connected over non-Wall tiles? */
function connected(layout: BoardLayout): boolean {
  const at = (c: Coord) => layout.terrain[c.col - 1]![c.row - 1]!;
  const from = { col: 4, row: 1 };
  const to = { col: 4, row: 7 };
  const seen = new Set([key(from)]);
  const queue = [from];
  while (queue.length > 0) {
    for (const n of orth(queue.shift()!)) {
      if (seen.has(key(n)) || at(n) === 'Wall') continue;
      seen.add(key(n));
      queue.push(n);
    }
  }
  return seen.has(key(to));
}

/**
 * A fresh symmetric, ranked-eligible random map. Rejection-samples until the generated layout
 * passes the same validator the built-in pool is held to; falls back to Crossroads in the
 * pathological case so a caller can never be handed an unplayable board.
 */
export function randomBoardLayout(rand: () => number = Math.random): BoardLayout {
  for (let attempt = 0; attempt < 40; attempt++) {
    const layout = attemptRandomLayout(rand);
    if (connected(layout)) return layout;
  }
  return parseMap(CROSSROADS);
}
