import { mooreAdjacent, orthAdjacent, tileAt, unitAt } from './board';
import type { CombatCtx, CountSpec, GameState, TargetSpec, Terrain, TypeName, Unit } from './types';

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
 * In combat, terrain resolves on the DEFENDED tile for both combatants (§5);
 * outside combat (display, conditions) a unit reads its own tile.
 */
export function effectiveAtk(s: GameState, unit: Unit, ctx?: CombatCtx): number {
  let atk = unit.baseAtk;

  // Terrain: battle tile in combat, own tile otherwise.
  const terrainTile = ctx ? ctx.battleTile : unit.pos;
  atk += terrainMod(unit.type, tileAt(s.board, terrainTile).terrain);

  // Frenzy: +5 per orthogonally adjacent allied unit, max +20. Continuously re-evaluated.
  if (unit.keywords.includes('Frenzy')) {
    const allies = orthAdjacent(unit.pos).filter((c) => {
      const u = unitAt(s, c);
      return u !== undefined && u.owner === unit.owner;
    }).length;
    atk += Math.min(20, 5 * allies);
  }

  // Own passive auras (e.g. Grovecaller +5/Forest-around, Sand Revenant +5/Undead-in-grave).
  const def = s.cardDefs[unit.cardId];
  const ownRules = def?.kind === 'unit' ? def.rules : [];
  for (const rule of ownRules) {
    if (rule.trigger !== 'Passive' || rule.target.t !== 'Self') continue;
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
      if (eff.e !== 'AuraAtk') continue;
      if (!leaderAuraApplies(s, p, rule.target, unit)) continue;
      if (rule.condition?.k === 'DefenderUnmovedThisTurn') {
        if (!ctx || ctx.role !== 'attacker') continue;
        const opp = s.units[ctx.opponentId];
        if (!opp || opp.movedThisTurn) continue;
      }
      atk += eff.amount;
    }
  }

  // Timed statuses (buffs/debuffs with a duration).
  for (const st of unit.statuses) {
    if (st.kind === 'AtkMod') atk += st.amount;
  }

  return atk;
}

function leaderAuraApplies(s: GameState, leaderOwner: 0 | 1, target: TargetSpec, unit: Unit): boolean {
  if (unit.owner !== leaderOwner) return false;
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
