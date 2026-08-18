import { DEFAULT_SEARCH_SETTINGS, DEFAULT_WEIGHTS, EXPERT_SEARCH_SETTINGS, EXPERT_WEIGHTS } from '../ai';
import type { AiKnowledge, EvalWeights, SearchSettings } from '../ai';

export type AiDifficulty = 'normal' | 'hard' | 'expert';

/**
 * The shared knobs plus BOTH budget fields, because the two searching tiers are budgeted in
 * different currencies: Hard stops on a wall clock, Expert on a node count (so its play is
 * reproducible — see `expert.ts`). One stored object keeps persistence and tier-switching simple;
 * each policy reads only its own field and ignores the other.
 */
export type AiSearchSettings = SearchSettings & { nodeBudget: number };

/** Everything a seat's bot is configured with at match setup. */
export interface AiConfig {
  difficulty: AiDifficulty;
  weights: EvalWeights;
  knowledge: AiKnowledge;
  /** Search-effort knobs; read by both searching tiers ('hard' and 'expert'). */
  search: AiSearchSettings;
}

const DEFAULT_SEARCH: AiSearchSettings = {
  ...DEFAULT_SEARCH_SETTINGS,
  nodeBudget: EXPERT_SEARCH_SETTINGS.nodeBudget,
};

const EXPERT_SEARCH: AiSearchSettings = {
  ...EXPERT_SEARCH_SETTINGS,
  timeBudgetMs: DEFAULT_SEARCH_SETTINGS.timeBudgetMs,
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  difficulty: 'normal',
  weights: DEFAULT_WEIGHTS,
  // Fog since 2026-08-02: a bot that reads face-downs never walks into a trap, so perfect info
  // silently invalidates exactly the playtesting traps and bluffs exist for. Perfect info stays
  // one click away — it is the right setting for isolating a stat question from a bluff question.
  knowledge: 'fog',
  search: DEFAULT_SEARCH,
};

/**
 * Fill defaults into configs persisted before a field existed (stored setups outlive schema
 * changes). Note a stored `knowledge` wins: a setup saved while perfect info was the default
 * keeps it, because this cannot tell an old default apart from a deliberate choice.
 */
export function normalizeAiConfig(c: Partial<AiConfig> | undefined): AiConfig {
  // `immobilizedAtk` was renamed to `stunnedAtk` (2026-08-02, with the Immobilized -> Stunned
  // status rename). A spread alone would silently discard a tuned value under the old key and
  // hand back the default, so carry it across explicitly before the defaults merge.
  const stored = c?.weights as (Partial<EvalWeights> & { immobilizedAtk?: number }) | undefined;
  const legacy = stored?.immobilizedAtk !== undefined && stored.stunnedAtk === undefined
    ? { stunnedAtk: stored.immobilizedAtk }
    : undefined;
  return {
    ...DEFAULT_AI_CONFIG,
    ...c,
    weights: { ...DEFAULT_WEIGHTS, ...stored, ...legacy },
    search: { ...DEFAULT_SEARCH, ...c?.search },
  };
}

/** Starting points, not balance claims — every field stays editable. */
export const AI_PRESETS: Record<string, EvalWeights> = {
  Balanced: DEFAULT_WEIGHTS,
  Aggressive: {
    ...DEFAULT_WEIGHTS,
    lifeDiff: 10, lifeDiffRamp: 2.5,
    leaderThreat: 4, leaderThreatRamp: 4, leaderThreatCap: 55,
    leaderExposure: 1, threatChipFrac: 0.15,
  },
  Defensive: {
    ...DEFAULT_WEIGHTS,
    unitAtk: 2.5, lifeDiff: 8,
    leaderThreat: 1, leaderThreatRamp: 1.5, leaderThreatCap: 30,
    leaderExposure: 4, threatChipFrac: 0.5,
  },
};

const FIELDS: { key: keyof EvalWeights; label: string; step: number; help: string }[] = [
  { key: 'leaderThreat', label: 'Aggression', step: 0.5, help: 'Value per tile of marching a unit toward the enemy leader' },
  { key: 'leaderThreatRamp', label: 'Aggr. ramp/turn', step: 0.5, help: 'Aggression added each of the bot’s turns — breaks terrain camping as games drag on' },
  { key: 'leaderThreatCap', label: 'Aggr. cap', step: 5, help: 'Ceiling for ramped aggression. Must beat the biggest camp bonus (aura+terrain ≈ 20 ATK × unit ATK value) or armies never leave their terrain' },
  { key: 'leaderExposure', label: 'Caution', step: 0.5, help: 'Penalty per tile of an enemy unit’s proximity to the bot’s own leader (does not ramp)' },
  { key: 'threatChipFrac', label: 'Chip fear', step: 0.05, help: 'Fraction of the live LP value charged per point of enemy ATK orthogonally adjacent to the bot’s leader — makes it dodge or answer next-turn chip threats' },
  { key: 'threatChipFadeTurns', label: 'Chip fear fade', step: 5, help: 'The bot’s turns over which chip fear fades to zero — hands the endgame to the aggression ramp so defensive mirrors still finish' },
  { key: 'lifeDiff', label: 'LP value', step: 1, help: 'Value per point of leader LP difference' },
  { key: 'lifeDiffRamp', label: 'LP ramp/turn', step: 0.5, help: 'LP value added each turn — makes chip attacks eventually beat holding position' },
  { key: 'lifeDiffCap', label: 'LP cap', step: 5, help: 'Ceiling for the ramped LP value' },
  { key: 'unitAtk', label: 'Unit ATK value', step: 0.5, help: 'Value per point of a unit’s effective ATK (terrain/auras included). High values make the bot terrain-sticky and trade-shy' },
  { key: 'unitLevel', label: 'Unit level value', step: 1, help: 'Extra value per unit level — utility bodies beyond raw ATK' },
  { key: 'handCard', label: 'Hand card', step: 1, help: 'Value per card in hand' },
  { key: 'handPressure', label: 'Hand pressure', step: 1, help: 'Discount per card above 5 in hand — makes casting/setting beat hoarding into forced burns at the 7-card cap' },
  { key: 'spValue', label: 'SP value', step: 0.5, help: 'Value per point of current SP — makes economy spells and spring income register, and keeps cast-then-spend lines alive in the hard bot\'s search beam' },
  { key: 'setCard', label: 'Set card', step: 1, help: 'Value per face-down card on the board. Keep above hand-card value or the bot never sets traps' },
  { key: 'springHold', label: 'Spring hold', step: 1, help: 'Value per friendly unit standing on a spring tile' },
  { key: 'fatigueFrac', label: 'Deck-out fear', step: 0.05, help: 'Fraction of the live LP value charged per point of LP the bot is forecast to lose to fatigue — makes a thinning deck feel like the debt it is, and makes the opponent’s thinning deck an asset' },
  { key: 'fatigueHorizon', label: 'Deck-out horizon', step: 1, help: 'How many of the bot’s own turns ahead it counts missed draws. Below this many cards left, the deck-out terms wake up; above it they are exactly zero' },
  { key: 'desperationPush', label: 'Desperation', step: 0.25, help: 'Extra aggression (up to ×1+this) as the bot falls behind on LP-minus-forecast-fatigue — a bot that is going to lose the race stops trading and goes for the kill' },
  { key: 'stunnedAtk', label: 'Pin value', step: 0.5, help: 'Value per point of ATK of a Stunned unit — gained when the bot pins an enemy, paid when one of its own is pinned. The own-side half is what keeps it off sigils and out of trap zones.' },
  { key: 'snaredAtk', label: 'Snare value', step: 0.5, help: 'Value per point of ATK of a Snared unit. Counted only for non-Ranged bodies — a shooter ignores a snare, and pricing it otherwise teaches the bot to waste snares on the one target immune to them' },
  { key: 'disarmedAtk', label: 'Disarm value', step: 0.5, help: 'Value per point of ATK of a Disarmed unit. No Ranged carve-out: disarm stops shooting too, leaving the unit only its legs' },
  { key: 'suppressedText', label: 'Suppress value', step: 1, help: 'Value per rule and keyword silenced on a Suppressed unit. Priced by text rather than ATK because the stat half (Frenzy, own auras) already shows up as the unit’s effective ATK dropping — so suppressing a vanilla body is correctly worth nothing' },
  { key: 'actionEpsilon', label: 'Act threshold', step: 0.1, help: 'How much an action must improve the position before the bot bothers — higher = lazier turns' },
];

/**
 * The support-card weights. Split out from FIELDS because they are inert (0) for Normal and
 * Hard by design — showing them for those tiers would advertise knobs that do nothing.
 */
const SUPPORT_FIELDS: { key: keyof EvalWeights; label: string; step: number; help: string }[] = [
  { key: 'handPlayableBonus', label: 'Live card', step: 1, help: 'Extra value per hand card the bot can actually play right now' },
  { key: 'handDeadPenalty', label: 'Dead card', step: 1, help: 'Penalty per unplayable hand card. With Live card, this is what makes a draw spell worth casting and makes a forced discard pick the dead card' },
  { key: 'trapZoneThreat', label: 'Trap placement', step: 1, help: 'Bonus for a face-down card whose 3×3 zone actually covers an enemy — makes the bot set traps where they fire instead of in a corner' },
  { key: 'extraMoveTile', label: 'Granted move', step: 1, help: 'Value per tile of unspent granted movement — without it, a move-granting spell reads as a pure card loss' },
];

type SearchField = { key: keyof AiSearchSettings; label: string; step: number; help: string };

const SEARCH_FIELDS: SearchField[] = [
  { key: 'beamWidth', label: 'Beam width', step: 1, help: 'Candidate lines kept per search depth. Wider = stronger and slower' },
  { key: 'maxPlanLength', label: 'Plan depth', step: 1, help: 'Max actions planned ahead within one turn' },
  { key: 'replyCandidates', label: 'Reply sims', step: 1, help: 'How many of the best turn-endings get a full simulated opponent reply' },
];

/** The budget knob is per-tier because the two tiers spend different currencies. */
const BUDGET_FIELD: Record<'hard' | 'expert', SearchField> = {
  hard: { key: 'timeBudgetMs', label: 'Think time (ms)', step: 500, help: 'Soft wall-clock budget for planning one turn' },
  expert: {
    key: 'nodeBudget',
    label: 'Node budget',
    step: 1000,
    help: 'Positions examined per turn. Counted instead of milliseconds so Expert plays the same game regardless of how busy the machine is — raise for a stronger, slower bot',
  },
};

/** Compares BEHAVIOUR fields only — the support terms belong to the tier, not to a preset. */
function presetName(w: EvalWeights): string {
  for (const [name, preset] of Object.entries(AI_PRESETS)) {
    if (FIELDS.every(({ key }) => w[key] === preset[key])) return name;
  }
  return 'Custom';
}

const DIFFICULTY_LABEL: Record<AiDifficulty, string> = { normal: 'Normal', hard: 'Hard', expert: 'Expert' };

/**
 * Switching tier carries that tier's OWN knobs — the support weights and the search effort —
 * and leaves the behaviour profile (Balanced / Aggressive / Defensive, and any hand tuning of
 * it) alone. Aggression and support-awareness are orthogonal: an Aggressive Expert is a
 * coherent thing to want, and it is why SearchSettings were split out of EvalWeights in the
 * first place. Consequence worth knowing: hand-tuned SUPPORT values reset when you leave the
 * tier and come back, because outside Expert they must be 0 for Normal/Hard to stay baselines.
 */
function withDifficulty(config: AiConfig, d: AiDifficulty): AiConfig {
  if (config.difficulty === d) return config;
  const tierWeights = d === 'expert' ? EXPERT_WEIGHTS : DEFAULT_WEIGHTS;
  const support = Object.fromEntries(SUPPORT_FIELDS.map(({ key }) => [key, tierWeights[key]]));
  return {
    ...config,
    difficulty: d,
    weights: { ...config.weights, ...support },
    search: d === 'expert' ? EXPERT_SEARCH : DEFAULT_SEARCH,
  };
}

export function AiSettings({ config, onChange }: { config: AiConfig; onChange: (c: AiConfig) => void }) {
  const active = presetName(config.weights);
  return (
    <details className="ai-settings">
      <summary>
        AI settings{' '}
        <span className="ai-settings-tag">
          {DIFFICULTY_LABEL[config.difficulty] ?? 'Normal'} · {active} · {config.knowledge === 'fog' ? 'fog of war' : 'perfect info'}
        </span>
      </summary>

      <div className="ai-settings-row">
        <span className="ai-settings-label">Difficulty</span>
        {(
          [
            ['normal', 'Normal', 'Greedy: picks the single best action, no lookahead'],
            ['hard', 'Hard', 'Search: plans whole turns and simulates your best reply before committing'],
            ['expert', 'Expert', 'Search that also plays support: values draw, denial and trap placement, and keeps setup-then-payoff lines alive in its beam'],
          ] as const
        ).map(([d, label, help]) => (
          <button
            key={d}
            className={`small${config.difficulty === d ? ' active' : ''}`}
            title={help}
            onClick={() => onChange(withDifficulty(config, d))}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ai-settings-row">
        <span className="ai-settings-label">Knowledge</span>
        {(
          [
            ['fog', 'Fog of war', 'Default. Hidden cards are masked; plays into traps like a human'],
            ['perfect', 'Perfect info', 'Sees hands & face-downs; never walks into traps — useful for isolating a stat question from a bluff one'],
          ] as const
        ).map(([k, label, help]) => (
          <button
            key={k}
            className={`small${config.knowledge === k ? ' active' : ''}`}
            title={help}
            onClick={() => onChange({ ...config, knowledge: k })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ai-settings-row">
        <span className="ai-settings-label">Preset</span>
        {Object.keys(AI_PRESETS).map((name) => (
          <button
            key={name}
            className={`small${active === name ? ' active' : ''}`}
            onClick={() => onChange({ ...config, weights: { ...AI_PRESETS[name]! } })}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="ai-settings-grid">
        {FIELDS.map(({ key, label, step, help }) => (
          <label key={key} className="ai-settings-field" title={help}>
            <span>{label}</span>
            <input
              type="number"
              step={step}
              min={0}
              value={config.weights[key]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onChange({ ...config, weights: { ...config.weights, [key]: v } });
              }}
            />
          </label>
        ))}
      </div>

      {config.difficulty === 'expert' && (
        <>
          <div className="ai-settings-row">
            <span className="ai-settings-label">Support cards</span>
          </div>
          <div className="ai-settings-grid">
            {SUPPORT_FIELDS.map(({ key, label, step, help }) => (
              <label key={key} className="ai-settings-field" title={help}>
                <span>{label}</span>
                <input
                  type="number"
                  step={step}
                  min={0}
                  value={config.weights[key]}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) onChange({ ...config, weights: { ...config.weights, [key]: v } });
                  }}
                />
              </label>
            ))}
          </div>
        </>
      )}

      {config.difficulty !== 'normal' && (
        <>
          <div className="ai-settings-row">
            <span className="ai-settings-label">Search effort</span>
          </div>
          <div className="ai-settings-grid">
            {[...SEARCH_FIELDS, BUDGET_FIELD[config.difficulty === 'expert' ? 'expert' : 'hard']].map(({ key, label, step, help }) => (
              <label key={key} className="ai-settings-field" title={help}>
                <span>{label}</span>
                <input
                  type="number"
                  step={step}
                  min={1}
                  value={config.search[key]}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) onChange({ ...config, search: { ...config.search, [key]: v } });
                  }}
                />
              </label>
            ))}
          </div>
        </>
      )}
    </details>
  );
}
