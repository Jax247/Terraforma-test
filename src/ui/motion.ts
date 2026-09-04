// Motion policy — the single place that decides whether the UI animates.
//
// The governing rule lives in the components, not here: **animation never gates a
// state transition.** applyAction() is synchronous and stays that way; animations
// are driven *from* committed state, never awaited before committing it. Nothing in
// an action path (clickTile, dispatch, useAiDriver) may await a motion promise or
// hang work off onAnimationComplete. That is what guarantees an automated run never
// waits on an animation — the switches below are belt-and-braces on top of it.
//
// Resolution order (first match wins):
//   1. ?motion=off|reduced|full|on  — deterministic override for Playwright/harnesses
//   2. navigator.webdriver          — automated browsers default to OFF
//   3. the player's saved setting   — Settings > Animations
//   4. prefers-reduced-motion       — OS-level accessibility preference
//   5. full
//
// One thing outranks even the ?motion= override in practice, because it is not a
// preference at all: a game that commits state faster than the UI can present it.
// See `outrunsPresentation` below.

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

/** What the UI actually does. */
export type MotionMode = 'off' | 'reduced' | 'full';

/** What the player chooses. `auto` defers to the OS preference. */
export type MotionSetting = MotionMode | 'auto';

export const MOTION_SETTINGS: readonly MotionSetting[] = ['auto', 'full', 'reduced', 'off'];

export const MOTION_SETTING_LABELS: Record<MotionSetting, string> = {
  auto: 'Match system',
  full: 'Full',
  reduced: 'Reduced',
  off: 'Off',
};

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** `?motion=` override, if present and valid. `on` is accepted as an alias for `full`. */
function paramOverride(): MotionMode | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = new URLSearchParams(window.location.search).get('motion');
  if (raw === null) return undefined;
  const v = raw.toLowerCase();
  if (v === 'off' || v === 'none' || v === 'false' || v === '0') return 'off';
  if (v === 'reduced') return 'reduced';
  if (v === 'full' || v === 'on' || v === 'true' || v === '1') return 'full';
  console.warn(`ignoring unrecognised ?motion=${raw} (expected off | reduced | full)`);
  return undefined;
}

/**
 * True when a WebDriver-controlled browser is driving the page. Playwright,
 * Selenium and friends all set this. Automated runs get no animation by default so
 * a test author cannot forget to pass ?motion=off.
 */
function isAutomated(): boolean {
  return typeof navigator !== 'undefined' && navigator.webdriver === true;
}

function prefersReduced(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(REDUCED_QUERY).matches === true;
}

/** Apply the resolution order to a saved setting. Pure — the caller supplies the setting. */
export function resolveMotion(setting: MotionSetting): MotionMode {
  const override = paramOverride();
  if (override) return override;
  if (isAutomated()) return 'off';
  if (setting !== 'auto') return setting;
  return prefersReduced() ? 'reduced' : 'full';
}

/**
 * The shortest gap between state commits the presentation layer can still keep up with.
 *
 * Measured, not picked: the token's travel spring (stiffness 400, damping 34, mass 0.7 —
 * see game/UnitToken.tsx) settles in roughly 200ms, and the hand's enter/exit tween runs
 * 180ms. 260 leaves both a little headroom.
 */
export const PRESENTABLE_CADENCE_MS = 260;

/**
 * True when state is committing faster than the UI can present it — an AI seat on
 * Fast or Instant, where the next action lands before the last one has finished
 * being drawn.
 *
 * This is not a preference and not an accessibility concern, so it sits outside the
 * resolution order above and overrides all of it. Animation that cannot finish is not
 * a softer version of the same UI, it is a broken one: tokens tween toward a tile the
 * piece has already left and end up a tile or two behind the truth, the hand fills with
 * cards that are mid-exit and mid-enter at once, and the battle panel never clears the
 * board. `null`/`undefined` means "nothing is driving", i.e. a human is playing.
 */
export function outrunsPresentation(cadenceMs: number | null | undefined): boolean {
  return cadenceMs != null && cadenceMs < PRESENTABLE_CADENCE_MS;
}

/**
 * True when something outranks the player's saved setting — a ?motion= param or an
 * automated browser. Settings UI uses this to explain why the control looks inert
 * rather than leaving it apparently broken.
 */
export function hasMotionOverride(): boolean {
  return paramOverride() !== undefined || isAutomated();
}

/**
 * Subscribe to the OS preference so a mid-session change to
 * prefers-reduced-motion takes effect without a reload.
 */
function subscribeToOsPreference(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const osSnapshot = () => prefersReduced();

/**
 * The resolved mode, plus the side effect that publishes it to CSS.
 *
 * `data-motion` on <html> is what zeroes the --motion-* duration tokens (see
 * _tokens.scss), so CSS transitions die from the same switch as framer-motion.
 *
 * This is the PLAYER'S setting and nothing else. A fast AI seat does not belong here:
 * it says nothing about how quickly a menu should open or a modal should fade, and
 * routing it through this stamp took the whole app's chrome down with the board. The
 * game's own motion is scoped separately — see {@link useGameMotionDuration}.
 */
export function useMotionMode(setting: MotionSetting): MotionMode {
  // Re-resolve when the OS preference flips; the param and webdriver flag are
  // fixed for the page's lifetime.
  useSyncExternalStore(subscribeToOsPreference, osSnapshot, () => false);
  const mode = resolveMotion(setting);

  useEffect(() => {
    document.documentElement.dataset['motion'] = mode;
  }, [mode]);

  return mode;
}

/**
 * framer-motion's <MotionConfig> props for a given mode. `reducedMotion: 'always'`
 * makes every motion component drop transform/layout animation, and the
 * zero-duration transition kills what remains.
 *
 * ⚠ That second half only covers components that declare NO transition of their own:
 * MotionConfig's is a default, and a `transition` prop on the component beats it. A
 * component that must name its own timing reads it through {@link useMotionDuration}
 * instead — see the note there for why an over-running exit is worse than a slow one.
 */
export function motionConfigProps(mode: MotionMode): {
  reducedMotion: 'always' | 'never' | 'user';
  transition?: { duration: number };
} {
  if (mode === 'off') return { reducedMotion: 'always', transition: { duration: 0 } };
  if (mode === 'reduced') return { reducedMotion: 'always' };
  return { reducedMotion: 'never' };
}

/**
 * The two motion scopes, published by App.tsx next to <MotionConfig>.
 *
 * They exist because animation has two different jobs here, and only one of them can be
 * outrun. `ui` is motion the PLAYER caused — a modal opening, a menu, a hover lift. It
 * runs at human pace by definition and answers only to the player's setting. `game` is
 * motion that chases COMMITTED GAME STATE — a token travelling to its new tile, a card
 * leaving the hand — and a driver that commits faster than the animation can finish
 * turns it from a softer version of the UI into a broken one.
 *
 * Collapsing the two was the mistake: gating both on the AI's speed meant a human
 * playing a Fast AI lost every transition in the app, including on their own turn and on
 * every other screen.
 */
export interface MotionScopes {
  /** The player's resolved setting. */
  ui: MotionMode;
  /** `ui`, stepped down to `off` while something outruns the presentation. */
  game: MotionMode;
}

const MotionContext = createContext<MotionScopes>({ ui: 'full', game: 'full' });
export const MotionScopeProvider = MotionContext.Provider;

/**
 * A transition duration in seconds, collapsed to 0 when motion is off.
 *
 * For the case <MotionConfig> cannot reach: a component that declares its own
 * `transition` overrides the config's, so `off` would leave its timing intact. That is
 * merely cosmetic for an entrance, but an EXIT duration also gates when AnimatePresence
 * removes the node from the DOM — so an exit that outlives the gap between state changes
 * does not just look wrong, it accumulates.
 */
export function useMotionDuration(seconds: number): number {
  return useContext(MotionContext).ui === 'off' ? 0 : seconds;
}

/** {@link useMotionDuration} for motion that chases committed game state. */
export function useGameMotionDuration(seconds: number): number {
  return useContext(MotionContext).game === 'off' ? 0 : seconds;
}

/**
 * The resolved mode for motion that chases committed game state.
 *
 * Exists for the one thing neither <MotionConfig> nor a zeroed duration can switch off:
 * framer's LAYOUT PROJECTION (`layout` / `layoutId`), which is a separate system from
 * the `animate` prop. `reducedMotion: 'always'` does not reach it — tokens were still
 * travelling 156px, two full tiles, with motion resolved to off — and neither does a
 * `transition` of `{ duration: 0 }`: projection still measures the move and writes the
 * delta as an inline `translate3d(...)`, and with no animation left to run there is
 * nothing to carry that transform back to zero, so the token simply STAYS displaced.
 * (Measured: `translate3d(-78px, 0, 0)`, exactly one tile, stuck for 61 of 718 frames.)
 *
 * The only reliable switch is not to ask for a layout animation in the first place, so
 * callers use this to drop the `layout`/`layoutId` props themselves.
 */
export function useGameMotion(): MotionMode {
  return useContext(MotionContext).game;
}
