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

import { useEffect, useSyncExternalStore } from 'react';

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
 * zero-duration transition kills what remains — so individual components never
 * need to branch on the mode themselves.
 */
export function motionConfigProps(mode: MotionMode): {
  reducedMotion: 'always' | 'never' | 'user';
  transition?: { duration: number };
} {
  if (mode === 'off') return { reducedMotion: 'always', transition: { duration: 0 } };
  if (mode === 'reduced') return { reducedMotion: 'always' };
  return { reducedMotion: 'never' };
}
