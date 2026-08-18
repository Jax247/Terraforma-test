// The tester's control surface over the engine's global rules state.
//
// This build is a balance workbench, not a shipping client: the point is to change a rule,
// play a game, and see what it does. Three kinds of knob live behind one config here:
//
//   rules  — the numeric constants in `RULES` (LP, SP curve, caps, fatigue, flanking).
//   decks  — the harness probe decks, surfaced by SetupScreen/DeckPage, not stored here.
//
// The engine holds all of this as GLOBAL mutable state, not per-GameState (see rules.ts), so
// the contract is: build a serializable config in the UI, push it into the engine exactly once
// at game start, and treat it as constant for that game's lifetime. Every render and the AI
// evaluator then see one consistent ruleset. Changing a knob means starting a new game.
//
// Online play is exempt by construction: the two clients replay a shared action log and none
// of this travels in the start payload, so `resetExperiments()` runs whenever an online game
// is built and online matches always use the shipping ruleset.

import { RULES, RULES_DEFAULTS, resetRules, setRules, SIGIL_STATUSES } from '../engine';
import type { RulesConfig } from '../engine';

/**
 * ⚠ The `guard` flag is GONE (2026-08-09). Guard was re-spec'd from an interception experiment to
 * a shipping movement rule (a pin — see `guardPins` in engine.ts), and it needs no flag because it
 * gates itself: the keyword does nothing unless a card carries it.
 */
export interface ExperimentConfig {
  rules: RulesConfig;
}

/** The shipping ruleset: every flag off, every number at its baseline. */
export const EXPERIMENT_DEFAULTS: ExperimentConfig = {
  rules: { ...RULES_DEFAULTS },
};

/** Keys of RulesConfig by value type, so the knob table stays type-safe over a mixed config. */
type NumericRuleKey = { [K in keyof RulesConfig]: RulesConfig[K] extends number ? K : never }[keyof RulesConfig];
type BooleanRuleKey = { [K in keyof RulesConfig]: RulesConfig[K] extends boolean ? K : never }[keyof RulesConfig];
type SelectRuleKey = { [K in keyof RulesConfig]: RulesConfig[K] extends string ? K : never }[keyof RulesConfig];

/** Setup-screen presentation for each knob: label, group, and a range / checkbox / dropdown. */
export type RuleKnob =
  | { kind: 'number'; key: NumericRuleKey; label: string; group: RuleGroup; min: number; max: number; step: number; hint: string }
  | { kind: 'toggle'; key: BooleanRuleKey; label: string; group: RuleGroup; hint: string }
  | { kind: 'select'; key: SelectRuleKey; label: string; group: RuleGroup; options: readonly string[]; hint: string };

/** Any value a rules knob can hold — the UI's one union over a mixed config. */
export type RuleValue = RulesConfig[keyof RulesConfig];

export type RuleGroup = 'Economy' | 'Board & combat';

export const RULE_KNOBS: RuleKnob[] = [
  { kind: 'number', key: 'startingLife', label: 'Starting LP', group: 'Economy', min: 10, max: 999, step: 10, hint: 'Leader life both players start on; 0 loses.' },
  { kind: 'number', key: 'startingHand', label: 'Opening hand', group: 'Economy', min: 0, max: 15, step: 1, hint: 'Cards drawn at game start.' },
  { kind: 'number', key: 'handCap', label: 'Hand cap', group: 'Economy', min: 1, max: 20, step: 1, hint: 'Overdraw past this forces a burn-to-void choice.' },
  { kind: 'number', key: 'fatigueStep', label: 'Fatigue step', group: 'Economy', min: 0, max: 100, step: 5, hint: 'The n-th missed draw deals this × n LP. 0 disables fatigue.' },
  { kind: 'number', key: 'spBase', label: 'SP on turn 1', group: 'Economy', min: 0, max: 30, step: 1, hint: 'Base of the SP curve.' },
  { kind: 'number', key: 'spStep', label: 'SP per turn', group: 'Economy', min: 0, max: 20, step: 1, hint: 'Added each turn until the cap.' },
  { kind: 'number', key: 'spCap', label: 'SP cap', group: 'Economy', min: 1, max: 40, step: 1, hint: 'Ceiling the SP curve flattens to (vault says 12; repo runs 8).' },
  { kind: 'number', key: 'springSp', label: 'Spring SP', group: 'Economy', min: 0, max: 20, step: 1, hint: 'Granted on capture; overflows the cap, expires end of turn.' },
  { kind: 'number', key: 'springRechargeRounds', label: 'Spring recharge', group: 'Economy', min: 0, max: 20, step: 1, hint: 'Rounds before a captured spring relights.' },
  { kind: 'number', key: 'unitCap', label: 'Unit cap', group: 'Board & combat', min: 1, max: 20, step: 1, hint: 'Max non-token units per player on the board.' },
  { kind: 'number', key: 'nonUnitCap', label: 'Set-card cap', group: 'Board & combat', min: 0, max: 20, step: 1, hint: 'Max face-down spells/traps per player.' },
  { kind: 'number', key: 'tokenCap', label: 'Token cap', group: 'Board & combat', min: 0, max: 30, step: 1, hint: 'Max tokens per player; further spawns fizzle.' },
  { kind: 'number', key: 'summoningSickTurns', label: 'Summoning sickness', group: 'Board & combat', min: 0, max: 5, step: 1, hint: 'Turns a new unit waits before it can attack, fuse, shoot, or change stance. 0 = acts immediately.' },
  { kind: 'toggle', key: 'wallsPaintable', label: 'Walls repaintable', group: 'Board & combat', hint: 'Off (the rule as written): terrain painting cannot overwrite a Wall tile. On: painting levels walls.' },
  { kind: 'number', key: 'flankPerAlly', label: 'Flank per ally', group: 'Board & combat', min: 0, max: 50, step: 5, hint: 'Effective ATK per flanking ally. 0 removes flanking.' },
  { kind: 'number', key: 'flankMaxAllies', label: 'Flank max allies', group: 'Board & combat', min: 0, max: 8, step: 1, hint: 'Most allies that can contribute a flank bonus.' },
  { kind: 'select', key: 'sigilStatus', label: 'Sigil status', group: 'Board & combat', options: SIGIL_STATUSES, hint: 'What a sigil applies to a unit that steps on it, unless the map sets its own. Sigils are placed in the board editor.' },
  { kind: 'number', key: 'sigilAmount', label: 'Sigil amount', group: 'Board & combat', min: -100, max: 100, step: 5, hint: 'Modifier size for an AtkMod/DefMod sigil. Ignored by Stunned.' },
  { kind: 'number', key: 'sigilTurns', label: 'Sigil duration', group: 'Board & combat', min: 0, max: 10, step: 1, hint: "Turns of the victim's own that a sigil lasts. 0 makes unspecified sigils inert." },
  { kind: 'number', key: 'sigilLeaderLp', label: 'Sigil leader LP', group: 'Board & combat', min: 0, max: 100, step: 5, hint: 'LP a leader loses for stepping on a sigil. Leaders are immune to crowd control, so marked ground bills them attritionally instead. 0 makes sigils harmless to leaders.' },
];

function num(v: unknown, fallback: number, knob: Extract<RuleKnob, { kind: 'number' }>): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(knob.max, Math.max(knob.min, v));
}

/** Fill in a persisted (possibly stale, partial, or hand-edited) config from localStorage. */
export function normalizeExperiments(c?: Partial<ExperimentConfig>): ExperimentConfig {
  const rules = { ...RULES_DEFAULTS } as RulesConfig;
  for (const knob of RULE_KNOBS) {
    if (knob.kind === 'number') {
      rules[knob.key] = num(c?.rules?.[knob.key], RULES_DEFAULTS[knob.key], knob);
    } else if (knob.kind === 'toggle') {
      const v = c?.rules?.[knob.key];
      rules[knob.key] = typeof v === 'boolean' ? v : RULES_DEFAULTS[knob.key];
    } else {
      const v = c?.rules?.[knob.key];
      // A hand-edited or stale value outside the option set falls back rather than poisoning
      // the engine with a string no switch handles.
      rules[knob.key] = typeof v === 'string' && knob.options.includes(v)
        ? (v as RulesConfig[SelectRuleKey])
        : RULES_DEFAULTS[knob.key];
    }
  }
  return { rules };
}

/** Push the whole config into the engine. Call once per game start, before building state. */
export function applyExperiments(c: ExperimentConfig): void {
  resetRules();
  setRules(c.rules);
}

/** Back to the shipping ruleset — online games, and the app's default state. */
export function resetExperiments(): void {
  applyExperiments(EXPERIMENT_DEFAULTS);
}

/** Human-readable "what's off baseline", for the setup badge and the in-game ruleset panel. */
export function describeExperiments(c: ExperimentConfig): string[] {
  const out: string[] = [];
  for (const knob of RULE_KNOBS) {
    const now = c.rules[knob.key];
    const was = RULES_DEFAULTS[knob.key];
    if (now === was) continue;
    const show = (v: number | boolean | string) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));
    out.push(`${knob.label} ${show(now)} (was ${show(was)})`);
  }
  return out;
}

/** How many knobs are off baseline — the setup screen's at-a-glance badge. */
export const changedCount = (c: ExperimentConfig): number => describeExperiments(c).length;

/** What the engine is running right now, read back from the live globals (not the UI config). */
export function liveExperiments(): ExperimentConfig {
  return { rules: { ...RULES } };
}
