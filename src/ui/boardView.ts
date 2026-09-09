/**
 * How the battlefield is drawn.
 *
 * Two modes share one settings object. `3d` pitches the board on a table, extrudes
 * the terrain in WebGL and stands the pieces up; `2d` is the flat board, and it is
 * the ORIGINAL flat board rather than a re-implementation of it — every 3D rule
 * hangs off `<html data-board3d="on">` (see styles/_board3d.scss), so Simple view
 * is what you get by writing nothing at all. That is what makes it the dependable
 * fallback for a machine that cannot spare the GPU, rather than a second rendering
 * path to keep in step.
 *
 * The dials are shared: switching to Simple and back does not lose a tuned camera.
 *
 * The defaults live in `boardView.defaults.json` rather than in a literal here,
 * because the tuner can write that file back through the dev server — so the camera
 * someone actually settled on ends up reviewable in a diff instead of trapped in
 * one browser's localStorage. See the plugin in vite.config.ts.
 */

import savedDefaults from './boardView.defaults.json';

export type BoardMode = '2d' | '3d';

export interface BoardView {
  /** `3d` pitches the board; `2d` is the flat board, untouched. */
  mode: BoardMode;
  /**
   * Multiplier on the board's tile size.
   *
   * Applies in BOTH modes, unlike every other dial here — it is a property of the board
   * rather than of the camera, and a player who wants bigger tiles wants them in Simple
   * view too. `--tile` keeps its responsive clamp and this scales the result, so the
   * board still answers to the viewport; this only moves where it sits in that range.
   */
  tile: number;
  /** Board pitch, in degrees — the camera angle. */
  tilt: number;
  /** Board yaw, in degrees. */
  spin: number;
  /** Perspective distance in px; lower is a wider lens. */
  persp: number;
  /** Terrain height in px per unit of `--board3d-h`. */
  relief: number;
  /** Camera distance, as a magnification: 1 = the framing the layout reserves. */
  zoom: number;
  /** 0 = pieces lie flat on the board, 100 = they stand fully upright. */
  lean: number;
  /** The piece's own relief, in px above its tile. */
  card: number;
  /** Hold whichever tile has focus at the centre of the board. */
  follow: boolean;
  /** Opacity of the rails and hand, which float above the board. */
  chrome: number;
  /** Terrain texture strength, 0 = flat colour, 100 = full material. */
  texture: number;
  /** Draw the WebGL terrain underneath the DOM board. */
  gl: boolean;
  /** Per-terrain scenery on top of the extruded tiles. */
  scenery: boolean;
  /** Use the photoreal material set rather than the stylised one. */
  photoreal: boolean;
  /** Albedo resolution of the material set: 512 or 1024. */
  hires: boolean;
}

/** Every dial but `mode` — what the tuner edits and what the dev server writes back. */
export type BoardDial = Exclude<keyof BoardView, 'mode'>;

/** The numeric dials, i.e. the ones the tuner renders as sliders. */
export type BoardSlider = { [K in BoardDial]: BoardView[K] extends number ? K : never }[BoardDial];

export const BOARD_VIEW_DEFAULTS: BoardView = savedDefaults as BoardView;

/** Lower-case terrain names, matching both the generated filenames and `--tex-*`. */
export const TERRAINS = [
  'normal', 'forest', 'mountain', 'sea', 'grassland', 'desert', 'shadow', 'sanctuary', 'wall',
] as const;

/**
 * Fill in a partial (or nonsense) saved view.
 *
 * Field by field rather than a spread, because a settings blob saved by an older
 * build is missing whole dials and a blob edited by hand can hold anything: a
 * single `NaN` here reaches CSS as `--board3d-tilt: NaNdeg`, which the parser drops,
 * leaving the board pitched by whatever the stylesheet's fallback happens to be
 * while the slider reads something else entirely.
 */
export function normalizeBoardView(saved: Partial<BoardView> | undefined): BoardView {
  const d = BOARD_VIEW_DEFAULTS;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    mode: saved?.mode === '2d' || saved?.mode === '3d' ? saved.mode : d.mode,
    tile: num(saved?.tile, d.tile),
    tilt: num(saved?.tilt, d.tilt),
    spin: num(saved?.spin, d.spin),
    persp: num(saved?.persp, d.persp),
    relief: num(saved?.relief, d.relief),
    zoom: num(saved?.zoom, d.zoom),
    lean: num(saved?.lean, d.lean),
    card: num(saved?.card, d.card),
    follow: bool(saved?.follow, d.follow),
    chrome: num(saved?.chrome, d.chrome),
    texture: num(saved?.texture, d.texture),
    gl: bool(saved?.gl, d.gl),
    scenery: bool(saved?.scenery, d.scenery),
    photoreal: bool(saved?.photoreal, d.photoreal),
    hires: bool(saved?.hires, d.hires),
  };
}

export interface SliderSpec {
  key: BoardSlider;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint: string;
  /** Fractional steps land on 1.3500000000000003 without this. */
  fmt?: (n: number) => string;
}

/**
 * The camera. Grouped apart from the detail dials below because these change the
 * SHAPE of the view and are the ones worth touching first.
 */
export const CAMERA_SLIDERS: SliderSpec[] = [
  { key: 'tilt', label: 'Pitch', min: 0, max: 72, step: 1, unit: '°', hint: 'How far the table is tilted away from you.' },
  { key: 'spin', label: 'Yaw', min: -40, max: 40, step: 1, unit: '°', hint: 'Rotate the table left or right.' },
  { key: 'zoom', label: 'Zoom', min: 0.4, max: 2.6, step: 0.05, unit: '×', hint: 'How close the camera sits. High is the immersive view — you see part of the board and the camera follows you to the rest. Turn Follow off first if you want the whole board at once.', fmt: (n) => n.toFixed(2) },
  { key: 'persp', label: 'Lens', min: 500, max: 3000, step: 50, unit: 'px', hint: 'Low is a wide, dramatic lens; high is nearly isometric.' },
];

/** What is drawn on the table, rather than where the camera is. */
export const DETAIL_SLIDERS: SliderSpec[] = [
  { key: 'tile', label: 'Tile size', min: 0.6, max: 2, step: 0.05, unit: '\u00d7', hint: 'Scales the whole board, in Simple view too. Room for about 1.3x on a 900px-tall laptop and 1.5x at 1080p; past that the board outgrows the layout and the far row is clipped away. Zoom is the cheaper way to get closer.', fmt: (n) => n.toFixed(2) },
  { key: 'relief', label: 'Relief', min: 0, max: 20, step: 1, unit: 'px', hint: 'How tall terrain stands. Needs the terrain layer to have side walls.' },
  { key: 'texture', label: 'Texture', min: 0, max: 100, step: 1, unit: '%', hint: '0 is flat terrain colour, 100 is the full material.' },
  { key: 'lean', label: 'Lean', min: 0, max: 100, step: 1, unit: '%', hint: '0 lays pieces flat like counters, 100 stands them up facing you.' },
  { key: 'card', label: 'Lift', min: 0, max: 24, step: 1, unit: 'px', hint: 'How far a piece floats above its tile.' },
  { key: 'chrome', label: 'Chrome', min: 20, max: 100, step: 1, unit: '%', hint: 'Opacity of the rails and hand, which float over the board.' },
];

export interface ToggleSpec {
  key: Exclude<BoardDial, BoardSlider>;
  label: string;
  hint: string;
}

/**
 * ⚠ Follow is what makes a close camera playable, so the two belong together: at a high
 * Zoom only part of the board is on screen, and Follow is how you reach the rest.
 * Turning it off at a high Zoom strands the far tiles.
 */
export const CAMERA_TOGGLES: ToggleSpec[] = [
  {
    key: 'follow',
    label: 'Follow the cursor',
    hint: 'Slide the board so the tile you are on stays at the centre. This is what lets a close camera reach the whole board — leave it on if Zoom is high.',
  },
];

/**
 * The cost dials. Every one of these can be turned off without leaving 3D, which is
 * the middle ground between the full table and the flat board: a machine that cannot
 * spare the GPU can drop the terrain layer and keep the camera.
 */
export const TERRAIN_TOGGLES: ToggleSpec[] = [
  { key: 'gl', label: 'Terrain layer', hint: 'Draws the ground in WebGL with real height and lighting. Off is cheapest.' },
  { key: 'scenery', label: 'Scenery', hint: 'Trees, peaks and rocks on top of the terrain.' },
  { key: 'photoreal', label: 'Photoreal materials', hint: 'Off uses the lighter stylised material set.' },
  { key: 'hires', label: '1024px materials', hint: 'Off loads the 512px set — a quarter of the texture memory.' },
];

/**
 * Apply a view to the document.
 *
 * Everything the stylesheet and the GL layer read is written here, in one place, so
 * there is exactly one translation from "what the player chose" to "what CSS sees".
 * Returns a teardown that puts the document back to the flat board.
 */
export function applyBoardView(view: BoardView): () => void {
  const root = document.documentElement;
  const on = view.mode === '3d';
  root.dataset['board3d'] = on ? 'on' : 'off';

  // Outside the `on` check on purpose: the tile scale is the one dial that applies to the
  // flat board as well. _game.scss multiplies `--tile`'s own responsive clamp by it.
  root.style.setProperty('--tile-scale', String(view.tile));

  root.style.setProperty('--board3d-tilt', `${view.tilt}deg`);
  root.style.setProperty('--board3d-spin', `${view.spin}deg`);
  root.style.setProperty('--board3d-persp', `${view.persp}px`);
  root.style.setProperty('--board3d-relief', `${view.relief}px`);
  // The gap compensation the stylesheet subtracts. Computed here because the trig
  // is the honest way to get it and CSS `cos()` is too new to lean on.
  const cos = Math.cos((view.tilt * Math.PI) / 180);
  root.style.setProperty('--board3d-squash', String(1 - cos));

  // The dial is a MAGNIFICATION, not a raw translateZ, and the px are solved back
  // from it: under `perspective: P`, a plane at `translateZ(z)` projects `P / (P - z)`
  // times bigger, so `z = P * (1 - 1/zoom)` hits the requested factor AT THE BOARD'S
  // CENTRE (measured: 0.50 -> 0.50x, 2.00 -> 2.04x).
  //
  // The board's overall footprint grows faster than the dial says — 2.39x at a dial
  // of 2.00 — because the pitched board's near edge is closer to the camera than its
  // far edge and magnifies harder. That is what a dolly does; the dial is the framing
  // of the middle of the table, not of the whole silhouette.
  //
  // Solving back from a factor is also what decouples the two camera controls: `zoom`
  // sets the framing and `persp` then changes only the perspective character, holding
  // centre framing to within 3% across the whole 500-3000px lens range. Driving
  // translateZ directly would resize the board on every lens change and make the pair
  // unjudgeable.
  root.style.setProperty('--board3d-dolly', `${view.persp * (1 - 1 / view.zoom)}px`);
  root.style.setProperty('--board3d-grow', String((view.zoom - 1) * cos));

  root.style.setProperty('--board3d-lean', String(view.lean / 100));
  root.style.setProperty('--board3d-card', `${view.card}px`);
  root.style.setProperty('--board3d-chrome', String(view.chrome / 100));

  // The CSS tiles read `--tex-<terrain>` rather than a literal url, so switching
  // style or resolution is nine assignments here instead of four parallel blocks of
  // nine rules in the stylesheet. `url()` cannot be composed from a custom property,
  // which is what forces the indirection.
  const dir = `/terrain/${view.photoreal ? 'photoreal' : 'stylised'}/${view.hires ? 1024 : 512}`;
  for (const t of TERRAINS) {
    // `-p` is the PRELIT map: the CSS board has no shader, so it needs the composite
    // the generator lights. The GL board takes the unlit albedo.
    root.style.setProperty(`--tex-${t}`, `url('${dir}/${t}-p.webp')`);
  }
  // The dial is texture STRENGTH; the stylesheet wants the complementary wash of flat
  // colour laid back over it, so 100% strength is a 0% fade.
  root.style.setProperty('--board3d-tex-fade', `${100 - view.texture}%`);
  if (on && view.texture > 0) root.dataset['board3dTex'] = 'on';
  else delete root.dataset['board3dTex'];

  return () => {
    delete root.dataset['board3d'];
    delete root.dataset['board3dTex'];
    root.style.removeProperty('--tile-scale');
  };
}
