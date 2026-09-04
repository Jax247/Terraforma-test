/**
 * SPIKE — the WebGL terrain layer for the hybrid board.
 *
 * The split: WebGL draws the GROUND — extruded tiles with real height, side
 * walls, lighting, and a little per-terrain scenery. The existing DOM board keeps
 * everything else, unchanged: pieces, text, status badges, hit-testing, the
 * roving tabindex and aria labels. Neither half knows much about the other.
 *
 * Raw WebGL2, no library. That is deliberate — 49 extruded tiles and one light do
 * not need three.js, and the whole layer costs a couple of KB gzipped, which is
 * the answer to "wouldn't the hybrid drag in a 150 KB dependency".
 *
 * ── The projection ────────────────────────────────────────────────────────────
 * Everything rests on CSS `perspective: P` being the SAME projection as a camera
 * at distance P from the z=0 plane with `fov = 2·atan(H / 2P)`, in a world
 * measured in CSS pixels with Y flipped. Measured across pitch 20-65°, yaw ±22°,
 * zoom 0.5-2.2x, lens 600-3000px and a full-corner pan, the two agree to under a
 * pixel (0.03px at the default camera). `window.__spikeGL.verify()` re-runs that.
 *
 * ⚠ The equivalence needs the perspective origin at the CENTRE of the viewport,
 * because a plain perspective camera is on-axis. So the canvas sizes and
 * positions itself around O rather than around the board. An off-centre
 * `perspective-origin` is a SHEARED frustum — `camera.setViewOffset` territory.
 *
 * ── Height ────────────────────────────────────────────────────────────────────
 * Heights come from `--spike-h` times `--spike-relief-used`, both read per tile
 * off the live stylesheet. That is on purpose: the DOM tiles are lifted by the
 * very same expression, so the two layers cannot disagree about how tall a tile
 * is without someone editing one number in one place. The relief is per tile
 * rather than global because a terrain may opt out of the dial — Wall does.
 *
 * TO REVERT: delete this file and its mount in Spike3D.tsx.
 */

import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Column-major 4x4, GL storage order: m[col * 4 + row].
// ---------------------------------------------------------------------------

type M4 = Float32Array;

function ident(): M4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** a · b, applied to a column vector as a(b(v)). */
function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
    }
  }
  return o;
}

function translation(x: number, y: number, z: number): M4 {
  const m = ident();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/**
 * The element's CURRENT transform, straight off computed style.
 *
 * Read rather than reconstructed, and that is the whole fix for the board and the
 * terrain drifting apart while you navigate. The dials (`--spike-pan-x` and
 * friends) jump to their target the instant focus moves, but the DOM board eases
 * to it over 260ms — so a camera rebuilt from the dials snapped to the end state
 * and the terrain visibly detached from the tiles for the length of every glide.
 * Computed style returns the INTERPOLATED matrix mid-transition, so reading it
 * keeps the two in lockstep for free.
 *
 * It also retires the standing "two coordinate systems to keep in sync" tax:
 * there is now one transform, authored in CSS, and the GL layer is a reader.
 *
 * CSS serialises `matrix3d()` column-major, which is the storage this file uses,
 * so the 16 numbers drop straight in. A 2D `matrix()` is widened by hand.
 */
function cssMatrix(el: HTMLElement): M4 {
  const t = getComputedStyle(el).transform;
  const m = ident();
  if (!t || t === 'none') return m;
  // ⚠ Parse INSIDE the parentheses. Scanning the whole string for numbers picks
  // up the "3" in `matrix3d` as the first value, which shifts every component by
  // one, fails the length check, and silently leaves an identity matrix — the
  // board renders untransformed and the terrain sits hundreds of px from the
  // tiles at a constant offset.
  const n = t.slice(t.indexOf('(') + 1, t.lastIndexOf(')')).split(',').map(Number);
  if (n.some((v) => !Number.isFinite(v))) return m;
  if (n.length === 16) {
    for (let i = 0; i < 16; i++) m[i] = n[i]!;
  } else if (n.length === 6) {
    m[0] = n[0]!;
    m[1] = n[1]!;
    m[4] = n[2]!;
    m[5] = n[3]!;
    m[12] = n[4]!;
    m[13] = n[5]!;
  }
  return m;
}

/** diag(1, -1, 1, 1) — CSS's y-down basis into a y-up world, and its own inverse. */
function flipY(): M4 {
  const m = ident();
  m[5] = -1;
  return m;
}

function perspective(fovY: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function apply(m: M4, x: number, y: number, z: number): [number, number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    m[3]! * x + m[7]! * y + m[11]! * z + m[15]!,
  ];
}

// ---------------------------------------------------------------------------
// Colour + noise helpers
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function shade(c: RGB, f: number): RGB {
  return [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];
}

/** Deterministic per-tile RNG: the same tile must grow the same trees every frame. */
function rngFor(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Geometry
//
// One interleaved buffer of position + colour, non-indexed. Lighting is baked
// into the vertex colour on the CPU rather than done in a shader: the light is
// fixed relative to the BOARD (a lamp over the table, not over the room), so the
// shading only changes when the terrain does — never when the camera moves. That
// keeps the shader trivial and makes camera motion a uniform update and nothing
// else.
// ---------------------------------------------------------------------------

/** Board-local, y-up, +z out of the table. Roughly over the player's left shoulder. */
const LIGHT: [number, number, number] = (() => {
  const v: [number, number, number] = [-0.30, -0.50, 0.81];
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
})();

const AMBIENT = 0.42;

class Mesh {
  readonly data: number[] = [];
  /**
   * Which terrain material the faces being emitted right now are made of, as an
   * index into the texture array. -1 = untextured, which is what the scenery uses.
   *
   * Carried as mesh state rather than threaded through every call because a tile
   * emits ten faces and a tree emits sixteen, and passing the same layer down all
   * of them would be noise at every call site.
   */
  layer = -1;

  /** One triangle. The face normal comes from the winding, so order matters. */
  tri(a: number[], b: number[], c: number[], color: RGB, uv?: [number, number][]): void {
    const ux = b[0]! - a[0]!;
    const uy = b[1]! - a[1]!;
    const uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!;
    const vy = c[1]! - a[1]!;
    const vz = c[2]! - a[2]!;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const k = AMBIENT + (1 - AMBIENT) * lambert;
    const lit: RGB = [color[0] * k, color[1] * k, color[2] * k];
    const pts = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const p = pts[i]!;
      const t = uv?.[i] ?? [0, 0];
      this.data.push(p[0]!, p[1]!, p[2]!, lit[0], lit[1], lit[2], t[0]!, t[1]!, uv ? this.layer : -1);
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], color: RGB, textured = false): void {
    // Corner UVs run 0..1 across the face, so one tile shows exactly one tile of
    // the material — the textures are authored to be seamless, so neighbours meet
    // without a visible repeat.
    const uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.tri(a, b, c, color, textured ? [uv[0]!, uv[1]!, uv[2]!] : undefined);
    this.tri(a, c, d, color, textured ? [uv[0]!, uv[2]!, uv[3]!] : undefined);
  }

  /**
   * An axis-aligned block. The bottom face is never emitted — nothing can see
   * under the board, and at 49 tiles that is a fifth of the terrain triangles.
   */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, top: RGB, side: RGB, textured = false): void {
    // Only the TOP face takes the material. A side wall is a few pixels tall and
    // mostly in shadow, and a vertically stretched sheet of grass or dune looked
    // markedly worse there than the flat lit colour does.
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], top, textured);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], side); // south (toward camera)
    this.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], side); // north
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], side); // east
    this.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], side); // west
  }

  /** A tapering stack — the workhorse for trees, peaks, pillars and spires. */
  spire(cx: number, cy: number, rBase: number, rTop: number, z0: number, z1: number, sides: number, color: RGB): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const b0 = [cx + Math.cos(a0) * rBase, cy + Math.sin(a0) * rBase, z0];
      const b1 = [cx + Math.cos(a1) * rBase, cy + Math.sin(a1) * rBase, z0];
      if (rTop < 0.01) {
        this.tri(b0, b1, [cx, cy, z1], color);
      } else {
        const t0 = [cx + Math.cos(a0) * rTop, cy + Math.sin(a0) * rTop, z1];
        const t1 = [cx + Math.cos(a1) * rTop, cy + Math.sin(a1) * rTop, z1];
        this.quad(b0, b1, t1, t0, color);
        this.tri(t0, t1, [cx, cy, z1], color);
      }
    }
  }
}

/** What a prop generator gets: the tile's top surface and a stable random source. */
interface Plot {
  mesh: Mesh;
  cx: number;
  cy: number;
  /** Half-width of the tile, in px. Everything is sized off this. */
  half: number;
  /** Height of the tile's top face — props stand on it. */
  top: number;
  base: RGB;
  rand: () => number;
}

/**
 * Terrain personality.
 *
 * Each terrain gets a silhouette you could recognise with the colour turned off,
 * which is the whole point of moving terrain into geometry: on the flat board
 * Forest and Grassland are two greens, and here one has trees on it.
 *
 * Sizes are all fractions of the tile, so this survives any board scale.
 */
const PROPS: Record<string, (p: Plot) => void> = {
  Forest: ({ mesh, cx, cy, half, top, base, rand }) => {
    const trunk = shade(base, 0.4);
    const canopy = mix(shade(base, 0.85), [0.09, 0.22, 0.10], 0.35);
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * half * 1.35;
      const y = cy + (rand() - 0.5) * half * 1.35;
      const h = half * (0.7 + rand() * 0.45);
      const r = half * (0.2 + rand() * 0.1);
      mesh.spire(x, y, half * 0.055, half * 0.045, top, top + h * 0.4, 4, trunk);
      mesh.spire(x, y, r, 0, top + h * 0.28, top + h, 6, mix(canopy, base, rand() * 0.25));
    }
  },

  Mountain: ({ mesh, cx, cy, half, top, base, rand }) => {
    const rock = shade(base, 0.9);
    const snow = mix(base, [1, 1, 1], 0.75);
    const peaks = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < peaks; i++) {
      const x = cx + (rand() - 0.5) * half * (peaks > 1 ? 1.0 : 0.35);
      const y = cy + (rand() - 0.5) * half * (peaks > 1 ? 1.0 : 0.35);
      const h = half * (1.15 + rand() * 0.7) / peaks ** 0.4;
      const r = half * (0.5 + rand() * 0.2) / peaks ** 0.5;
      mesh.spire(x, y, r, r * 0.18, top, top + h * 0.72, 5, rock);
      mesh.spire(x, y, r * 0.2, 0, top + h * 0.72, top + h, 5, snow); // a cap, for the silhouette
    }
  },

  // ⚠ Sea and Desert deliberately have NO entry here.
  //
  // Both used to subdivide the tile's top face into a grid of flat-shaded quads —
  // a wave surface and a dune surface — from back when the terrain carried no
  // material at all. Scenery is untextured by design, so those quads sat ON TOP
  // of the textured face and hid it completely: the sea rendered as three coarse
  // blocks of flat blue and did not respond to the Texture dial at all, because
  // the pixels being drawn were geometry rather than material.
  //
  // The material does that job now, and does it better — the generator's height
  // field shapes the swell and the dunes, and the surface map carries that relief
  // into the shader as real per-pixel normals. Geometry for it as well only
  // occludes the thing it was imitating.

  Grassland: ({ mesh, cx, cy, half, top, base, rand }) => {
    const tuft = mix(shade(base, 0.8), [0.35, 0.5, 0.18], 0.4);
    for (let i = 0; i < 7; i++) {
      const x = cx + (rand() - 0.5) * half * 1.6;
      const y = cy + (rand() - 0.5) * half * 1.6;
      mesh.spire(x, y, half * 0.07, 0, top, top + half * (0.12 + rand() * 0.1), 3, tuft);
    }
  },

  Shadow: ({ mesh, cx, cy, half, top, base, rand }) => {
    // Shards, not growth. Nothing here should read as alive.
    const shard = shade(base, 0.55);
    for (let i = 0; i < 3; i++) {
      const x = cx + (rand() - 0.5) * half * 1.2;
      const y = cy + (rand() - 0.5) * half * 1.2;
      mesh.spire(x, y, half * (0.1 + rand() * 0.08), 0, top, top + half * (0.3 + rand() * 0.35), 4, shard);
    }
  },

  Sanctuary: ({ mesh, cx, cy, half, top, base }) => {
    // The only terrain built rather than grown: four pillars and a dais.
    const stone = shade(base, 0.86);
    const dais = shade(base, 0.95);
    mesh.box(cx - half * 0.5, cx + half * 0.5, cy - half * 0.5, cy + half * 0.5, top, top + half * 0.07, dais, shade(base, 0.7));
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const px = cx + sx * half * 0.62;
      const py = cy + sy * half * 0.62;
      mesh.spire(px, py, half * 0.1, half * 0.09, top, top + half * 0.42, 6, stone);
      mesh.spire(px, py, half * 0.13, half * 0.1, top + half * 0.42, top + half * 0.5, 6, mix(stone, [1, 1, 1], 0.2));
    }
  },

  Wall: ({ mesh, cx, cy, half, top, base }) => {
    // Crenellations, so a Wall reads as impassable from across the board.
    const merlon = shade(base, 1.25);
    const step = (half * 2) / 5;
    for (let i = 0; i < 5; i++) {
      if (i % 2 === 1) continue;
      const x0 = cx - half + i * step;
      mesh.box(x0 + step * 0.1, x0 + step * 0.9, cy - half * 0.85, cy + half * 0.85, top, top + half * 0.28, merlon, shade(base, 0.9));
    }
  },
};

// ---------------------------------------------------------------------------

const VS = `#version 300 es
in vec3 aPos;
in vec3 aColor;
in vec2 aUV;
in float aLayer;
uniform mat4 uMVP;
// ⚠ Explicit precision on everything the FRAGMENT shader also declares. A vertex
// shader defaults float to highp and the fragment below asks for mediump, so an
// unqualified shared uniform or varying fails to LINK — "precisions of uniform
// 'uModel' differ" — and the whole layer silently never mounts.
uniform highp mat4 uModel;
out vec3 vColor;
out vec2 vUV;
out highp vec3 vWorld;
flat out float vLayer;
void main() {
  vColor = aColor;
  vUV = aUV;
  // World position, for the view vector the specular needs. The camera moves, so
  // the highlight has to move with it — that is the one thing baked light cannot
  // do, and the reason the surface maps exist at all.
  vWorld = (uModel * vec4(aPos, 1.0)).xyz;
  vLayer = aLayer;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

// A negative layer means "no material" — the scenery (trees, peaks, crenellations)
// is lit vertex colour and nothing else.
//
// Terrain faces are LIT HERE rather than sampled pre-lit. The albedo map carries
// colour only; the surface map carries the normal, the occlusion (ambient plus the
// baked cast shadow) and the roughness. That buys two things a pre-lit texture
// cannot: highlights that track the camera as it dollies and yaws, and a single
// light direction shared with the geometry instead of two that can drift apart.
const FS = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;
in vec3 vColor;
in vec2 vUV;
in highp vec3 vWorld;
flat in float vLayer;
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uSurface;
uniform float uTexStrength;
uniform float uHasSurface;
uniform highp mat4 uModel;
uniform vec3 uLight;
uniform highp float uEyeZ;
out vec4 outColor;
void main() {
  vec3 c = vColor;
  if (vLayer >= 0.0 && uTexStrength > 0.0) {
    vec3 alb = texture(uAlbedo, vec3(vUV, vLayer)).rgb;
    vec3 lit = alb;
    if (uHasSurface > 0.5) {
      vec4 srf = texture(uSurface, vec3(vUV, vLayer));
      // Tangent space IS board space for an upward face: the tile's u runs along
      // +x and its v along +y, so the map's channels need no swizzle or flip.
      vec3 nT = vec3(srf.rg * 2.0 - 1.0, 0.0);
      nT.z = sqrt(max(0.0001, 1.0 - dot(nT.xy, nT.xy)));
      mat3 rot = mat3(uModel);
      vec3 n = normalize(rot * nT);
      vec3 l = normalize(rot * uLight);
      vec3 view = normalize(vec3(0.0, 0.0, uEyeZ) - vWorld);
      float occ = srf.b;
      float rough = srf.a;
      float lam = max(0.0, dot(n, l));
      float shininess = mix(96.0, 6.0, rough);
      float spec = pow(max(0.0, dot(n, normalize(l + view))), shininess) * (1.0 - rough) * 0.6;
      lit = alb * (0.34 + 0.66 * lam) * occ + vec3(spec) * occ;
    }
    // Mixed against the flat terrain colour, so the strength dial runs from the
    // plain board to full material exactly as it does on the CSS tiles.
    c = mix(c, lit, uTexStrength);
  }
  outColor = vec4(c, 1.0);
}`;

function compile(gl: WebGL2RenderingContext): WebGLProgram | null {
  const mk = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[spikeGL]', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  const vs = mk(gl.VERTEX_SHADER, VS);
  const fs = mk(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('[spikeGL]', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

/** One tile, in the terms the mesh builder needs. */
interface TileInfo {
  label: string;
  terrain: string;
  /** Footprint in board-local CSS coords, relative to the board's transform-origin. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Top face height, in px above the board plane. Negative for sunken terrain. */
  height: number;
  base: RGB;
}

function readTiles(board: HTMLElement): TileInfo[] {
  const cs = getComputedStyle(board);
  const borderL = Number.parseFloat(cs.borderLeftWidth) || 0;
  const borderT = Number.parseFloat(cs.borderTopWidth) || 0;
  // transform-origin is 50% 50% of the BORDER box; tile offsets are measured from
  // the padding edge, hence the border terms. (`.board` is the tiles' offsetParent
  // because it carries a transform — see the note in Spike3D.tsx.)
  const ox = board.offsetWidth / 2;
  const oy = board.offsetHeight / 2;
  const rootStyle = getComputedStyle(document.documentElement);
  const out: TileInfo[] = [];
  for (const t of Array.from(board.querySelectorAll<HTMLElement>('.tile'))) {
    const terrain = t.getAttribute('data-terrain') ?? 'Normal';
    // ⚠ NOT the tile's own background — the stylesheet blanks that so the canvas
    // can show through, so reading it back gives black terrain on a dark page and
    // looks exactly like a renderer that never ran. Take the terrain token, which
    // `applyTerrainTokens` publishes on :root as a resolved hex.
    const hex = rootStyle.getPropertyValue(`--terrain-${terrain.toLowerCase()}`).trim() || '#808080';
    // The SAME expression the DOM tile is lifted by, read off the same two custom
    // properties — one number, one place, so the layers cannot drift apart.
    //
    // `--spike-relief-used` is per TILE, not global: a terrain may opt out of the
    // relief dial, and Wall does — it is pinned to the top of the range so it
    // always reads as impassable. Reading the global `--spike-relief` here would
    // put the GL geometry a long way under the DOM tile on every wall.
    const tileStyle = getComputedStyle(t);
    const h = Number.parseFloat(tileStyle.getPropertyValue('--spike-h')) || 0;
    const relief = Number.parseFloat(tileStyle.getPropertyValue('--spike-relief-used')) || 0;
    out.push({
      label: t.getAttribute('aria-label')?.split(',').slice(0, 2).join(',') ?? '?',
      terrain,
      x0: t.offsetLeft + borderL - ox,
      y0: t.offsetTop + borderT - oy,
      x1: t.offsetLeft + borderL - ox + t.offsetWidth,
      y1: t.offsetTop + borderT - oy + t.offsetHeight,
      height: h * relief,
      base: hexToRgb(hex),
    });
  }
  return out;
}

/** How deep the terrain slab runs below the board plane. Only its walls are seen. */
const SLAB = 26;

/**
 * Layer order of the terrain texture array. One list, read by both the uploader
 * and the mesh builder, so a face can never end up wearing another terrain's
 * material.
 */
const TERRAIN_LAYERS = [
  'Normal', 'Forest', 'Mountain', 'Sea', 'Grassland', 'Desert', 'Shadow', 'Sanctuary', 'Wall',
] as const;
/** The board-local sun, shared with the generator's `LIGHT` — one direction, one place. */
const SUN = LIGHT;

/** Ceiling on the drawing buffer, in device pixels. ~8M is a 4K-ish surface. */
const MAX_BUFFER_PX = 8e6;

function buildMesh(tiles: TileInfo[], props: boolean): Float32Array {
  const mesh = new Mesh();
  let floor = 0;
  for (const t of tiles) floor = Math.min(floor, t.height);
  const bottom = floor - SLAB;

  for (const t of tiles) {
    // CSS y runs down, the world runs up, so the tile's top edge becomes its
    // larger world y. Tiles are NOT inset: the terrain wants to be continuous,
    // and the DOM tile's own edge ring is already drawing the grid over the top.
    const wx0 = t.x0;
    const wx1 = t.x1;
    const wy0 = -t.y1;
    const wy1 = -t.y0;
    const top = shade(t.base, 1);
    // Walls a touch darker than the top even before lighting: real ground has
    // less light reaching a vertical face, and the extra step makes a one-tile
    // rise legible from across the board.
    const side = shade(t.base, 0.72);
    mesh.layer = TERRAIN_LAYERS.indexOf(t.terrain as (typeof TERRAIN_LAYERS)[number]);
    mesh.box(wx0, wx1, wy0, wy1, bottom, t.height, top, side, mesh.layer >= 0);

    // Scenery is lit geometry, not material — back to untextured before it emits.
    mesh.layer = -1;
    const gen = props ? PROPS[t.terrain] : undefined;
    if (!gen) continue;
    const [c, r] = t.label.split(',').map(Number);
    gen({
      mesh,
      cx: (wx0 + wx1) / 2,
      cy: (wy0 + wy1) / 2,
      half: (wx1 - wx0) / 2,
      top: t.height,
      base: t.base,
      rand: rngFor((c ?? 0) * 31 + (r ?? 0) * 7919),
    });
  }
  return new Float32Array(mesh.data);
}

/**
 * The lens, read back off the live styles. Not the transform — that comes from
 * `cssMatrix` — just the perspective the column establishes and where the board
 * sits inside it.
 */
function readCamera(board: HTMLElement, col: HTMLElement) {
  const colCS = getComputedStyle(col);
  // Both compute to px, so no percentage maths is needed. `perspective-origin`
  // is mid-transition too when the eye is moving, which is what we want.
  const [ox, oy] = colCS.perspectiveOrigin.match(/[-\d.]+/g)?.map(Number) ?? [0, 0];
  return {
    P: Number.parseFloat(colCS.perspective) || 1600,
    Ox: ox ?? 0,
    Oy: oy ?? 0,
    originX: board.offsetLeft + board.offsetWidth / 2,
    originY: board.offsetTop + board.offsetHeight / 2,
  };
}

export function SpikeGL({
  on,
  props,
  style,
  size,
}: {
  on: boolean;
  props: boolean;
  /** Which generated material set to load — see scripts/genTerrainTex.ts. */
  style: string;
  /** Albedo resolution; the surface maps are always half of it. */
  size: number;
}) {
  /**
   * The board element this layer is attached to, tracked as state.
   *
   * ⚠ Not a one-shot `querySelector`. This component mounts with the app, not
   * with the game, and the dial is remembered — so on a reload with the layer
   * already switched on, the setup screen is what is on screen and there is no
   * `.board` to attach to. Bailing out there used to be permanent: the deps were
   * `[on, props]`, neither of which changes when the game finally starts, so the
   * checkbox read as on while nothing rendered until you toggled it off and back.
   *
   * Holding the element in state makes its ARRIVAL a dependency. It also covers
   * the board being REPLACED — New game returns to setup and builds a fresh
   * board, and re-running on identity means the canvas follows it instead of
   * being orphaned inside a detached column.
   */
  const [boardEl, setBoardEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!on) return;
    // Cheap by construction: the callback is a querySelector and an identity
    // compare, and it only ever calls setState when the board element actually
    // changes — not on the DOM churn of every unit that moves.
    const sync = () =>
      setBoardEl((prev) => {
        const next = document.querySelector<HTMLElement>('.board');
        return next === prev ? prev : next;
      });
    sync();
    const watch = new MutationObserver(sync);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
      setBoardEl(null);
    };
  }, [on]);

  useEffect(() => {
    if (!on || !boardEl) return;
    const board = boardEl;
    const col = board.closest<HTMLElement>('.board-col');
    if (!col) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'spike-gl';
    canvas.setAttribute('aria-hidden', 'true');
    col.insertBefore(canvas, col.firstChild);
    // `.board` paints its own opaque `--surface-sunken` over the canvas behind it,
    // which is what hid the first run of this layer entirely. The stylesheet drops
    // it while the GL layer owns the terrain.
    document.documentElement.dataset.spikeGl = 'on';

    // `preserveDrawingBuffer` is for `coverage()` only — without it the buffer is
    // gone by the time readPixels runs and the probe reports a false negative.
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: true, preserveDrawingBuffer: true });
    if (!gl) {
      console.error('[spikeGL] no webgl2');
      canvas.remove();
      delete document.documentElement.dataset.spikeGl;
      return;
    }
    const prog = compile(gl);
    if (!prog) {
      canvas.remove();
      delete document.documentElement.dataset.spikeGl;
      return;
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    const uMVP = gl.getUniformLocation(prog, 'uMVP');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const stride = 36; // pos(3) + colour(3) + uv(2) + layer(1), all floats
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aCol = gl.getAttribLocation(prog, 'aColor');
    const aUV = gl.getAttribLocation(prog, 'aUV');
    const aLayer = gl.getAttribLocation(prog, 'aLayer');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aCol);
    gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(aLayer);
    gl.vertexAttribPointer(aLayer, 1, gl.FLOAT, false, stride, 32);

    // ---- the terrain materials, as a texture ARRAY ---------------------------
    // An array rather than an atlas: nine independent 512px layers cannot bleed
    // into each other at low mip levels the way atlas cells do, and each gets its
    // own mip chain. Mips matter here — a pitched board without them shimmers
    // badly on the tiles furthest from the camera.
    const uAlbedo = gl.getUniformLocation(prog, 'uAlbedo');
    const uSurface = gl.getUniformLocation(prog, 'uSurface');
    const uTexStrength = gl.getUniformLocation(prog, 'uTexStrength');
    const uHasSurface = gl.getUniformLocation(prog, 'uHasSurface');
    const uModel = gl.getUniformLocation(prog, 'uModel');
    const uLight = gl.getUniformLocation(prog, 'uLight');
    const uEyeZ = gl.getUniformLocation(prog, 'uEyeZ');

    // Colour at full resolution, surface (normal / occlusion / roughness) at half.
    const albedoTex = gl.createTexture();
    const surfaceTex = gl.createTexture();
    // ⚠ Neither gets a placeholder allocation: `texStorage3D` is IMMUTABLE and may
    // only be called once per texture, so a 1x1 stand-in makes the real upload fail
    // silently. Until the images land, `uTexStrength` is held at 0. It is also why
    // changing style or resolution tears this whole effect down and rebuilds it
    // rather than re-uploading into the arrays that already exist.
    let texReady = false;
    let surfaceReady = false;
    let cancelled = false;
    // Overridable so the light can be moved from the console. Half a debug hook
    // and half the proof that the terrain is relit rather than pre-lit: if moving
    // it changes the pixels, the normal map is doing the work.
    let sun: [number, number, number] = [SUN[0], SUN[1], SUN[2]];

    async function loadArray(target: WebGLTexture | null, suffix: string, dim: number): Promise<boolean> {
      const bitmaps = await Promise.all(
        TERRAIN_LAYERS.map(async (name) => {
          const r = await fetch(`/terrain/${style}/${size}/${name.toLowerCase()}${suffix}.webp`);
          if (!r.ok) throw new Error(`${r.status} on ${r.url}`);
          // ⚠ `premultiplyAlpha: 'none'` is essential, not tidiness. The surface
          // map keeps ROUGHNESS in alpha, so a premultiplied decode multiplies the
          // normal and occlusion channels by it — and the default is premultiplied.
          // Water has roughness 0.10, so its occlusion was being crushed to a tenth
          // and it rendered almost black while rock at roughness 0.9 looked fine.
          // That is why only the sea appeared broken.
          return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none' });
        }),
      );
      if (cancelled) {
        for (const b of bitmaps) b.close();
        return false;
      }
      gl!.bindTexture(gl!.TEXTURE_2D_ARRAY, target);
      // Belt and braces alongside the decode hint above.
      gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const levels = Math.floor(Math.log2(dim)) + 1;
      gl!.texStorage3D(gl!.TEXTURE_2D_ARRAY, levels, gl!.RGBA8, dim, dim, TERRAIN_LAYERS.length);
      bitmaps.forEach((bmp, i) => {
        gl!.texSubImage3D(gl!.TEXTURE_2D_ARRAY, 0, 0, 0, i, dim, dim, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, bmp);
        bmp.close();
      });
      gl!.generateMipmap(gl!.TEXTURE_2D_ARRAY);
      gl!.texParameteri(gl!.TEXTURE_2D_ARRAY, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR_MIPMAP_LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D_ARRAY, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      return true;
    }

    void (async () => {
      try {
        texReady = await loadArray(albedoTex, '', size);
        draw();
      } catch (err) {
        console.error('[spikeGL] terrain albedo failed to load', err);
        return;
      }
      try {
        // Second, so the board shows material the moment colour arrives rather
        // than waiting on both. Half resolution: normals and occlusion are
        // low-frequency and tolerate it far better than colour does.
        surfaceReady = await loadArray(surfaceTex, '-s', size >> 1);
        draw();
      } catch (err) {
        console.error('[spikeGL] terrain surface maps failed to load', err);
      }
    })();

    // The mesh only changes when the TERRAIN does — never when the camera moves.
    // Caching on a signature is what makes a pan or a zoom a single uniform
    // upload instead of rebuilding several thousand triangles per frame.
    let cachedKey = '';
    let vertexCount = 0;
    let tiles: TileInfo[] = [];

    function syncMesh() {
      tiles = readTiles(board!);
      const key = `${props}|${tiles.map((t) => `${t.terrain}${t.height.toFixed(2)}${t.x0.toFixed(1)}`).join()}`;
      if (key === cachedKey) return;
      cachedKey = key;
      const data = buildMesh(tiles, props);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buf);
      gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW);
      vertexCount = data.length / 9;
    }

    function buildMVP() {
      const cam = readCamera(board!, col!);
      // The canvas has to cover the VIEWPORT, not the column.
      //
      // It was sized to the column, which is only as big as the board's layout
      // box — so the moment the board grew past it (dollying in, or panning a
      // corner to the centre) the terrain outside simply had no canvas to be
      // drawn on and vanished, while the DOM tiles carried on. Anything off
      // screen is invisible anyway, so the viewport is the right bound.
      //
      // Still centred on the perspective origin: an on-axis camera cannot
      // reproduce an off-centre vanishing point, so the canvas moves instead.
      const colRect = col!.getBoundingClientRect();
      const eyeX = colRect.left + cam.Ox;
      const eyeY = colRect.top + cam.Oy;
      const W = Math.max(2 * Math.max(eyeX, window.innerWidth - eyeX), 1);
      const H = Math.max(2 * Math.max(eyeY, window.innerHeight - eyeY), 1);

      const F = flipY();
      // The board's live transform, mid-transition and all, conjugated into the
      // y-up world by F·M·F.
      const model = mul(
        translation(cam.originX - cam.Ox, -(cam.originY - cam.Oy), 0),
        mul(F, mul(cssMatrix(board!), F)),
      );
      const view = translation(0, 0, -cam.P); // eye at +P looking down -Z
      // `near` has to clear the tallest terrain, which stands well off the board
      // and toward the camera; a near of 1 clipped mountains at a close dolly.
      const proj = perspective(2 * Math.atan(H / 2 / cam.P), W / H, Math.max(1, cam.P * 0.02), cam.P * 8);
      return { mvp: mul(proj, mul(view, model)), model, W, H, cam };
    }

    function draw() {
      const { mvp, model, W, H, cam } = buildMVP();
      // A viewport-sized canvas can get large, and the drawing buffer is the one
      // thing here that scales with area rather than with the 49 tiles. Cap the
      // pixel budget and give back resolution rather than memory.
      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      while (W * H * dpr * dpr > MAX_BUFFER_PX && dpr > 0.5) dpr *= 0.75;
      canvas.style.position = 'absolute';
      canvas.style.left = `${cam.Ox - W / 2}px`;
      canvas.style.top = `${cam.Oy - H / 2}px`;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '0';
      const cw = Math.round(W * dpr);
      const ch = Math.round(H * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      gl!.viewport(0, 0, canvas.width, canvas.height);
      syncMesh();

      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
      gl!.useProgram(prog!);
      gl!.bindVertexArray(vao);
      gl!.uniformMatrix4fv(uMVP, false, mvp);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D_ARRAY, albedoTex);
      gl!.uniform1i(uAlbedo, 0);
      gl!.activeTexture(gl!.TEXTURE1);
      gl!.bindTexture(gl!.TEXTURE_2D_ARRAY, surfaceTex);
      gl!.uniform1i(uSurface, 1);
      gl!.uniform1f(uHasSurface, surfaceReady ? 1 : 0);
      gl!.uniformMatrix4fv(uModel, false, model);
      gl!.uniform3f(uLight, sun[0], sun[1], sun[2]);
      gl!.uniform1f(uEyeZ, cam.P);
      // Driven by the same `--spike-tex-fade` the CSS tiles read, so one dial moves
      // both boards and they cannot disagree about how strong the material is.
      const fade = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spike-tex-fade'));
      gl!.uniform1f(uTexStrength, texReady ? 1 - (Number.isFinite(fade) ? fade : 30) / 100 : 0);
      gl!.drawArrays(gl!.TRIANGLES, 0, vertexCount);
      return { mvp, W, H, cam };
    }

    /**
     * Projects each tile's TOP-FACE corners through the same matrix the GL layer
     * uses, and compares the bounds with the bounds the browser reports for the
     * real DOM tile. Top face, not footprint: the DOM tile is lifted by the same
     * `--spike-h * --spike-relief`, so this now checks that the two layers agree
     * about HEIGHT as well as about position.
     */
    function verify() {
      const { mvp, W, H, cam } = draw();
      const colRect = col!.getBoundingClientRect();
      const canvasLeft = colRect.left + cam.Ox - W / 2;
      const canvasTop = colRect.top + cam.Oy - H / 2;
      const domTiles = Array.from(board!.querySelectorAll<HTMLElement>('.tile'));
      let worstErr = 0;
      let worstTile = '';
      let sum = 0;
      tiles.forEach((t, i) => {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [cx, cy] of [[t.x0, t.y0], [t.x1, t.y0], [t.x1, t.y1], [t.x0, t.y1]]) {
          const [x, y, , w] = apply(mvp, cx!, -cy!, t.height);
          const sx = canvasLeft + ((x / w) * 0.5 + 0.5) * W;
          const sy = canvasTop + (0.5 - (y / w) * 0.5) * H;
          minX = Math.min(minX, sx);
          maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy);
          maxY = Math.max(maxY, sy);
        }
        const r = domTiles[i]!.getBoundingClientRect();
        const errs = [minX - r.left, minY - r.top, maxX - minX - r.width, maxY - minY - r.height];
        const worst = Math.max(...errs.map(Math.abs));
        sum += Math.abs(errs[0]!) + Math.abs(errs[1]!);
        if (worst > worstErr) {
          worstErr = worst;
          worstTile = t.label;
        }
      });
      return {
        tiles: tiles.length,
        worstErrorPx: +worstErr.toFixed(3),
        worstTile,
        meanErrorPx: +(sum / (tiles.length * 2)).toFixed(4),
        triangles: vertexCount / 3,
      };
    }

    /** Proof of rasterisation: how many sampled pixels came back non-transparent. */
    function coverage(samples = 4000) {
      draw(); // read back the frame this call just produced, not whatever survived
      const px = new Uint8Array(4);
      let hit = 0;
      for (let i = 0; i < samples; i++) {
        const x = Math.floor(Math.random() * canvas.width);
        const y = Math.floor(Math.random() * canvas.height);
        gl!.readPixels(x, y, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, px);
        if (px[3]! > 0) hit++;
      }
      return { samples, painted: hit, fraction: +(hit / samples).toFixed(3) };
    }

    /** Point the sun somewhere else and redraw. Normalised for you. */
    function setLight(x: number, y: number, z: number) {
      const n = Math.hypot(x, y, z) || 1;
      sun = [x / n, y / n, z / n];
      draw();
      return sun;
    }

    /** Average RGB over a patch of the canvas — for asserting that pixels changed. */
    function sample(fx = 0.5, fy = 0.5, span = 60) {
      draw();
      const px = new Uint8Array(span * span * 4);
      const x = Math.floor(canvas.width * fx - span / 2);
      const y = Math.floor(canvas.height * fy - span / 2);
      gl!.readPixels(x, y, span, span, gl!.RGBA, gl!.UNSIGNED_BYTE, px);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < px.length; i += 4) {
        r += px[i]!;
        g += px[i + 1]!;
        b += px[i + 2]!;
      }
      const n = px.length / 4;
      return [+(r / n).toFixed(2), +(g / n).toFixed(2), +(b / n).toFixed(2)];
    }

    (window as unknown as { __spikeGL?: unknown }).__spikeGL = {
      draw,
      verify,
      coverage,
      setLight,
      sample,
      get surfaceReady() {
        return surfaceReady;
      },
    };
    draw();

    // Follow on rAF rather than polling.
    //
    // The old 250ms interval was the second half of the jumping: even once the
    // camera came from the live transform, sampling it four times a second turned
    // a smooth 260ms glide into three visible steps. rAF tracks it exactly.
    //
    // It stays cheap because it does nothing unless something moved: the matrix
    // and the canvas size are compared against the last frame, and a board at
    // rest costs one comparison of 16 floats per frame and no GL work at all.
    let last: M4 = ident();
    let lastSize = '';
    let lastInputs = '';

    /**
     * The CSS-driven inputs that change what is DRAWN without moving the camera.
     *
     * ⚠ Without these in the comparison the loop only ever notices the matrix, so
     * every dial that feeds a uniform or the mesh rather than the camera silently
     * did nothing on the GL board: turning Texture up changed `--spike-tex-fade`
     * and no frame was ever redrawn to read it. It looked exactly like the texture
     * feature being broken, and it is why the terrain could sit flat at any
     * strength until something else happened to force a redraw.
     */
    function inputKey(): string {
      const r = getComputedStyle(document.documentElement);
      return `${r.getPropertyValue('--spike-tex-fade')}|${r.getPropertyValue('--spike-relief')}`;
    }

    let raf = 0;
    function tick() {
      raf = requestAnimationFrame(tick);
      const { mvp, W, H } = buildMVP();
      const size = `${W}x${H}`;
      const inputs = inputKey();
      let same = size === lastSize && inputs === lastInputs;
      if (same) {
        for (let i = 0; i < 16; i++) {
          if (Math.abs(mvp[i]! - last[i]!) > 1e-6) {
            same = false;
            break;
          }
        }
      }
      if (same) return;
      last = mvp;
      lastSize = size;
      lastInputs = inputs;
      draw();
    }
    raf = requestAnimationFrame(tick);

    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    // Terrain edits do not move the camera, so the matrix check above would miss
    // them; the mesh cache keys off the tiles themselves and this pokes it.
    const obs = new MutationObserver(() => draw());
    obs.observe(board, { subtree: true, attributes: true, attributeFilter: ['data-terrain'] });

    return () => {
      window.removeEventListener('resize', onResize);
      obs.disconnect();
      cancelAnimationFrame(raf);
      delete (window as unknown as { __spikeGL?: unknown }).__spikeGL;
      cancelled = true;
      gl.deleteTexture(albedoTex);
      gl.deleteTexture(surfaceTex);
      delete document.documentElement.dataset.spikeGl;
      canvas.remove();
    };
  }, [on, props, style, size, boardEl]);

  return null;
}
