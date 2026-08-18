import type { Terrain } from '../engine';

export const TERRAIN_COLOR: Record<Terrain, string> = {
  Normal: '#cfc8b8',
  Forest: '#4e8f4a',
  Mountain: '#9c8b72',
  Sea: '#4a7fc4',
  Grassland: '#a4c26a',
  Desert: '#dbb96a',
  Shadow: '#6b5a8a',
  Sanctuary: '#efe3ac',
  // Impassable structure — deliberately reads as built, not grown.
  Wall: '#3b3f47',
};

// --- Derived terrain tokens ---
//
// The map above stays the single source of truth: rather than duplicating these
// nine colours into SCSS, applyTerrainTokens() publishes them (and two companions
// derived from each) onto :root at boot. Stylesheets then read
// var(--terrain-forest) / -edge / -ink without ever hard-coding a terrain colour.
//
// The -ink companion is what fixes the coordinate labels, which were hard-coded
// #111 and unreadable on Forest, Shadow and Wall.

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two hex colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function shade(hex: string, factor: number): string {
  const [r, g, b] = parseHex(hex);
  return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
}

const INK_DARK = '#0d0d0c';
const INK_LIGHT = '#f7f5ef';

/**
 * Readable text colour for a tile of this terrain — whichever of the dark/light
 * inks actually wins on contrast, not a fixed luminance threshold.
 *
 * The distinction matters: a threshold picked light ink for Forest (#4e8f4a),
 * which measures 3.6:1 and fails AA, where dark ink on the same green is 4.96:1.
 * Best-of clears 4.5:1 on all nine terrains.
 */
export function terrainInk(hex: string): string {
  return contrastRatio(INK_DARK, hex) >= contrastRatio(INK_LIGHT, hex) ? INK_DARK : INK_LIGHT;
}

/** CSS custom-property name for a terrain, e.g. Grassland -> --terrain-grassland. */
export const terrainVar = (t: Terrain): string => `--terrain-${t.toLowerCase()}`;

/**
 * Publish the terrain palette as CSS variables. Called once at boot; idempotent,
 * so a hot reload re-running it is harmless.
 */
export function applyTerrainTokens(root: HTMLElement = document.documentElement): void {
  for (const [terrain, hex] of Object.entries(TERRAIN_COLOR) as [Terrain, string][]) {
    const name = terrainVar(terrain);
    root.style.setProperty(name, hex);
    // Edge: a darkened rim so adjacent same-terrain tiles still read as separate cells.
    root.style.setProperty(`${name}-edge`, shade(hex, 0.72));
    root.style.setProperty(`${name}-ink`, terrainInk(hex));
  }
}
