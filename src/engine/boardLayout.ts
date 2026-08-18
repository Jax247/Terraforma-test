// Serializable starting-board layouts for the map editor. Pure TS — no React,
// no storage. The engine runtime is spring-position-agnostic (checkSpringCapture
// and relightSprings are per-tile), so a layout may place any even set of springs;
// only makeBoard hardcodes the classic (2,4)/(6,4) pair.
//
// Validation is WARN-ONLY by design: the vault's custom-map ruling is that custom
// maps default to casual, and a symmetry validator gates *ranked eligibility*
// (mirror across center, mixed spring-adjacent terrain). Nothing here blocks play.

import { BOARD_SIZE, inBounds, mooreAdjacent, orthAdjacent, sameCoord, tileAt } from './board';
import { makeArenaBoard } from './content/decks';
import { RULES } from './rules';
import type { Board, Coord, SigilSpec, Terrain, Tile } from './types';

/** All legal terrains, in palette order — single source of truth for editor + validator. */
export const TERRAINS: readonly Terrain[] = [
  'Normal', 'Forest', 'Mountain', 'Sea', 'Grassland', 'Desert', 'Shadow', 'Sanctuary', 'Wall',
];

/** The status kinds a sigil may carry — mirrors SigilSpec['status']. */
export const SIGIL_STATUSES: readonly SigilSpec['status'][] =
  ['Stunned', 'Snared', 'Disarmed', 'Suppressed', 'Marked', 'AtkMod', 'DefMod'];

/** Starting-board description. terrain is col-major [col-1][row-1], matching Board. */
export interface BoardLayout {
  terrain: Terrain[][];
  /** Spring tiles; all start active. Even symmetric pairs per the vault (validated, not enforced). */
  springs: Coord[];
  /**
   * Marked ground (see SigilSpec). Sparse and optional, so every board authored before sigils
   * existed still deserializes untouched. An entry with no `spec` inherits the RULES fallback
   * at board-build time — that is what makes the rules knob a *default* and the per-tile spec
   * an *override*.
   */
  sigils?: { at: Coord; spec?: SigilSpec }[];
}

/** The RULES fallback, resolved. Kept here so boardFromLayout is the only place it is read. */
function defaultSigilSpec(): SigilSpec {
  return { status: RULES.sigilStatus, amount: RULES.sigilAmount, turns: RULES.sigilTurns };
}

const LEADER_STARTS: readonly Coord[] = [{ col: 4, row: 1 }, { col: 4, row: 7 }]; // mirrors initGame

/** Mirror across the center row — the player-fairness axis. */
function rowMirror(c: Coord): Coord {
  return { col: c.col, row: BOARD_SIZE + 1 - c.row };
}

function checkShape(layout: BoardLayout): string | undefined {
  if (!Array.isArray(layout.terrain) || layout.terrain.length !== BOARD_SIZE) {
    return `terrain must be ${BOARD_SIZE} columns`;
  }
  for (const col of layout.terrain) {
    if (!Array.isArray(col) || col.length !== BOARD_SIZE) return `every terrain column must have ${BOARD_SIZE} rows`;
    for (const t of col) {
      if (!TERRAINS.includes(t)) return `unknown terrain '${String(t)}'`;
    }
  }
  const seenSigils = new Set<string>();
  for (const { at, spec } of layout.sigils ?? []) {
    if (!inBounds(at)) return `sigil (${at.col},${at.row}) out of bounds`;
    if (seenSigils.has(springKey(at))) return `duplicate sigil (${at.col},${at.row})`;
    seenSigils.add(springKey(at));
    if (spec === undefined) continue; // inherits the RULES fallback
    if (!SIGIL_STATUSES.includes(spec.status)) return `unknown sigil status '${String(spec.status)}'`;
    if (!Number.isFinite(spec.turns) || spec.turns < 0) return `sigil (${at.col},${at.row}) has a negative duration`;
  }
  return undefined;
}

function sameSpec(a: SigilSpec | undefined, b: SigilSpec | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.status === b.status && a.amount === b.amount && a.turns === b.turns;
}

function springKey(c: Coord): string {
  return `${c.col},${c.row}`;
}

/** Build a playable Board. Throws on structural invalidity (shape, out-of-bounds/duplicate springs). */
export function boardFromLayout(layout: BoardLayout): Board {
  const shapeError = checkShape(layout);
  if (shapeError) throw new Error(`bad board layout: ${shapeError}`);
  const seen = new Set<string>();
  for (const c of layout.springs) {
    if (!inBounds(c)) throw new Error(`bad board layout: spring (${c.col},${c.row}) out of bounds`);
    if (seen.has(springKey(c))) throw new Error(`bad board layout: duplicate spring (${c.col},${c.row})`);
    seen.add(springKey(c));
  }
  const board: Board = layout.terrain.map((col) =>
    col.map((terrain): Tile => ({ terrain, spring: false, springActive: false })),
  );
  for (const c of layout.springs) {
    const tile = board[c.col - 1]![c.row - 1]!;
    tile.spring = true;
    tile.springActive = true;
  }
  // Materialise the fallback here, so a live Board always states its own sigils outright.
  // That is what keeps online play safe: the Board travels in the StartPayload but the RULES
  // knobs do not, so a spec left implicit would resolve against each client's local rules.
  for (const { at, spec } of layout.sigils ?? []) {
    board[at.col - 1]![at.row - 1]!.sigil = spec ? { ...spec } : defaultSigilSpec();
  }
  return board;
}

/** Extract the editable layout from an existing Board (template path). */
export function layoutFromBoard(board: Board): BoardLayout {
  const springs: Coord[] = [];
  const sigils: { at: Coord; spec?: SigilSpec }[] = [];
  for (let col = 1; col <= BOARD_SIZE; col++) {
    for (let row = 1; row <= BOARD_SIZE; row++) {
      const tile = tileAt(board, { col, row });
      if (tile.spring) springs.push({ col, row });
      // Always explicit on the way out: a round trip must not silently re-resolve against
      // whatever the RULES fallback happens to be at load time.
      if (tile.sigil) sigils.push({ at: { col, row }, spec: { ...tile.sigil } });
    }
  }
  const layout: BoardLayout = { terrain: board.map((col) => col.map((t) => t.terrain)), springs };
  if (sigils.length > 0) layout.sigils = sigils; // omit entirely when unused, keeping old saves byte-identical
  return layout;
}

/** The standard arena as an editable template. */
export function arenaLayout(): BoardLayout {
  return layoutFromBoard(makeArenaBoard());
}

/**
 * Ranked-eligibility checks (vault rules). Returns human-readable violations,
 * style-matched to validateDeck. An empty result = ranked-eligible; a custom
 * map with violations is still playable (casual).
 */
export function validateBoardLayout(layout: BoardLayout): string[] {
  const v: string[] = [];
  const shapeError = checkShape(layout);
  if (shapeError) return [shapeError]; // shape breaks every other check; report it alone

  const terrainAt = (c: Coord): Terrain => layout.terrain[c.col - 1]![c.row - 1]!;
  const springSet = new Set<string>();
  for (const c of layout.springs) {
    if (!inBounds(c)) {
      v.push(`spring (${c.col},${c.row}) out of bounds`);
      continue;
    }
    if (springSet.has(springKey(c))) v.push(`duplicate spring (${c.col},${c.row})`);
    springSet.add(springKey(c));
  }

  if (layout.springs.length % 2 !== 0) {
    v.push(`odd spring count (${layout.springs.length}) — springs come in symmetric pairs, never a lone tile`);
  }
  for (const c of layout.springs.filter(inBounds)) {
    const m = rowMirror(c);
    if (!springSet.has(springKey(m))) {
      v.push(`spring (${c.col},${c.row}) has no mirror at (${m.col},${m.row}) — springs must be symmetric across the center row`);
    }
    for (const start of LEADER_STARTS) {
      if ((c.col === start.col && c.row === start.row) || mooreAdjacent(start).some((n) => n.col === c.col && n.row === c.row)) {
        v.push(`spring (${c.col},${c.row}) is inside the leader summon ring at (${start.col},${start.row}) — a turn-1 free grab`);
      }
    }
    if (terrainAt(c) !== 'Normal') {
      v.push(`spring (${c.col},${c.row}) sits on ${terrainAt(c)} — spring tiles are neutral (Normal) by default`);
    }
    // "Never a monochrome favorable ring" — an all-Normal ring is neutral and fine.
    const ring = mooreAdjacent(c).map(terrainAt);
    if (ring.length > 0 && ring[0] !== 'Normal' && ring.every((t) => t === ring[0])) {
      v.push(`spring (${c.col},${c.row}) ring is all ${ring[0]} — spring-adjacent terrain must be mixed, never a monochrome ring`);
    }
  }

  for (let col = 1; col <= BOARD_SIZE; col++) {
    for (let row = 1; row <= Math.floor(BOARD_SIZE / 2); row++) {
      const a = { col, row };
      const b = rowMirror(a);
      if (terrainAt(a) !== terrainAt(b)) {
        v.push(`terrain (${a.col},${a.row}) ${terrainAt(a)} ≠ (${b.col},${b.row}) ${terrainAt(b)} — maps must mirror across the center row`);
      }
    }
  }

  // --- Sigil sanity ---
  const sigils = layout.sigils ?? [];
  const sigilAt = (c: Coord) => sigils.find((g) => sameCoord(g.at, c));
  for (const { at } of sigils.filter((g) => inBounds(g.at))) {
    // The vault's spring rule is load-bearing: spring tiles are neutral and their ring must be
    // mixed, so "first grab isn't first keep" holds. Marked ground around a spring makes it
    // uncontestable rather than merely hard to attack, which is a different game.
    if (springSet.has(springKey(at))) {
      v.push(`sigil (${at.col},${at.row}) sits on a spring — a spring must stay contestable`);
    }
    for (const n of orthAdjacent(at)) {
      if (springSet.has(springKey(n))) {
        v.push(`sigil (${at.col},${at.row}) is adjacent to the spring at (${n.col},${n.row}) — ringing a spring with marked ground makes it uncontestable`);
      }
    }
    if (terrainAt(at) === 'Wall') {
      v.push(`sigil (${at.col},${at.row}) is on a Wall — nothing can ever enter it, so it can never fire`);
    }
    const m = rowMirror(at);
    const twin = sigilAt(m);
    if (!twin) {
      v.push(`sigil (${at.col},${at.row}) has no mirror at (${m.col},${m.row}) — sigils must be symmetric across the center row`);
    } else if (!sameSpec(sigilAt(at)?.spec, twin.spec)) {
      v.push(`sigil (${at.col},${at.row}) and its mirror at (${m.col},${m.row}) carry different effects — mirrored sigils must match`);
    }
  }

  // --- Wall sanity: impassable terrain can wreck a map in ways nothing else can. ---
  for (const start of LEADER_STARTS) {
    if (terrainAt(start) === 'Wall') {
      v.push(`leader start (${start.col},${start.row}) is a Wall — the leader cannot stand there`);
    }
    const ring = mooreAdjacent(start).filter((c) => terrainAt(c) !== 'Wall');
    if (ring.length === 0) {
      v.push(`leader start (${start.col},${start.row}) is walled in — nothing can ever be summoned`);
    }
  }
  // The two sides must be able to reach each other over non-Wall tiles, or no game happens.
  const [a, b] = LEADER_STARTS;
  if (a && b && terrainAt(a) !== 'Wall' && terrainAt(b) !== 'Wall') {
    const seen = new Set([`${a.col},${a.row}`]);
    const queue: Coord[] = [a];
    while (queue.length > 0) {
      for (const n of orthAdjacent(queue.shift()!)) {
        const k = `${n.col},${n.row}`;
        if (seen.has(k) || terrainAt(n) === 'Wall') continue;
        seen.add(k);
        queue.push(n);
      }
    }
    if (!seen.has(`${b.col},${b.row}`)) {
      v.push('Walls seal the board — the two leader starts cannot reach each other, so no unit can ever engage');
    }
  }
  return v;
}
