/**
 * SPIKE — 3D board probe (throwaway, 2026-08-30).
 *
 * A dial box for the CSS-3D board tilt in styles/_spike3d.scss. It exists to
 * answer one question cheaply — does the DotR camera angle read at 7x7 with the
 * card art we have? — before anything is spent on three.js.
 *
 * Deliberately inert unless the URL carries `?spike3d`, matching the `?room=`
 * convention in App.tsx. No route, no setting, no persisted state anywhere the
 * normal app can reach: with the param absent this renders null and writes
 * nothing, so the shipping board is byte-identical to what it was.
 *
 * Styling is inline for the same reason — the panel borrows no token and no
 * class, so deleting this file leaves nothing behind.
 *
 * TO REVERT: delete this file, its mount in App.tsx, styles/_spike3d.scss, its
 * `@use` in styles/main.scss, and the `data-terrain` attribute in game/Board.tsx.
 */

import { useEffect, useState } from 'react';
import savedDefaults from './spike3d.defaults.json';
import { SpikeGL } from './SpikeGL';

/** Lower-case terrain names, matching both the generated filenames and `--tex-*`. */
const TERRAINS = [
  'normal', 'forest', 'mountain', 'sea', 'grassland', 'desert', 'shadow', 'sanctuary', 'wall',
] as const;

const KEY = 'terraforma.spike3d.v1';

/** The dials `row()` can render — the sliders, i.e. every dial but the checkboxes. */
type SliderKey = { [K in keyof Dials]: Dials[K] extends number ? K : never }[keyof Dials];

interface Dials {
  on: boolean;
  tilt: number;
  spin: number;
  persp: number;
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

// 42deg/1600px measured best: a hit-test sweep of all 49 tiles reaches every one
// of them, with the largest clickable area of the angles tried (78% of each
// tile's box, vs 67% at 30deg and 56% at 52deg). Relief starts at 0 because it is
// disqualified, not untried — see the note in _spike3d.scss.
/**
 * The dials everyone opens with, read from `spike3d.defaults.json`.
 *
 * In a file rather than a literal because the panel can write it: "lock in as
 * default" posts the current settings to the dev server, which replaces that JSON.
 * Settings otherwise live only in localStorage, where they are invisible to
 * everyone but the browser holding them — this is what makes a configuration
 * someone actually settled on reviewable, shareable and diffable.
 */
const DEFAULTS = savedDefaults as Dials;

function load(): Dials {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Dials>) } : DEFAULTS;
  } catch {
    return DEFAULTS; // a spike must never be the reason the app fails to boot
  }
}

export function Spike3D() {
  const enabled = new URLSearchParams(window.location.search).has('spike3d');
  const [d, setD] = useState<Dials>(load);
  const [locked, setLocked] = useState<string | null>(null);

  /**
   * Persist the current dials as the defaults, on disk.
   *
   * Dev-server only by design — the endpoint is a `apply: 'serve'` plugin, so a
   * production build simply has nowhere to write and says so rather than failing
   * silently.
   */
  async function lockIn() {
    try {
      const res = await fetch('/__spike3d/defaults', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(d),
      });
      setLocked(res.ok ? 'saved to spike3d.defaults.json' : `failed: ${await res.text()}`);
    } catch {
      setLocked('failed — needs the dev server');
    }
    window.setTimeout(() => setLocked(null), 4000);
  }

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.dataset.spike3d = d.on ? 'on' : 'off';
    root.style.setProperty('--spike-tilt', `${d.tilt}deg`);
    root.style.setProperty('--spike-spin', `${d.spin}deg`);
    root.style.setProperty('--spike-persp', `${d.persp}px`);
    root.style.setProperty('--spike-relief', `${d.relief}px`);
    // The gap compensation the stylesheet subtracts. Computed here because the
    // trig is the honest way to get it and CSS `cos()` is too new to lean on.
    const cos = Math.cos((d.tilt * Math.PI) / 180);
    root.style.setProperty('--spike-squash', String(1 - cos));

    // The dial is a MAGNIFICATION, not a raw translateZ, and the px are solved
    // back from it: under `perspective: P`, a plane at `translateZ(z)` projects
    // `P / (P - z)` times bigger, so `z = P * (1 - 1/zoom)` hits the requested
    // factor AT THE BOARD'S CENTRE (measured: 0.50 -> 0.50x, 2.00 -> 2.04x).
    //
    // The board's overall footprint grows faster than the dial says — 2.39x at a
    // dial of 2.00 — because the pitched board's near edge is closer to the camera
    // than its far edge and magnifies harder. That is what a dolly does; the dial
    // is the framing of the middle of the table, not of the whole silhouette.
    //
    // Solving back from a factor is also what decouples the two camera controls:
    // `zoom` sets the framing and `persp` then changes only the perspective
    // character, holding centre framing to within 3% across the whole 500-3000px
    // lens range. Driving translateZ directly would resize the board on every lens
    // change and make the pair unjudgeable.
    root.style.setProperty('--spike-dolly', `${d.persp * (1 - 1 / d.zoom)}px`);
    root.style.setProperty('--spike-grow', String((d.zoom - 1) * cos));

    root.style.setProperty('--spike-lean', String(d.lean / 100));
    root.style.setProperty('--spike-card', `${d.card}px`);
    root.style.setProperty('--spike-chrome', String(d.chrome / 100));

    // The CSS tiles read `--tex-<terrain>` rather than a literal url, so switching
    // style or resolution is nine assignments here instead of four parallel blocks
    // of nine rules in the stylesheet. `url()` cannot be composed from a custom
    // property, which is what forces the indirection.
    const dir = `/terrain/${d.photoreal ? 'photoreal' : 'stylised'}/${d.hires ? 1024 : 512}`;
    for (const t of TERRAINS) {
      // `-p` is the PRELIT map: the CSS board has no shader, so it needs the
      // composite the generator lights. The GL board takes the unlit albedo.
      root.style.setProperty(`--tex-${t}`, `url('${dir}/${t}-p.webp')`);
    }
    // The dial is texture STRENGTH; the stylesheet wants the complementary wash of
    // flat colour laid back over it, so 100% strength is a 0% fade.
    root.style.setProperty('--spike-tex-fade', `${100 - d.texture}%`);
    if (d.texture > 0) root.dataset.spikeTex = 'on';
    else delete root.dataset.spikeTex;
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* private mode — the dials just won't survive a reload */
    }
    return () => {
      delete root.dataset.spike3d;
      delete root.dataset.spikeTex;
    };
  }, [enabled, d]);

  // Hold the focused tile at the centre of the board.
  //
  // Two numbers do it, and both are pure layout arithmetic. The PAN is the vector
  // from the focused tile's centre to the board's centre, which the stylesheet
  // applies innermost so it slides the board in its own unrotated plane. The EYE
  // then parks on the board's centre, which is what makes the result exact rather
  // than approximate — the reasoning is written out over the transform in
  // _spike3d.scss.
  //
  // Read off LAYOUT (`offsetLeft/Top`), never `getBoundingClientRect`. The rect is
  // the PROJECTED position, which is a function of the pan we are computing — so
  // measuring it would chase its own tail and drift on every keypress. Layout
  // position does not move when the transform does, so this settles in one pass.
  // It is flip-safe for free too: seat 1 renders the grid in reversed order, and
  // the focused tile's layout box moves with it.
  //
  // `focusin` rather than the Board's own onFocusTile because it costs the spike
  // nothing in the component: clicking a tile ends in a real .focus() (Board.tsx
  // does this deliberately so the ring and the grid cursor agree), so both the
  // mouse and the arrow keys arrive here already.
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      delete root.dataset.spikeTrack;
      for (const v of ['--spike-pan-x', '--spike-pan-y', '--spike-eye-x', '--spike-eye-y']) {
        root.style.removeProperty(v);
      }
    };
    if (!enabled || !d.on || !d.follow) {
      clear();
      return;
    }
    root.dataset.spikeTrack = 'on';
    const aim = () => {
      const tile = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.tile');
      const board = document.querySelector<HTMLElement>('.board');
      const col = document.querySelector<HTMLElement>('.board-col');
      if (!tile || !board || !col || !col.offsetWidth || !col.offsetHeight) return; // focus left the board
      // ⚠ TWO coordinate spaces, and they are easy to mix up — the first cut of
      // this subtracted one from the other and put every tile 140px off centre.
      // `.board` carries a transform, and a transformed element becomes the
      // containing block for its descendants, so it is the tiles' offsetParent:
      // `tile.offsetLeft` is measured inside the BOARD, while `board.offsetLeft`
      // is measured inside the COLUMN.
      //
      // So the pan is computed entirely in board space (clientWidth is the board
      // inside its border, which is the origin tile offsets are measured from)...
      root.style.setProperty('--spike-pan-x', `${board.clientWidth / 2 - (tile.offsetLeft + tile.offsetWidth / 2)}px`);
      root.style.setProperty('--spike-pan-y', `${board.clientHeight / 2 - (tile.offsetTop + tile.offsetHeight / 2)}px`);
      // ...and the eye entirely in column space, which is what perspective-origin
      // resolves its percentages against.
      root.style.setProperty('--spike-eye-x', `${((board.offsetLeft + board.offsetWidth / 2) / col.offsetWidth) * 100}%`);
      root.style.setProperty('--spike-eye-y', `${((board.offsetTop + board.offsetHeight / 2) / col.offsetHeight) * 100}%`);
    };
    document.addEventListener('focusin', aim);
    aim();
    return () => {
      document.removeEventListener('focusin', aim);
      clear();
    };
  }, [enabled, d.on, d.follow]);

  if (!enabled) return null;

  const row = (
    label: string,
    key: SliderKey,
    min: number,
    max: number,
    step: number,
    unit: string,
    // Fractional steps land on 1.3500000000000003 without this.
    fmt: (n: number) => string = String,
  ) => (
    <label style={S.row}>
      <span style={S.label}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={d[key]}
        onChange={(e) => setD({ ...d, [key]: Number(e.target.value) })}
        style={S.range}
      />
      <span style={S.value}>
        {fmt(d[key])}
        {unit}
      </span>
    </label>
  );

  return (
    <div style={S.panel}>
      <div style={S.head}>
        <strong style={{ letterSpacing: '0.04em' }}>SPIKE · 3D board</strong>
        <label style={S.toggle}>
          <input type="checkbox" checked={d.on} onChange={(e) => setD({ ...d, on: e.target.checked })} />
          tilt
        </label>
      </div>
      {row('Pitch', 'tilt', 0, 72, 1, '°')}
      {row('Yaw', 'spin', -40, 40, 1, '°')}
      {row('Zoom', 'zoom', 0.4, 2.6, 0.05, '\u00d7', (n) => n.toFixed(2))}
      {row('Lens', 'persp', 500, 3000, 50, 'px')}
      {row('Relief', 'relief', 0, 20, 1, 'px')}
      {row('Lean', 'lean', 0, 100, 1, '%')}
      {row('Card lift', 'card', 0, 24, 1, 'px')}
      {row('Chrome', 'chrome', 20, 100, 1, '%')}
      {row('Texture', 'texture', 0, 100, 1, '%')}
      <label style={S.toggle}>
        <input type="checkbox" checked={d.follow} onChange={(e) => setD({ ...d, follow: e.target.checked })} />
        centre the focused tile
      </label>
      <label style={S.toggle}>
        <input
          type="checkbox"
          checked={d.gl}
          // Height is what the GL layer is FOR, so switching it on with the relief
          // dial at zero would show a flat slab and read as a failure. The dial
          // still drives both layers; this only refuses to start it at nothing.
          onChange={(e) => setD({ ...d, gl: e.target.checked, relief: e.target.checked && d.relief === 0 ? 9 : d.relief })}
        />
        WebGL terrain
      </label>
      <label style={S.toggle}>
        <input type="checkbox" checked={d.scenery} onChange={(e) => setD({ ...d, scenery: e.target.checked })} />
        terrain scenery
      </label>
      <label style={S.toggle}>
        <input type="checkbox" checked={d.photoreal} onChange={(e) => setD({ ...d, photoreal: e.target.checked })} />
        photoreal materials
      </label>
      <label style={S.toggle}>
        <input type="checkbox" checked={d.hires} onChange={(e) => setD({ ...d, hires: e.target.checked })} />
        1024px materials {d.hires ? '' : '(512)'}
      </label>
      <SpikeGL
        on={enabled && d.on && d.gl}
        props={d.scenery}
        style={d.photoreal ? 'photoreal' : 'stylised'}
        size={d.hires ? 1024 : 512}
      />
      <div style={S.buttons}>
        <button type="button" style={S.reset} onClick={() => setD(DEFAULTS)}>
          reset
        </button>
        {/* Dev only: the write endpoint is an `apply: 'serve'` Vite plugin, so a
            production build has nowhere to post and the button would be dead. */}
        {import.meta.env.DEV && (
          <button type="button" style={S.reset} onClick={lockIn} title="Write these dials to src/ui/spike3d.defaults.json">
            lock in as default
          </button>
        )}
      </div>
      {locked && <div style={S.note}>{locked}</div>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    left: 12,
    bottom: 12,
    zIndex: 9999,
    width: 232,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderRadius: 8,
    border: '1px solid #ffffff26',
    background: '#0b0c0fee',
    color: '#e8eaf0',
    font: '11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace',
    boxShadow: '0 8px 24px #0009',
  },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  toggle: { display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' },
  row: { display: 'grid', gridTemplateColumns: '3.2rem 1fr 2.6rem', alignItems: 'center', gap: 6 },
  label: { opacity: 0.7 },
  range: { width: '100%', accentColor: '#7aa2ff' },
  value: { textAlign: 'right', opacity: 0.85 },
  buttons: { display: 'flex', gap: 6, marginTop: 2 },
  note: { opacity: 0.75, fontSize: 10, lineHeight: 1.3 },
  reset: {
    flex: 1,
    padding: '3px 6px',
    borderRadius: 5,
    border: '1px solid #ffffff26',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  },
};
