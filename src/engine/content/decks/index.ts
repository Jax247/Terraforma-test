// Playable test-deck registry: four archetypes, one per engine subsystem focus.
// Deck legality here mirrors the vault rules: 40–50 cards, ≤3 copies, fusion
// pool as a separate registered zone, and a Deck Cost budget (proposed values —
// the vault leaves concrete DC numbers open).

import { makeBoard } from '../../board';
import type { Board, CardDef, Coord, LeaderDef, Rule, TokenDef, Trigger } from '../../types';
import { POC_TOKENS } from '../poc';
import type { DeckDef } from './deckDef';
import { WILDGROWTH_DECK } from './wildgrowth';
import { GRAVEMARCH_DECK } from './gravemarch';
import { SKYFIRE_DECK } from './skyfire';
import { TIDECALLER_DECK } from './tidecaller';
import { HIVEBROOD_DECK, HIVEBROOD_TOKENS } from './hivebrood';
import { DRAGONSPIRE_DECK } from './dragonspire';
import { DUNEFORGED_DECK } from './duneforged';
import { ANVIL_DECK } from './anvil';
import { PIERCER_DECK } from './piercer';
import { MIXED_DECK } from './mixed';
import { REDMARK_DECK } from './redmark';
import { IRONHOLD_DECK } from './ironhold';

export type { DeckDef } from './deckDef';
export { WILDGROWTH_DECK, WILDGROWTH_EXTRA_CARDS } from './wildgrowth';
export { GRAVEMARCH_DECK, GRAVEMARCH_EXTRA_CARDS } from './gravemarch';
export { SKYFIRE_DECK, SKYFIRE_EXTRA_CARDS } from './skyfire';
export { TIDECALLER_DECK, TIDECALLER_EXTRA_CARDS } from './tidecaller';
export { HIVEBROOD_DECK, HIVEBROOD_CARDS, HIVEBROOD_TOKENS, BROOD_MATRON } from './hivebrood';
export { DRAGONSPIRE_DECK, DRAGONSPIRE_CARDS, VHAROS } from './dragonspire';
export { DUNEFORGED_DECK } from './duneforged';
export { ANVIL_DECK } from './anvil';
export { PIERCER_DECK } from './piercer';
export { MIXED_DECK } from './mixed';
export { REDMARK_DECK, SABLE } from './redmark';
export { IRONHOLD_DECK, IRONHOLD_CARDS, RHODAN } from './ironhold';

export const DECKS: DeckDef[] = [
  WILDGROWTH_DECK, GRAVEMARCH_DECK, SKYFIRE_DECK, TIDECALLER_DECK,
  HIVEBROOD_DECK, DRAGONSPIRE_DECK, DUNEFORGED_DECK, REDMARK_DECK, IRONHOLD_DECK,
];

/**
 * DEFENSE_EXPERIMENT probe decks — the two-stat gauntlet the A/B harness runs. Deliberately
 * NOT in `DECKS`: their cards carry explicit DEF and only make sense while the flag is on, so
 * they stay out of the standard pool (deck viewer, deck builder, online lobby) and are offered
 * only by the setup screen once defense mode is enabled. Anvil busts the DC cap on purpose.
 */
export const DEFENSE_DECKS: DeckDef[] = [MIXED_DECK, ANVIL_DECK, PIERCER_DECK];

/** Every def any registered deck references — the registry a game should load. */
export const DECK_CARDS: Record<string, CardDef> = Object.assign({}, ...DECKS.map((d) => d.cards));

export const DECK_TOKENS: Record<string, TokenDef> = { ...POC_TOKENS, ...HIVEBROOD_TOKENS };

export const DECK_SIZE_MIN = 40;
export const DECK_SIZE_MAX = 50;
export const COPY_LIMIT = 3;
export const STANDARD_DC_CAP = 110;

/** Total Deck Cost: main list + fusion pool (leader and tokens carry no DC). */
export function deckCost(deck: DeckDef): number {
  const dc = (id: string) => deck.cards[id]?.dc ?? 0;
  return deck.list.reduce((sum, id) => sum + dc(id), 0)
    + deck.fusionPool.reduce((sum, id) => sum + dc(id), 0);
}

/** Vault-rule legality check. Returns violations; empty array = legal. */
export function validateDeck(deck: DeckDef): string[] {
  const v: string[] = [];
  if (deck.list.length < DECK_SIZE_MIN || deck.list.length > DECK_SIZE_MAX) {
    v.push(`deck size ${deck.list.length} outside ${DECK_SIZE_MIN}–${DECK_SIZE_MAX}`);
  }
  const counts = new Map<string, number>();
  for (const id of deck.list) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    if (n > COPY_LIMIT) v.push(`${id}: ${n} copies exceeds the ${COPY_LIMIT}-copy limit`);
    const def = deck.cards[id];
    if (!def) v.push(`${id}: unknown card id`);
    else if (def.kind === 'unit' && def.fusion) v.push(`${id}: fusion cards belong in the fusion pool, not the main deck`);
  }
  for (const id of deck.fusionPool) {
    const def = deck.cards[id];
    if (!def) { v.push(`fusion pool ${id}: unknown card id`); continue; }
    if (def.kind !== 'unit' || !def.fusion) { v.push(`fusion pool ${id}: not a fusion unit`); continue; }
    for (const mat of def.fusion.materials) {
      if (!deck.list.includes(mat)) v.push(`fusion pool ${id}: material ${mat} missing from the main deck`);
    }
  }
  const cost = deckCost(deck);
  if (cost > STANDARD_DC_CAP) v.push(`deck cost ${cost} exceeds the Standard cap ${STANDARD_DC_CAP}`);
  return v;
}

// ---------------------------------------------------------------------------
// Rule validation — leaders and cards
// ---------------------------------------------------------------------------

/**
 * Triggers that actually have a leader dispatch site. Anything else parses, type-checks and
 * NEVER RUNS — the failure mode this whole function exists to make loud. Cross-check when
 * touching the fire* functions in engine.ts:
 *
 *   Passive         stats.ts effectiveAtk / effectiveDef
 *   StartOfTurn     fireStartOfTurn
 *   EndOfTurn       fireEndOfTurn
 *   OnMove          fireOnMove       (leader's own move only)
 *   OnCapture       fireOnCapture    (scoped; leader default = friendly)
 *   OnKill          fireOnKill       (wired 2026-08-04)
 *   OnSummon        fireLeaderOnSummon (added 2026-08-04; hard summons from hand only)
 *   OnAttack/Defend fireCombatTriggers (leaders fight, so both apply)
 *   OnAllyDeath / OnSpellCast / OnAbilityCast / OnTrapTriggered / OnSummonAlly / OnEnemySummon
 *                   fireBoardTrigger — sweeps every unit AND both leaders
 *
 * OnDeath is absent on purpose: a leader is never destroyed as a piece (LP is the pool), so a
 * leader OnDeath rule could not fire even in principle. OnFlip likewise — a leader is never set
 * face-down.
 */
const LEADER_TRIGGERS = new Set<Trigger>([
  'Passive', 'StartOfTurn', 'EndOfTurn', 'OnMove', 'OnCapture', 'OnKill', 'OnSummon',
  'OnAttack', 'OnDefend', 'OnAllyDeath', 'OnSpellCast', 'OnAbilityCast', 'OnTrapTriggered',
  'OnSummonAlly', 'OnEnemySummon', 'OnTerrainPainted',
]);

/**
 * Triggers with a dispatch site for a UNIT CARD's rules. Every `Trigger` member except `Passive`
 * belongs here — a card's Passive is read by `effectiveAtk`/`effectiveDef` only for the narrow
 * self-aura case, which `validateCardRules` checks separately.
 *
 *   OnSummon/OnDeath/OnKill/OnMove   doSummon / destroyUnit / fireOnKill / fireOnMove
 *   OnCapture                        fireOnCapture (scoped; unit default = self)
 *   StartOfTurn / EndOfTurn          fireStartOfTurn / fireEndOfTurn
 *   OnFlip                           flipSetUnitUp
 *   OnAttack / OnDefend              fireCombatTriggers
 *   the six board triggers           fireBoardTrigger
 */
const CARD_TRIGGERS = new Set<Trigger>([
  'OnSummon', 'OnDeath', 'OnKill', 'OnMove', 'OnCapture', 'Passive', 'StartOfTurn', 'EndOfTurn',
  'OnFlip', 'OnAttack', 'OnDefend', 'OnAllyDeath', 'OnSpellCast', 'OnAbilityCast',
  'OnTrapTriggered', 'OnSummonAlly', 'OnEnemySummon', 'OnTerrainPainted',
]);

/** Triggers that read `when.scope`. Stating a scope anywhere else is a silent no-op. */
const SCOPED_TRIGGERS = new Set<Trigger>([
  'OnCapture', 'OnAllyDeath', 'OnTrapTriggered', 'OnTerrainPainted',
]);

/** The only trigger that reads `when.terrain`. */
const TERRAIN_FILTER_TRIGGERS = new Set<Trigger>(['OnTerrainPainted']);

/**
 * Shared by both validators: a `when` qualifier stated on a trigger that cannot read it is a
 * silent no-op, which is the exact defect class these validators exist to catch.
 */
function whenViolations(rule: Rule, where: string): string[] {
  const v: string[] = [];
  if (rule.when?.scope && !SCOPED_TRIGGERS.has(rule.trigger)) {
    v.push(`${where}: trigger ${rule.trigger} ignores when.scope — stating "${rule.when.scope}" here is a silent no-op`);
  }
  if (rule.when?.terrain && !TERRAIN_FILTER_TRIGGERS.has(rule.trigger)) {
    v.push(`${where}: trigger ${rule.trigger} ignores when.terrain — stating "${rule.when.terrain}" here is a silent no-op`);
  }
  return v;
}

/** Aura effects are Passive-only wherever they appear — on a card as on a leader. */
const AURA_EFFECTS = new Set(['AuraAtk', 'AuraAtkPerCount', 'AuraDef']);

/** The only effects a Passive leader rule may carry — the three stats.ts actually reads. */
const LEADER_AURA_EFFECTS = new Set(['AuraAtk', 'AuraAtkPerCount', 'AuraDef']);

/**
 * The only targets `leaderAuraApplies` resolves; every other TargetSpec returns false there.
 *
 * `Self` (the leader buffing itself) and `AdjacentFriendlies` (the positional aura) were added
 * 2026-08-05 — their absence is a large part of why 8 of 14 leader passives were the same
 * "type on favored terrain +10" card. Keep in step with `leaderAuraApplies` in stats.ts.
 */
const LEADER_AURA_TARGETS = new Set([
  'FriendlyOfTypes', 'FriendlyOfTypesOnTerrain', 'Self', 'AdjacentFriendlies',
]);

/** Predicates about the OPPONENT in a combat exchange — meaningless on a DEF aura. */
const ATTACKER_SIDE_CONDITIONS = new Set(['DefenderUnmovedThisTurn', 'DefenderIsMarked']);

/**
 * Conditions that read effective ATK.
 *
 * ⚠ These may NOT gate an `AuraAtk` rule. The aura loops that would evaluate them live inside
 * `effectiveAtk`, so doing so is `effectiveAtk → conditionHolds → effectiveAtk` — unbounded
 * recursion. `conditionHolds` denies them via `ConditionCtx.insideAtk` as a runtime backstop;
 * this is the load-time rejection that keeps content from relying on that.
 *
 * Gating a DEF aura on ATK stays legal — `effectiveAtk` never calls `effectiveDef`.
 */
const ATK_READING_CONDITIONS = new Set(['EffAtkAtMost', 'EffAtkAtLeast']);

/** Shared by both validators: rule-level condition and effect misuse. */
function conditionViolations(rule: Rule, where: string): string[] {
  const v: string[] = [];
  // ⚠ `Search` mode 'choose' used to be rejected here: the engine had no Action payload that could
  // name a CARD rather than a Coord, so a tutor had nothing to choose WITH. The 2026-08-08
  // card-choice pass added `Action.chosenCards`, so deliberate search is now a real, playable mode
  // and the rejection is gone. See `execLine`'s Search branch and `cardCandidates` in targeting.ts.
  if (rule.effect.e === 'AuraAtk' && rule.condition && ATK_READING_CONDITIONS.has(rule.condition.k)) {
    v.push(`${where}: ${rule.condition.k} reads effective ATK and cannot gate an ATK aura — it would recurse`);
  }
  if (rule.when?.triggerUnit && !TRIGGER_UNIT_TRIGGERS.has(rule.trigger)) {
    v.push(`${where}: trigger ${rule.trigger} carries no triggering unit — when.triggerUnit is a silent no-op`);
  }
  return v;
}

/**
 * Triggers that bind a triggering UNIT, and so can be gated by `when.triggerUnit`.
 * `OnTerrainPainted` is deliberately absent: it binds a tile, not a unit.
 */
const TRIGGER_UNIT_TRIGGERS = new Set<Trigger>([
  'OnSummonAlly', 'OnEnemySummon', 'OnCapture', 'OnAttack', 'OnDefend',
]);

/**
 * Static check that every rule on a leader has a live firing path. Returns violations; empty
 * array = every rule can actually run.
 *
 * Motivated by four real defects found on 2026-08-04, all of the same shape — content that
 * parsed, type-checked and silently did nothing (leader OnKill had no dispatch, leader OnSummon
 * had no hook, conditional DEF auras were dropped, and a punish-predicate could never deny).
 * A type system cannot catch "this trigger has no call site", so it is asserted here instead.
 */
export function validateLeader(leader: LeaderDef): string[] {
  const v: string[] = [];
  const where = (i: number) => `${leader.id} rule ${i}`;
  leader.rules.forEach((rule, i) => {
    if (!LEADER_TRIGGERS.has(rule.trigger)) {
      v.push(`${where(i)}: trigger ${rule.trigger} has no leader dispatch site — it would never fire`);
      return;
    }
    const isAura = LEADER_AURA_EFFECTS.has(rule.effect.e);
    if (rule.trigger === 'Passive') {
      if (!isAura) {
        v.push(`${where(i)}: Passive leader rules must carry an aura effect (${[...LEADER_AURA_EFFECTS].join('/')}), got ${rule.effect.e}`);
        return;
      }
      if (!LEADER_AURA_TARGETS.has(rule.target.t)) {
        v.push(`${where(i)}: leader aura target ${rule.target.t} is not resolved by leaderAuraApplies — the aura would never apply`);
      }
      if (rule.effect.e === 'AuraDef' && rule.condition && ATTACKER_SIDE_CONDITIONS.has(rule.condition.k)) {
        v.push(`${where(i)}: ${rule.condition.k} is an attacker-side predicate and has no meaning on a DEF aura`);
      }
    } else if (isAura) {
      v.push(`${where(i)}: aura effects are Passive-only, but the trigger is ${rule.trigger}`);
    }
    v.push(...whenViolations(rule, where(i)));
    v.push(...conditionViolations(rule, where(i)));
  });
  return v;
}

/**
 * The card-side twin of `validateLeader`, added when the trigger vocabulary tripled on
 * 2026-08-04. Same motivation, larger blast radius: every defect found that day was content that
 * parsed, type-checked and silently never ran, and a type system cannot catch "this trigger has
 * no call site." With ~17 triggers instead of 7, guessing wrong is now easy.
 *
 * Returns violations; empty array = every rule on the card can actually run.
 */
export function validateCardRules(def: CardDef): string[] {
  if (def.kind !== 'unit') return []; // spells/traps carry effect LINES, which have no trigger
  const v: string[] = [];
  const where = (i: number) => `${def.id} rule ${i}`;
  def.rules.forEach((rule, i) => {
    if (!CARD_TRIGGERS.has(rule.trigger)) {
      v.push(`${where(i)}: trigger ${rule.trigger} has no card dispatch site — it would never fire`);
      return;
    }
    const isAura = AURA_EFFECTS.has(rule.effect.e);
    if (rule.trigger === 'Passive') {
      if (!isAura) {
        v.push(`${where(i)}: Passive card rules must carry an aura effect (${[...AURA_EFFECTS].join('/')}), got ${rule.effect.e}`);
      } else if (rule.target.t !== 'Self') {
        // ⚠ A CARD's aura can only buff ITSELF. `effectiveAtk`/`effectiveDef` read a unit's own
        // rules with `rule.target.t !== 'Self' -> continue`, and there is no second loop that
        // sweeps OTHER units' card auras — only LEADER auras reach across the board. So a
        // "banner" printed on a card is inert, however it is targeted.
        v.push(`${where(i)}: a card aura targeting ${rule.target.t} is INERT — only Self-targeted card auras are read (leader auras are the cross-board kind)`);
      }
    } else if (isAura) {
      v.push(`${where(i)}: aura effects are Passive-only, but the trigger is ${rule.trigger}`);
    }
    v.push(...whenViolations(rule, where(i)));
    v.push(...conditionViolations(rule, where(i)));
  });
  return v;
}

/**
 * Arena board: symmetric across row 4, seeding every registered archetype's
 * terrain — Forest and Mountain flanks, a Desert band, Sea edge tiles, Shadow
 * corners, Grassland center. Springs at (2,4)/(6,4) come from makeBoard.
 */
export function makeArenaBoard(): Board {
  return makeBoard((c: Coord) => {
    if ((c.row === 1 || c.row === 7) && (c.col === 1 || c.col === 7)) return 'Shadow';
    if ((c.row === 2 || c.row === 6) && (c.col === 1 || c.col === 2)) return 'Forest';
    if ((c.row === 2 || c.row === 6) && (c.col === 6 || c.col === 7)) return 'Mountain';
    if ((c.row === 3 || c.row === 5) && c.col >= 3 && c.col <= 5) return 'Desert';
    if (c.row === 4 && (c.col === 1 || c.col === 7)) return 'Sea';
    if (c.row === 4 && c.col === 4) return 'Grassland';
    return 'Normal';
  });
}
