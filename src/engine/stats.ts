import { BOARD_SIZE, chebyshev, mooreAdjacent, orthAdjacent, tileAt, unitAt } from './board';
import { RULES } from './rules';
import { hasKeyword, isSuppressed } from './status';
import type { CombatCtx, Condition, Coord, CountSpec, GameState, PlayerId, TargetSpec, Terrain, TypeName, Unit } from './types';

/** Rules Spec §11 — one favored (+10), one weak (−10) per type, uniform. */
const CHART: Record<TypeName, { favored: Terrain; weak: Terrain }> = {
  Beast: { favored: 'Forest', weak: 'Desert' },
  Insect: { favored: 'Desert', weak: 'Sanctuary' },
  Dragon: { favored: 'Mountain', weak: 'Sea' },
  Avian: { favored: 'Mountain', weak: 'Sea' },
  Aqua: { favored: 'Sea', weak: 'Desert' },
  Warrior: { favored: 'Grassland', weak: 'Shadow' },
  Spellcaster: { favored: 'Shadow', weak: 'Sanctuary' },
  Fiend: { favored: 'Shadow', weak: 'Sanctuary' },
  Undead: { favored: 'Desert', weak: 'Sanctuary' },
  Machine: { favored: 'Mountain', weak: 'Sea' },
  Inferno: { favored: 'Desert', weak: 'Sea' },
  Verdant: { favored: 'Forest', weak: 'Desert' },
  Terra: { favored: 'Mountain', weak: 'Sea' },
};

export function terrainMod(type: TypeName, terrain: Terrain): number {
  const row = CHART[type];
  if (terrain === row.favored) return 10;
  if (terrain === row.weak) return -10;
  return 0;
}

export function favoredTerrain(type: TypeName): Terrain {
  return CHART[type].favored;
}

/**
 * Stat value of one permanent counter. `5` matches the smallest buff step on the locked mid/tens
 * scale, so a card prints a COUNT of counters and the scale lives here in one place.
 */
export const COUNTER_STEP = 5;

function evalCount(s: GameState, unit: Unit, spec: CountSpec): number {
  switch (spec.c) {
    case 'TerrainTilesAround': {
      // TODO(open): "per friendly Forest tile" has no owner concept; sim-1 ruling scopes
      // the count to the unit's surrounding 8 (incl. its own tile).
      const tiles = [...mooreAdjacent(unit.pos), unit.pos];
      return tiles.filter((c) => tileAt(s.board, c).terrain === spec.terrain).length;
    }
    case 'TypeInOwnGraveyard': {
      const grave = s.players[unit.owner].graveyard;
      return grave.filter((cardId) => {
        const def = s.cardDefs[cardId];
        return def?.kind === 'unit' && def.type === spec.type;
      }).length;
    }
  }
}

/**
 * Rules Spec §6 — effective ATK is DERIVED, never stored.
 * base + auras (own passives, leader passives, Frenzy) + timed statuses + terrain.
 * Pure compute-on-read: "recompute on any mutation" holds by construction.
 *
 * In MELEE combat, terrain resolves on the DEFENDED tile for both combatants (§5); in a ranged
 * exchange each combatant reads its own tile; outside combat (display, conditions) a unit reads
 * its own tile.
 */
/**
 * Everything a condition may need to read. Every field is optional, and a condition whose inputs
 * are absent **DENIES** — see `conditionHolds`.
 */
export interface ConditionCtx {
  /** The unit being asked about: an aura's recipient, or an effect's target. */
  subject?: Unit;
  /** Present only inside a combat exchange. */
  combat?: CombatCtx;
  /** The unit that caused the trigger (`OnEnemySummon` and friends). */
  trigger?: Unit;
  /** Controller of the rule, for owner-relative predicates. */
  owner?: PlayerId;
  /**
   * Set by call sites that are THEMSELVES inside `effectiveAtk`.
   *
   * ⚠ `EffAtkAtMost` reads effective ATK, and the aura loops that would evaluate it live inside
   * `effectiveAtk` — so evaluating it there is unbounded recursion. Such conditions deny when
   * this is set, and `validateLeader` / `validateCardRules` reject the combination at load, so
   * denying is a backstop rather than the user-facing behaviour. Gating a DEF aura on ATK stays
   * legal: `effectiveAtk` never calls `effectiveDef`, so there is no cycle in that direction.
   */
  insideAtk?: boolean;
}

/**
 * Which tile's terrain a combatant fights on.
 *
 * Melee is "the tile being moved upon is the battlefield" (§5): the attacker walks into contact
 * and BOTH sides resolve on the defended tile. A shot is not that fight — the shooter never leaves
 * the ground it chose, so it keeps its own terrain, favourable or hostile. (Found in playtesting
 * 2026-08-17: an archer standing in its favoured terrain lost the +10 whenever it fired at
 * anything off that terrain, because this used the battle tile unconditionally.)
 *
 * The defender is on the battle tile by construction (`battleTile = defender.pos`), so `unit.pos`
 * is the same tile for it either way — only the attacker's reading actually changes.
 */
function terrainTile(unit: Unit, ctx?: CombatCtx): Coord {
  if (!ctx || ctx.ranged) return unit.pos;
  return ctx.battleTile;
}

function assertNever(x: never): never {
  throw new Error(`conditionHolds: unhandled condition ${JSON.stringify(x)}`);
}

/**
 * THE condition evaluator — the single place a `Condition` is interpreted.
 *
 * Consolidated 2026-08-05 from FOUR separate implementations (a per-target one in engine.ts, and
 * `selfAuraApplies` / `defAuraConditionHolds` / an open-coded `if`-chain in `effectiveAtk` here)
 * which disagreed with each other about the same condition. The `if`-chain was the dangerous one:
 * having no exhaustiveness check, any condition it did not explicitly name silently meant "no
 * condition at all", so a conditional leader ATK aura applied unconditionally.
 *
 * Two invariants keep that from coming back:
 *   1. The switch is **exhaustive** (`assertNever`), so a new `Condition` member cannot compile
 *      until this function handles it.
 *   2. Missing context **denies**. A condition that cannot be evaluated is never treated as
 *      satisfied, so a validation gap degrades into "the buff does not apply" rather than "the
 *      buff is free".
 */
export function conditionHolds(s: GameState, cond: Condition | undefined, ctx: ConditionCtx): boolean {
  if (!cond) return true;
  const { subject, combat } = ctx;
  switch (cond.k) {
    case 'NoAdjacentEnemy':
      // "Unengaged": nothing hostile in contact. Orthogonal because that is the attack
      // relationship (Combat Resolution) — a diagonal neighbour is staging, not engagement.
      return subject !== undefined && !orthAdjacent(subject.pos).some((c) => {
        const other = unitAt(s, c);
        return other !== undefined && other.owner !== subject.owner;
      });
    case 'EffAtkAtMost':
      if (ctx.insideAtk) return false; // would recurse; see ConditionCtx.insideAtk
      return subject !== undefined && effectiveAtk(s, subject) <= cond.amount;
    case 'DefenderUnmovedThisTurn': {
      // Attacker-side punish predicate: did the thing I am hitting sit still on its own turn?
      if (!combat || combat.role !== 'attacker') return false;
      const opp = s.units[combat.opponentId];
      return opp !== undefined && !opp.movedThisTurn;
    }
    case 'DefenderIsMarked': {
      // Attacker-side: the bonus is for shooting a target your side marked, not for being marked.
      if (!combat || combat.role !== 'attacker') return false;
      const opp = s.units[combat.opponentId];
      return opp !== undefined && opp.statuses.some((st) => st.kind === 'Marked');
    }
    case 'EffAtkAtLeast':
      if (ctx.insideAtk) return false; // would recurse; see ConditionCtx.insideAtk
      return subject !== undefined && effectiveAtk(s, subject) >= cond.amount;
    case 'NearLeader': {
      if (!subject) return false;
      const lead = s.units[`leader${subject.owner}`];
      // A leader is trivially "near" itself; that is the honest reading and costs nothing.
      return lead !== undefined && chebyshev(subject.pos, lead.pos) <= cond.tiles;
    }
    case 'OnFavoredTerrain':
      return subject !== undefined
        && tileAt(s.board, subject.pos).terrain === favoredTerrain(subject.type);
    case 'InEnemyHalf': {
      if (!subject) return false;
      // The middle row is NEUTRAL — it carries both springs, and "first grab isn't first keep"
      // depends on the centre belonging to nobody. On a 7×7: P0 owns rows 1–3, P1 owns 5–7.
      const mid = (BOARD_SIZE + 1) / 2; // row 4
      return subject.owner === 0 ? subject.pos.row > mid : subject.pos.row < mid;
    }
    case 'HoldsSpring':
    case 'LeaderOnSpring': {
      if (ctx.owner === undefined) return false;
      const leaderId = `leader${ctx.owner}`;
      for (let col = 1; col <= BOARD_SIZE; col++) {
        for (let row = 1; row <= BOARD_SIZE; row++) {
          const c = { col, row };
          if (!tileAt(s.board, c).spring) continue;
          const occ = unitAt(s, c);
          if (!occ || occ.owner !== ctx.owner) continue;
          if (cond.k === 'HoldsSpring' || occ.id === leaderId) return true;
        }
      }
      return false;
    }
    case 'LeaderBelowHalfPool':
      return ctx.owner !== undefined
        && s.players[ctx.owner].leaderLife < RULES.startingLife / 2;
    case 'GraveyardCountAtLeast': {
      if (ctx.owner === undefined) return false;
      const n = s.players[ctx.owner].graveyard.filter((cardId) => {
        const d = s.cardDefs[cardId];
        return d?.kind === 'unit' && d.type === cond.type;
      }).length;
      return n >= cond.count;
    }
    case 'IsType':
      return subject !== undefined && cond.types.includes(subject.type);
    case 'LevelAtLeast':
      return subject !== undefined && subject.level >= cond.amount;
    case 'HasKeyword':
      return subject !== undefined && hasKeyword(subject, cond.keyword);
    case 'InDefenseStance':
      // Leaders never take a defense stance (`doSetStance` refuses), so this is always false for
      // one — correct rather than a special case.
      return subject !== undefined && subject.stance === 'defense';
    case 'IsToken':
      return subject !== undefined && subject.isToken;
    default:
      return assertNever(cond);
  }
}

export function effectiveAtk(s: GameState, unit: Unit, ctx?: CombatCtx): number {
  let atk = unit.baseAtk;

  // Terrain: the battle tile in melee combat, this unit's own tile otherwise (see `terrainTile`).
  atk += terrainMod(unit.type, tileAt(s.board, terrainTile(unit, ctx)).terrain);

  // Frenzy: +5 per orthogonally adjacent allied unit, max +20. Continuously re-evaluated.
  if (hasKeyword(unit, 'Frenzy')) {
    const allies = orthAdjacent(unit.pos).filter((c) => {
      const u = unitAt(s, c);
      return u !== undefined && u.owner === unit.owner;
    }).length;
    atk += Math.min(20, 5 * allies);
  }

  // Own passive auras (e.g. Grovecaller +5/Forest-around, Sand Revenant +5/Undead-in-grave).
  // Suppressed silences the unit's OWN text. Leader auras below still reach it — those are
  // another card's rules, and suppression does not make a unit unaffectable.
  const def = s.cardDefs[unit.cardId];
  const ownRules = def?.kind === 'unit' && !isSuppressed(unit) ? def.rules : [];
  for (const rule of ownRules) {
    if (rule.trigger !== 'Passive' || rule.target.t !== 'Self') continue;
    if (!conditionHolds(s, rule.condition, { subject: unit, combat: ctx, owner: unit.owner, insideAtk: true })) continue;
    if (rule.effect.e === 'AuraAtk') atk += rule.effect.amount;
    if (rule.effect.e === 'AuraAtkPerCount') {
      atk += rule.effect.amount * evalCount(s, unit, rule.effect.count);
    }
  }

  // Leader passive auras — standing predicates over current state.
  // NOTE: a "type on favored terrain +10" leader passive STACKS with the terrain mod
  // per rules-as-written; the sim notes' arithmetic mostly counted a single +10.
  // Discrepancy surfaced in the sim tests where it shows.
  for (const p of [0, 1] as const) {
    const leaderDef = s.leaders[p];
    for (const rule of leaderDef.rules) {
      if (rule.trigger !== 'Passive') continue;
      const eff = rule.effect;
      // ⚠ `AuraAtkPerCount` was silently DROPPED here until 2026-08-08 — the loop tested only
      // `AuraAtk`, while `validateLeader` happily accepted the scaling form, so a leader printed
      // with one parsed, type-checked and did nothing. Exactly the defect class the validators
      // exist to catch, hiding in the gap between them and this function. The card-side loop
      // twenty lines above always handled both; now so does this one.
      if (eff.e !== 'AuraAtk' && eff.e !== 'AuraAtkPerCount') continue;
      if (!leaderAuraApplies(s, p, rule.target, unit)) continue;
      // Was an open-coded `if`-chain naming three conditions, so any OTHER condition silently
      // meant "unconditional". Now one exhaustive evaluator, and `insideAtk` bars the conditions
      // that would recurse back into this very function.
      if (!conditionHolds(s, rule.condition, { subject: unit, combat: ctx, owner: p, insideAtk: true })) continue;
      // `evalCount` scopes `TypeInOwnGraveyard` to the RECIPIENT's owner, which `leaderAuraApplies`
      // has already pinned to the leader's own side — so a leader never reads the enemy's pile.
      atk += eff.e === 'AuraAtk' ? eff.amount : eff.amount * evalCount(s, unit, eff.count);
    }
  }

  // Timed statuses (buffs/debuffs with a duration).
  for (const st of unit.statuses) {
    if (st.kind === 'AtkMod') atk += st.amount;
  }

  // Permanent counters. Last because they are the one term that never expires or re-evaluates —
  // they are simply part of what the unit has grown into.
  atk += unit.atkCounters * COUNTER_STEP;

  return atk;
}

/**
 * Effective DEF for two-stat combat: derived exactly like effectiveAtk —
 * base + terrain (on the battle tile in combat) + own passive auras + leader passive auras +
 * timed DefMod statuses.
 *
 * The aura/status loops were added 2026-08-02 when the probe decks got real cards: a two-stat
 * combat model where only ATK can be modified makes half the design space unprintable (a warden
 * leader cannot buff DEF, a breaker cannot strip it). Frenzy is deliberately NOT mirrored — it is
 * an ATK keyword about massing bodies, and a defensive twin is a separate design question.
 */
export function effectiveDef(s: GameState, unit: Unit, ctx?: CombatCtx): number {
  let def = unit.baseDef + terrainMod(unit.type, tileAt(s.board, terrainTile(unit, ctx)).terrain);

  // Own passive auras (self-targeted, like the ATK side).
  //
  // ⚠ This loop had NO condition check until 2026-08-06, so a card's conditional DEF self-aura
  // silently applied unconditionally. It escaped the 2026-08-05 consolidation because that pass
  // unified the four sites that DID evaluate conditions — this was a fifth site with none at all,
  // so there was nothing to find by grepping for condition handling. Caught the moment the first
  // card with such a rule was written (Ironhold's Braced Pikeman).
  //
  // No `insideAtk`: this is the DEF side, and `effectiveAtk` never calls `effectiveDef`, so a
  // condition that reads ATK is safe here.
  const cardDef = s.cardDefs[unit.cardId];
  const ownRules = cardDef?.kind === 'unit' && !isSuppressed(unit) ? cardDef.rules : [];
  for (const rule of ownRules) {
    if (rule.trigger !== 'Passive' || rule.target.t !== 'Self') continue;
    if (rule.effect.e !== 'AuraDef') continue;
    if (!conditionHolds(s, rule.condition, { subject: unit, combat: ctx, owner: unit.owner })) continue;
    def += rule.effect.amount;
  }

  // Leader passive auras — standing predicates over current state (Bastion's Mountain aegis).
  for (const p of [0, 1] as const) {
    for (const rule of s.leaders[p].rules) {
      if (rule.trigger !== 'Passive') continue;
      if (rule.effect.e !== 'AuraDef') continue;
      // Conditional DEF auras are LIVE as of 2026-08-04 (previously `if (rule.condition) continue`
      // dropped them on the floor — a conditional warden passive silently did nothing). No
      // `insideAtk` here: a DEF aura may legally read effective ATK, since `effectiveAtk` never
      // calls `effectiveDef` and so there is no cycle in that direction.
      if (!conditionHolds(s, rule.condition, { subject: unit, combat: ctx, owner: p })) continue;
      if (!leaderAuraApplies(s, p, rule.target, unit)) continue;
      def += rule.effect.amount;
    }
  }

  // Timed statuses (Aegis +DEF, Sunder −DEF).
  for (const st of unit.statuses) {
    if (st.kind === 'DefMod') def += st.amount;
  }

  def += unit.defCounters * COUNTER_STEP;

  return def;
}

function leaderAuraApplies(s: GameState, leaderOwner: 0 | 1, target: TargetSpec, unit: Unit): boolean {
  if (unit.owner !== leaderOwner) return false;
  // SUPPORT RANGE. One check here covers BOTH stats, because effectiveAtk and effectiveDef share
  // this gate — which is the whole reason the radius lives here rather than at the two call sites.
  //
  // `Self` (distance 0) and `AdjacentFriendlies` (already orthogonal-1) pass this trivially at any
  // radius ≥ 1. That is correct, not redundant: the check must still run for them so a radius of
  // 0-meaning-off stays distinguishable from a genuinely tiny radius later.
  if (RULES.supportRange > 0) {
    const lead = s.units[`leader${leaderOwner}`];
    if (!lead || chebyshev(unit.pos, lead.pos) > RULES.supportRange) return false;
  }
  if (target.t === 'Self') {
    // The LEADER buffing itself — "Vharos +10 while on Mountain". Explicitly sanctioned by the
    // vault's The Leader ("fixed base attack… can be raised by abilities, terrain, or buff
    // cards"), and it is what turns a sturdy stat leader's ATK from a constant into a positional
    // decision. Rejected here until 2026-08-05, which is part of why 8 of 14 leader passives were
    // the same card.
    return unit.id === `leader${leaderOwner}`;
  }
  if (target.t === 'AdjacentFriendlies') {
    // The positional aura: the leader's POSITION becomes the passive, so projecting power means
    // walking the king forward. The risk loop stated as a rule rather than implied.
    const lead = s.units[`leader${leaderOwner}`];
    return lead !== undefined
      && orthAdjacent(lead.pos).some((c) => c.col === unit.pos.col && c.row === unit.pos.row);
  }
  if (target.t === 'FriendlyOfTypes') {
    return target.types.includes(unit.type);
  }
  if (target.t === 'FriendlyOfTypesOnTerrain') {
    // Own-tile predicate: "friendly Undead on Desert" reads where the unit STANDS,
    // independent of where a battle resolves (this is what lets Apex keep Briar's +10
    // while attacking onto neutral ground in sim 6).
    return target.types.includes(unit.type) && tileAt(s.board, unit.pos).terrain === target.terrain;
  }
  return false;
}
