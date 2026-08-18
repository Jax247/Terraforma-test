// Seeded randomness, in one place. Pure — no engine imports, no globals.
//
// Exists because the same mulberry32 was pasted into both AI policies AND because deck order
// was never randomized outside the GUI: `initGame` takes the deck list as given, and every
// headless caller (scripts/ab.ts, tests) handed it `[...deck.list]` verbatim. That made every
// harness game play its decks in literal list order, so `--seeds` varied only the bots'
// tie-jitter and cards near the bottom of a list were never drawn at all. Shuffling from the
// per-game seed is what makes seeds sample the DECK as well as the bot.

/** Small, fast, seeded PRNG. Same generator both AI policies used for tie-jitter. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The default `GameState.rngSeed`. A fixed constant on purpose: while no card consumes randomness
 * mid-game the seed never advances, so every existing caller — the A/B harness's bit-identical
 * sharded runs included — is unaffected by the RNG existing at all.
 */
export const DEFAULT_SEED = 0x5eed;

/**
 * Advance an in-state seed and return the next float in [0, 1).
 *
 * Mid-game randomness (`Search` reshuffling the deck) cannot use the caller-side shuffling every
 * other path does, because there is no caller at that moment — the effect resolves inside
 * `applyAction`. Carrying the seed IN the state keeps it deterministic for replays, A/B runs and
 * AI lookahead, where each cloned branch advances its own copy.
 *
 * Mutates `holder.rngSeed` deliberately: an RNG that does not advance is not an RNG. Built on the
 * same `mulberry32` step as everything else here — `rng.ts` exists precisely because that
 * generator used to be pasted into several files.
 */
export function nextRandom(holder: { rngSeed: number }): number {
  const r = mulberry32(holder.rngSeed);
  const v = r();
  // Re-derive the next seed from the value so successive calls diverge; mulberry32 is a
  // counter-based generator, so advancing the counter is enough and is exactly reproducible.
  holder.rngSeed = (holder.rngSeed + 0x6d2b79f5) | 0;
  return v;
}

/** Fisher-Yates, non-mutating. Deterministic for a given `rand`. */
export function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
