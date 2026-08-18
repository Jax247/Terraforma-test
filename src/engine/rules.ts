import type { StatusEffectKind } from './types';

// Tunable rules constants, in one mutable place so the tester can sweep them.
//
// This POC is a balance workbench, not a shipping game: the numbers below are exactly the
// ones playtesting keeps wanting to move (LP totals, the SP curve, caps, fatigue, flanking).
// Holding them as `export const` made every experiment a code edit and a rebuild, so they
// live here as a single mutable object instead.
//
// Deliberately GLOBAL rather than per-GameState:
// these are rules-of-the-universe, not per-game data, and the AI evaluator reads them without
// a state handle. The consequence is that whoever changes them owns the whole process — the UI
// applies a config once per game start, and the harness sets them per experiment arm. Anything
// that mutates RULES in a test MUST restore it (`resetRules()` in afterEach), or the change
// leaks into every later test in the same file.
//
// `RULES_DEFAULTS` is the shipping ruleset — the vault-ratified (or working-ruling) values.
// Diffing RULES against it is what tells a tester which knobs are off-baseline.

export interface RulesConfig {
  /** Leader life points each player starts with; 0 LP loses. */
  startingLife: number;
  /** Cards drawn at game start. */
  startingHand: number;
  /** Hand size that triggers the forced burn-to-void choice on overdraw. */
  handCap: number;
  /** The n-th missed draw from an empty deck deals fatigueStep × n LP. */
  fatigueStep: number;
  /** Max non-token units a player may have on the board. */
  unitCap: number;
  /** Max face-down (spell/trap) cards a player may have on the board. */
  nonUnitCap: number;
  /** Max tokens per player; further spawns fizzle. */
  tokenCap: number;
  /**
   * Turns a newly arrived unit must wait before it can attack, fuse, shoot, or change stance.
   * 0 (the default since 2026-08-01) lets units act the turn they land; 1 is the older rule.
   */
  summoningSickTurns: number;
  /** SP granted on capturing a spring (overflows the cap, expires end of turn). */
  springSp: number;
  /** Rounds after a capture before a spring relights. */
  springRechargeRounds: number;
  /** SP on turn 1. */
  spBase: number;
  /**
   * SP added per turn thereafter.
   *
   * ⚠ 3 -> 1 on 2026-08-09 (the `sp-curve` experiment, ADOPTED). At 3 the curve was 4/7/8 and
   * FINISHED ON TURN 3 — the most expensive body in the game was affordable from turn 3 onward,
   * every turn, so the economy was a non-factor for 10 of a 13-round game. At 1 it runs
   * 4/5/6/7/8 and the top end arrives on turn 5.
   *
   * Adopted for FEEL, not balance: measured over 1620 games/arm it is balance-neutral (every
   * per-deck delta inside ±5pp, spread 51.1 -> 51.9pp) and health-neutral or slightly better
   * (stalls 0%, fatigue 2.2% -> 2.0%, decisive 100%, rounds 13.0 -> 13.7). What it buys is a real
   * ramp across the first third of the game: the first 6+ SP body lands on round 5.3 instead of
   * 3.4, while 6+ bodies PLAYED per game is unchanged at 2.86 — delayed, not suppressed.
   *
   * ⚠ `spStep: 2` is a trap: 4+2+2 = 8, so it still unlocks on turn 3 and changes nothing.
   */
  spStep: number;
  /** Ceiling the SP curve flattens to. */
  spCap: number;
  /**
   * Whether conventional terrain painting can overwrite a Wall tile. False (the rule as
   * specified) makes walls permanent structure; true is the experiment — painting levels them.
   */
  wallsPaintable: boolean;
  /**
   * SUPPORT RANGE (2026-08-05 experiment, default OFF). DotR's core leader mechanic, which
   * Terraforma never inherited: there, a leader's support applied only within a 3×3 around it,
   * while ours project globally by type from total safety.
   *
   * `0` = off, today's behaviour. `N > 0` bounds a leader's passive auras — ATK and DEF alike —
   * and the reach of its LOCATED abilities to Chebyshev ≤ N from the leader.
   *
   * ⚠ It deliberately does NOT govern the summon zone, which stays the 8 surrounding tiles at any
   * radius, nor located SPELL travel, which is a spell rule.
   *
   * At `1` the ability-reach half is a no-op (located reach is already 1), so `supportRange = 1`
   * changes only the auras — which is what makes the A/B a clean single-variable read.
   */
  supportRange: number;
  /**
   * FAVORED-TERRAIN MOVEMENT — **ADOPTED 2026-08-06**, default 1.
   *
   * The half of DotR's terrain system Terraforma originally didn't take: there, favored terrain
   * granted +500 ATK/DEF **and** a second move, so terrain governed mobility as well as combat.
   * `N` tiles of extra movement while a unit stands on its own favored terrain, additive with
   * `extraMove`, leaders included. `0` restores the pre-adoption rule.
   *
   * Adopted on an unusually strong A/B: **anti-stall in 4/4 configurations**, significant every
   * time, and — the deciding evidence — LARGEST under the strongest bot rather than smallest.
   *   arena seeds 0–19   fatigue 5.2% → 1.3%*   rounds 18 → 12
   *   arena seeds 40–59  fatigue 6.4% → 1.1%*   rounds 18 → 12
   *   all six maps       fatigue 12.9% → 6.5%*  rounds 19 → 14   (6/6 maps improved)
   *   search policy      fatigue 14.1% → 2.0%*  rounds 23 → 17
   * Stalls stayed 0.0% in every arm; it never introduced one. The kite-stall risk it was
   * flagged for did not materialise — faster mobility means faster CONTACT, not better kiting
   * (ranged kills fell, first blood came 2.2 rounds sooner).
   *
   * ⚠ Known costs, both consistent across all four runs: **Redmark −6pp** (the `Anchored`
   * formation deck — mobilising the board undercuts a deck built on holding a static line) and
   * **Hivebrood −4pp** (a grind swarm hurt by games ending ~6 rounds sooner; its rebuild is
   * already the next content phase). Spread effect was neutral: this is a health fix, not a
   * balance fix.
   *
   * Also opens a design space `Crowd Control §6` recorded as closed — "base movement is 1 so
   * there is no slow, only stop" killed the slow/chill axis, and a movement BONUS opens it from
   * the other end.
   */
  favoredTerrainMove: number;
  /** Effective ATK per flanking ally (unit-vs-unit only). */
  flankPerAlly: number;
  /** Most allies that can contribute a flanking bonus. */
  flankMaxAllies: number;
  /**
   * Fallback Sigil spec, used for any sigil tile that carries no explicit one of its own
   * (the map editor can set them per tile). `boardFromLayout` bakes this in at board-build
   * time, so a live Board is always self-describing — which is what keeps the online path
   * safe, since the Board travels in the StartPayload but these knobs do not.
   */
  sigilStatus: StatusEffectKind;
  sigilAmount: number;
  /** Duration in the victim's own turns. 0 makes unspecified sigils inert. */
  sigilTurns: number;
  /**
   * LP a leader loses for stepping on a sigil. Leaders are immune to crowd control, so marked
   * ground bills them the way everything else does — attritionally (Combat Resolution: "binary
   * for units, attritional for the leader"). 0 makes sigils harmless to leaders entirely.
   */
  sigilLeaderLp: number;
}

/**
 * The baseline ruleset. Sources: vault Rules Spec where ratified, working rulings otherwise —
 * the SP curve (4 / +3 / cap 8) is the 2026-07-17 flattening, flanking is the 2026-07-17
 * adoption, fatigue + hand cap are the 2026-07-15 anti-stall pair, and summoning sickness is
 * OFF by user decision 2026-08-01 (a tempo ruleset; the harness evidence was that sickness is
 * not what drives the defense-mode fatigue stall, so this is a feel choice, not a fix — vault
 * NOT updated).
 */
export const RULES_DEFAULTS: Readonly<RulesConfig> = Object.freeze({
  startingLife: 200,
  startingHand: 5,
  handCap: 7,
  fatigueStep: 10,
  unitCap: 5,
  nonUnitCap: 5,
  tokenCap: 5,
  summoningSickTurns: 0,
  springSp: 3,
  springRechargeRounds: 3,
  spBase: 4,
  spStep: 1,   // 3 -> 1, 2026-08-09 — see the field's note
  spCap: 8,
  wallsPaintable: false,
  supportRange: 0,
  favoredTerrainMove: 1, // ADOPTED 2026-08-06 — see the field doc for the A/B that carried it

  flankPerAlly: 5,
  flankMaxAllies: 2,
  sigilStatus: 'Stunned',
  sigilAmount: 0,
  sigilTurns: 2,
  sigilLeaderLp: 10,
});

/** The live ruleset every engine read goes through. Mutate via `setRules` / `resetRules`. */
export const RULES: RulesConfig = { ...RULES_DEFAULTS };

/** Apply a partial override. Keys absent from the patch keep their current value. */
export function setRules(patch: Partial<RulesConfig>): void {
  Object.assign(RULES, patch);
}

/** Restore the shipping ruleset. */
export function resetRules(): void {
  Object.assign(RULES, RULES_DEFAULTS);
}

/** The keys whose live value differs from the baseline — what a tester has actually changed. */
export function changedRules(cfg: RulesConfig = RULES): (keyof RulesConfig)[] {
  return (Object.keys(RULES_DEFAULTS) as (keyof RulesConfig)[]).filter((k) => cfg[k] !== RULES_DEFAULTS[k]);
}
