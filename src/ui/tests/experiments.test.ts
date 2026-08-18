// The setup screen's experiment config drives GLOBAL engine state, so these guard the three
// properties that matter: the config reaches the engine intact, every path that leaves an
// experiment puts the engine back to the shipping ruleset, and junk from localStorage can
// never reach the engine as a live rule.

import { afterEach, describe, expect, it } from 'vitest';
import { RULES, RULES_DEFAULTS } from '../../engine';
import type { RulesConfig } from '../../engine';
import {
  applyExperiments,
  changedCount,
  describeExperiments,
  EXPERIMENT_DEFAULTS,
  liveExperiments,
  normalizeExperiments,
  resetExperiments,
  RULE_KNOBS,
} from '../experiments';

afterEach(resetExperiments); // never leak engine globals into another test file

describe('applying a config', () => {
  it('pushes the numeric knobs into the engine', () => {
    applyExperiments({
      rules: { ...RULES_DEFAULTS, startingLife: 120, spCap: 12, flankPerAlly: 0 },
    });
    expect(RULES.startingLife).toBe(120);
    expect(RULES.spCap).toBe(12);
    expect(RULES.flankPerAlly).toBe(0);
    expect(RULES.handCap).toBe(RULES_DEFAULTS.handCap); // untouched knobs stay at baseline
  });

  it('a later apply fully replaces the previous one (no sticky knobs)', () => {
    applyExperiments({ ...EXPERIMENT_DEFAULTS, rules: { ...RULES_DEFAULTS, startingLife: 50 } });
    applyExperiments({ ...EXPERIMENT_DEFAULTS, rules: { ...RULES_DEFAULTS, handCap: 3 } });
    expect(RULES.startingLife).toBe(RULES_DEFAULTS.startingLife);
    expect(RULES.handCap).toBe(3);
  });

  it('reset restores the shipping ruleset — the online-game guarantee', () => {
    applyExperiments({ rules: { ...RULES_DEFAULTS, startingLife: 10, unitCap: 1 } });
    resetExperiments();
    expect(RULES).toEqual(RULES_DEFAULTS);
    expect(liveExperiments()).toEqual(EXPERIMENT_DEFAULTS);
  });
});

describe('normalizing stored configs', () => {
  it('fills in missing, partial, and out-of-range values', () => {
    expect(normalizeExperiments(undefined)).toEqual(EXPERIMENT_DEFAULTS);
    // Hand-edited or older localStorage must not reach the engine as-is. `defense` is a config
    // section that no longer exists (two-stat combat became a core rule 2026-08-04) — a stored
    // config still carrying it must be dropped, not passed through.
    const junk = {
      defense: { enabled: true, piercing: 'nope', ignoreFrac: 5 },
      rules: { startingLife: 'lots', unitCap: 9999, handCap: NaN },
    } as never;
    const clean = normalizeExperiments(junk);
    expect('defense' in clean).toBe(false);
    expect('guard' in clean, 'the Guard flag is gone, not merely defaulted').toBe(false);
    expect(clean.rules.startingLife).toBe(RULES_DEFAULTS.startingLife);
    expect(clean.rules.handCap).toBe(RULES_DEFAULTS.handCap);
    // A select knob must reject a value outside its option set rather than passing a string
    // the engine has no branch for.
    const poisoned = normalizeExperiments({ rules: { sigilStatus: 'Melted' } } as never);
    expect(poisoned.rules.sigilStatus).toBe(RULES_DEFAULTS.sigilStatus);
    const chosen = normalizeExperiments({ rules: { sigilStatus: 'AtkMod' } } as never);
    expect(chosen.rules.sigilStatus).toBe('AtkMod');
    const unitCapKnob = RULE_KNOBS.find((k) => k.key === 'unitCap');
    expect(unitCapKnob?.kind === 'number' && clean.rules.unitCap === unitCapKnob.max).toBe(true); // clamped
  });

  it('every knob round-trips through normalize', () => {
    const tweaked = { ...RULES_DEFAULTS } as RulesConfig;
    for (const knob of RULE_KNOBS) {
      if (knob.kind === 'number') tweaked[knob.key] = knob.min;
      else if (knob.kind === 'toggle') tweaked[knob.key] = !RULES_DEFAULTS[knob.key];
      // Pick an option that is NOT the default, so the round trip proves it survived.
      else tweaked[knob.key] = knob.options.find((o) => o !== RULES_DEFAULTS[knob.key])! as never;
    }
    expect(normalizeExperiments({ ...EXPERIMENT_DEFAULTS, rules: tweaked }).rules).toEqual(tweaked);
  });
});

describe('reporting what changed', () => {
  it('is silent at baseline', () => {
    expect(describeExperiments(EXPERIMENT_DEFAULTS)).toEqual([]);
    expect(changedCount(EXPERIMENT_DEFAULTS)).toBe(0);
  });

  it('names each off-baseline knob', () => {
    // ⚠ There are no prototype FLAGS left to name. The Guard experiment was the only one, and the
    // 2026-08-09 re-spec turned it into a shipping movement rule that needs no flag: the keyword
    // gates itself, because it does nothing unless a card carries it.
    const lines = describeExperiments({ rules: { ...RULES_DEFAULTS, startingLife: 120 } });
    expect(lines).toEqual(['Starting LP 120 (was 200)']);
  });
});
