// Which illustration a card wears.
//
// `npm run art -- --variants=N` generates alternates: variant 1 keeps the bare
// `<id>.jpg` name, alternates are `<id>-2.jpg`, `<id>-3.jpg`. This module owns the two
// halves the UI needs — WHICH alternates exist (fetched once from the generated
// variants.json) and WHICH ONE the player picked (persisted per card).
//
// Both are external stores read through `useSyncExternalStore` rather than React state
// in a provider: art is rendered by CardArtImage in a dozen unrelated places (deck
// tiles, hand, portraits, the detail panel), and picking art in the detail panel has to
// update the tile behind it. A context would mean threading a provider through every
// one of those trees to achieve the same thing.

import { useSyncExternalStore } from 'react';

const CHOICE_KEY = 'terraforma.cardArt.v1';

// ---------------------------------------------------------------------------
// Which alternates exist — written by the generator into variants.json
// ---------------------------------------------------------------------------

/** One illustration a card can wear: its variant number, and the model that drew it. */
export interface ArtVariant {
  n: number;
  /** Display label, e.g. "Kontext Max". Absent for art generated before models were tracked. */
  model?: string;
}

// ⚠ A LIST, not a count. Generation fails per image, so a card can hold variants 1
// and 3 but not 2; a count would offer a variant whose file 404s.
const ONLY_DEFAULT: readonly ArtVariant[] = [{ n: 1 }];
let variantIndex: Record<string, ArtVariant[]> = {};
let loaded = false;
const indexListeners = new Set<() => void>();

/**
 * Normalise a variants.json entry.
 *
 * ⚠ Accepts BOTH shapes. The file used to be `{ id: [1, 2] }` and is now
 * `{ id: [{ n: 1, model: "…" }] }`; a stale file on disk (or a half-finished run) must not
 * crash the picker, so plain numbers are still understood.
 */
function normalise(raw: unknown): ArtVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: ArtVariant[] = [];
  for (const v of raw) {
    if (typeof v === 'number') out.push({ n: v });
    else if (v && typeof v === 'object' && typeof (v as ArtVariant).n === 'number') {
      const { n, model } = v as ArtVariant;
      out.push(model ? { n, model } : { n });
    }
  }
  return out;
}

/**
 * Cards absent from variants.json have exactly one image, so the whole file is only
 * the cards that offer a choice. A missing file is normal (no alternates generated
 * yet) and must not be an error.
 */
export function loadVariantIndex(): void {
  if (loaded) return;
  loaded = true;
  fetch(`${import.meta.env.BASE_URL}card-art/variants.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((data: unknown) => {
      if (data && typeof data === 'object') {
        const next: Record<string, ArtVariant[]> = {};
        for (const [id, raw] of Object.entries(data as Record<string, unknown>)) {
          const list = normalise(raw);
          if (list.length > 0) next[id] = list;
        }
        variantIndex = next;
        indexListeners.forEach((fn) => fn());
      }
    })
    .catch(() => {
      /* no alternates generated yet — one image per card */
    });
}

const subscribeIndex = (fn: () => void) => {
  indexListeners.add(fn);
  return () => indexListeners.delete(fn);
};

/** Which illustrations this card has. Always at least one. */
export function artVariants(id: string): readonly ArtVariant[] {
  const list = variantIndex[id];
  return list && list.length ? list : ONLY_DEFAULT;
}

// ---------------------------------------------------------------------------
// Which one the player picked
// ---------------------------------------------------------------------------

function readChoices(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

let choices = readChoices();
const choiceListeners = new Set<() => void>();

const subscribeChoices = (fn: () => void) => {
  choiceListeners.add(fn);
  return () => choiceListeners.delete(fn);
};

/** The chosen variant for a card, defaulting to 1. */
export function artVariant(id: string): number {
  return choices[id] ?? 1;
}

/**
 * Pick an illustration. Choosing variant 1 DELETES the entry rather than storing a 1,
 * so the stored object only ever holds real deviations from the default — otherwise
 * every card ever inspected would accumulate a no-op row.
 */
export function setArtVariant(id: string, n: number): void {
  const next = { ...choices };
  if (n <= 1) delete next[id];
  else next[id] = n;
  choices = next;
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn(`failed to persist ${CHOICE_KEY}`, e);
  }
  choiceListeners.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------
// Paths + hooks
// ---------------------------------------------------------------------------

/** Public URL of one specific illustration. Variant 1 is the unsuffixed file. */
export function artSrc(id: string, n: number): string {
  const file = n <= 1 ? `${id}.jpg` : `${id}-${n}.jpg`;
  return `${import.meta.env.BASE_URL}card-art/${file}`;
}

/** The variant this card is currently wearing, re-rendering when it changes. */
export function useArtVariant(id: string): number {
  return useSyncExternalStore(
    subscribeChoices,
    () => choices[id] ?? 1,
    () => 1, // server snapshot: always the default
  );
}

/**
 * Which illustrations this card has, re-rendering once variants.json lands.
 *
 * ⚠ The snapshot must return a STABLE reference for unchanged data — `useSyncExternalStore`
 * compares snapshots with Object.is and would loop forever on a fresh array each call.
 * `artVariants` returns the stored array itself (or one shared default), never a copy.
 */
export function useArtVariants(id: string): readonly ArtVariant[] {
  return useSyncExternalStore(
    subscribeIndex,
    () => artVariants(id),
    () => ONLY_DEFAULT,
  );
}
