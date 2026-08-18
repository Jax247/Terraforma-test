// Target enumeration — the single source of truth for binding Action.targets.
// Pure TS, no React. Derives what a card/ability needs EFFECT-FIRST (some effects
// consume chosen[] with their own semantics regardless of the declared TargetSpec),
// then by TargetSpec. Both switches are exhaustive with `never` asserts so new
// vocabulary breaks the build here instead of failing at runtime.

import { BOARD_SIZE, chebyshev, inBounds, isOpen, leaderOf, mooreAdjacent, orthAdjacent, unitAt } from './board';
import { abilityReach, findFusionResult, legalActions, spellSpCost, unitSlots } from './engine';
import { RULES } from './rules';
import type {
  Action,
  Coord,
  Effect,
  GameState,
  PlayerId,
  SearchFilter,
  SpellEffectLine,
  TargetSpec,
  TypeName,
  Unit,
} from './types';

// ---------------------------------------------------------------------------
// What a line of effects asks the player to choose
// ---------------------------------------------------------------------------

export type TargetRequest =
  | { kind: 'none' }
  /** 1 coord on a unit. excludeLeaders when the effect hard-fails on leaders (Destroy/Transform).
   *  `enemyOnly` / `friendlyOnly` are the two sides of the same axis — a card asking for both is a
   *  content error, and `combinedRequest` throws on it. */
  | { kind: 'unit'; enemyOnly: boolean; friendlyOnly: boolean; excludeLeaders: boolean }
  /** 3 coords, straight contiguous line (diagonals allowed). */
  | { kind: 'line3' }
  /** 1 anchor coord (top-left for 2x2, center for 3x3). wantsUnits prunes anchors to those covering a unit. */
  | { kind: 'area'; size: 2 | 3; wantsUnits: boolean; excludeLeaders: boolean }
  /** 1 empty tile in the owner's leader summon zone (Moore-8). */
  | { kind: 'raiseTile'; type: TypeName }
  /** 2 coords: orthogonally adjacent friendly units forming a registered fusion pair. */
  | { kind: 'fusePair' };

/**
 * What a line of effects asks the player to choose from a ZONE, as opposed to from the board.
 *
 * Deliberately a SECOND axis rather than another `TargetRequest` member. The two are independent —
 * a chosen Raise picks a graveyard card *and* a destination tile — so folding them together would
 * turn both exhaustive switches into a cross product, and would change `targetsNeeded`, which the
 * GUI calls in four places to drive its tile picker.
 *
 * Both sources are OWNER-SCOPED (your graveyard, your deck), which is what keeps card choice
 * compatible with fog of war: `sanitize` masks only the opponent's zones, and graveyards are
 * public anyway.
 */
export type CardRequest =
  | { kind: 'none' }
  /** `RaiseFromGraveyard`: which body comes back. */
  | { kind: 'graveyard'; type: TypeName }
  /** `Search` mode 'choose': which card is tutored. */
  | { kind: 'deck'; filter: SearchFilter };

/** Reach filter for located casts/flips/abilities: every chosen coord within Chebyshev <= 1 of where it resolves. */
export interface ReachConstraint {
  resolvePos: Coord;
  /** Chebyshev ceiling. Defaults to 1 (located spells); leader abilities pass `abilityReach()`. */
  max?: number;
}

function assertNever(x: never, what: string): never {
  throw new Error(`targeting.ts does not handle ${what}: ${JSON.stringify(x)}`);
}

/** Request keyed on TargetSpec, for effects that resolve their declared target normally. */
function byTarget(target: TargetSpec, wantsUnits: boolean, excludeLeaders: boolean): TargetRequest {
  switch (target.t) {
    case 'ChosenUnit':
      return { kind: 'unit', enemyOnly: false, friendlyOnly: false, excludeLeaders };
    case 'ChosenEnemy':
      return { kind: 'unit', enemyOnly: true, friendlyOnly: false, excludeLeaders };
    case 'ChosenFriendly':
      return { kind: 'unit', enemyOnly: false, friendlyOnly: true, excludeLeaders };
    case 'Line3':
      return { kind: 'line3' };
    case 'Area2x2':
      return { kind: 'area', size: 2, wantsUnits, excludeLeaders };
    case 'Area3x3':
      return { kind: 'area', size: 3, wantsUnits, excludeLeaders };
    case 'Self':
    case 'ThisTile':
    case 'DestinationTile':
    case 'TilesMovedThrough':
    case 'TriggeringUnit':
    // Trigger-supplied, like TriggeringUnit: the engine binds these, the player never picks them.
    case 'TriggeringTile':
    case 'UnitOnTriggeringTile':
    case 'Attacker':
    case 'AdjacentEnemies':
    case 'AdjacentEmptyTiles':
    case 'EmptyTileNear':
    case 'FriendlyOfTypes':
    case 'FriendlyOfTypesOnTerrain':
    // Engine-resolved from board state; the player never picks these either.
    case 'AdjacentFriendlies':
    case 'AllEnemies':
    case 'EnemiesOfTypes':
    case 'AllUnitsOnTerrain':
    case 'TilesAroundLeader':
      return { kind: 'none' };
    default:
      return assertNever(target, 'TargetSpec');
  }
}

/** What one effect line asks the player to choose. Effect-first: Raise/Fuse consume chosen[] with their own semantics. */
export function lineRequest(line: SpellEffectLine): TargetRequest {
  const eff: Effect = line.effect;
  switch (eff.e) {
    case 'RaiseFromGraveyard':
      return { kind: 'raiseTile', type: eff.type }; // chosen[0] = destination tile, not the declared target
    case 'FuseAdjacentFriendly':
      return { kind: 'fusePair' }; // chosen[0..1] = the two materials
    case 'Draw':
    case 'GainSP':
    case 'AuraAtk':
    case 'AuraAtkPerCount':
    case 'AuraDef':
    // Search resolves entirely inside the deck, so it asks for no TILE in either mode. Its
    // 'choose' mode asks for a card instead — that lives on the other axis, in `cardRequest`.
    case 'Search':
      return { kind: 'none' }; // target is ignored by execution
    case 'PaintTerrain':
    case 'SummonToken':
      return byTarget(line.target, false, false); // resolves tiles
    case 'Damage':
    case 'ApplyStatus':
    case 'GrantWallPass':
    case 'GrantKeyword':
    case 'AddCounter':
    case 'Push':
    case 'Pull':
    case 'GrantMove':
      return byTarget(line.target, true, false); // resolves units; leaders are legal targets
    case 'Destroy':
    case 'Transform':
      return byTarget(line.target, true, true); // engine hard-fails these on leaders
    default:
      return assertNever(eff, 'Effect');
  }
}

/**
 * Merge the requests of all effect lines: the engine binds ONE chosen[] shared by
 * every line, so mixed chosen-target kinds on a single card are unsupported.
 * Throws on incompatible mixes — the content-lint test surfaces this at authoring time.
 */
export function combinedRequest(effects: SpellEffectLine[]): TargetRequest {
  let acc: TargetRequest = { kind: 'none' };
  for (const line of effects) {
    const req = lineRequest(line);
    if (req.kind === 'none') continue;
    if (acc.kind === 'none') {
      acc = req;
      continue;
    }
    if (acc.kind === 'unit' && req.kind === 'unit') {
      const wantsEnemy: boolean = acc.enemyOnly || req.enemyOnly;
      const wantsFriendly: boolean = acc.friendlyOnly || req.friendlyOnly;
      if (wantsEnemy && wantsFriendly) {
        throw new Error('incompatible chosen-target mix: one chosen[] cannot be both enemy-only and friendly-only');
      }
      acc = {
        kind: 'unit',
        enemyOnly: wantsEnemy,
        friendlyOnly: wantsFriendly,
        excludeLeaders: acc.excludeLeaders || req.excludeLeaders,
      };
    } else if (acc.kind === 'area' && req.kind === 'area' && acc.size === req.size) {
      acc = {
        kind: 'area',
        size: acc.size,
        // Only prune anchors to unit-covering ones when EVERY line wants units,
        // otherwise a tile line (paint) would lose legal anchors.
        wantsUnits: acc.wantsUnits && req.wantsUnits,
        excludeLeaders: acc.excludeLeaders || req.excludeLeaders,
      };
    } else if (acc.kind === 'line3' && req.kind === 'line3') {
      // compatible
    } else if (acc.kind === 'raiseTile' && req.kind === 'raiseTile' && acc.type === req.type) {
      // compatible
    } else if (acc.kind === 'fusePair' && req.kind === 'fusePair') {
      // compatible
    } else {
      throw new Error(`incompatible chosen-target mix: ${acc.kind} + ${req.kind} (one chosen[] is shared by all effect lines)`);
    }
  }
  return acc;
}

/**
 * The card-choice twin of `combinedRequest`. One chosen card is shared by every line, exactly as
 * one `chosen[]` is, so two lines asking for different zones is a content error.
 */
export function cardRequest(effects: SpellEffectLine[]): CardRequest {
  let acc: CardRequest = { kind: 'none' };
  for (const line of effects) {
    const eff = line.effect;
    let req: CardRequest = { kind: 'none' };
    if (eff.e === 'RaiseFromGraveyard') req = { kind: 'graveyard', type: eff.type };
    else if (eff.e === 'Search' && eff.mode === 'choose') req = { kind: 'deck', filter: eff.filter };
    if (req.kind === 'none') continue;
    if (acc.kind === 'none') { acc = req; continue; }
    if (acc.kind !== req.kind) {
      throw new Error(`incompatible chosen-card mix: ${acc.kind} + ${req.kind} (one chosen card is shared by all effect lines)`);
    }
  }
  return acc;
}

/**
 * The distinct card ids a `CardRequest` may name, in a stable order.
 *
 * DISTINCT, because copies of a card are interchangeable — three Duneshamblers in the graveyard are
 * one choice, not three. That is what keeps the bots' action space from multiplying: measured on
 * Gravemarch, adding chosen Raise costs +0.7% mean bound actions.
 *
 * Sorted by id so enumeration is deterministic across runs, matching `byColRow` for tiles.
 */
export function cardCandidates(s: GameState, owner: PlayerId, req: CardRequest): string[] {
  switch (req.kind) {
    case 'none':
      return [];
    case 'graveyard': {
      const ids = s.players[owner].graveyard.filter((id) => {
        const def = s.cardDefs[id];
        return def?.kind === 'unit' && def.type === req.type;
      });
      return [...new Set(ids)].sort();
    }
    case 'deck': {
      const f = req.filter;
      const ids = s.players[owner].deck.filter((id) => {
        const def = s.cardDefs[id];
        if (!def) return false; // unknown id, or a fog-masked deck: never a match, never a throw
        if (f.kind && def.kind !== f.kind) return false;
        if (f.type && !(def.kind === 'unit' && def.type === f.type)) return false;
        if (f.keyword && !(def.kind === 'unit' && def.keywords.includes(f.keyword))) return false;
        if (f.maxLevel !== undefined && !(def.kind === 'unit' && def.level <= f.maxLevel)) return false;
        return true;
      });
      return [...new Set(ids)].sort();
    }
    default:
      return assertNever(req, 'CardRequest');
  }
}

/** How many chosen coords an effect list needs. Single source of truth for the UI's target picker. */
export function targetsNeeded(effects: SpellEffectLine[]): number {
  const req = combinedRequest(effects);
  switch (req.kind) {
    case 'none':
      return 0;
    case 'unit':
    case 'area':
    case 'raiseTile':
      return 1;
    case 'fusePair':
      return 2;
    case 'line3':
      return 3;
    default:
      return assertNever(req, 'TargetRequest');
  }
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

function byColRow(a: Coord, b: Coord): number {
  return a.col - b.col || a.row - b.row;
}

/** All straight contiguous 3-tile lines on the board, one canonical direction each. */
function allLines3(): Coord[][] {
  const out: Coord[][] = [];
  // Directions cover every line once: right, down, down-right, down-left.
  const dirs = [
    { dc: 1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: 1, dr: 1 },
    { dc: 1, dr: -1 },
  ];
  for (let col = 1; col <= BOARD_SIZE; col++) {
    for (let row = 1; row <= BOARD_SIZE; row++) {
      for (const { dc, dr } of dirs) {
        const line = [0, 1, 2].map((i) => ({ col: col + dc * i, row: row + dr * i }));
        if (line.every(inBounds)) out.push(line);
      }
    }
  }
  return out;
}

const LINES3: Coord[][] = allLines3();

function inReach(c: Coord, reach: ReachConstraint | undefined): boolean {
  if (!reach) return true;
  // `max` defaults to 1 — located SPELL travel, which Support Range deliberately does not touch.
  // Only leader ABILITIES pass a wider max, and they take it from `abilityReach()` so this
  // enumeration and the engine's own check in `doActivateAbility` cannot drift apart.
  return chebyshev(c, reach.resolvePos) <= (reach.max ?? 1);
}

function areaFootprint(anchor: Coord, size: 2 | 3): Coord[] {
  const offsets =
    size === 2
      ? [[0, 0], [1, 0], [0, 1], [1, 1]]
      : [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  return offsets.map(([dc, dr]) => ({ col: anchor.col + dc!, row: anchor.row + dr! })).filter(inBounds);
}

function sortedUnits(s: GameState): Unit[] {
  return Object.values(s.units).sort((a, b) => byColRow(a.pos, b.pos));
}

/** Every valid chosen[] for a request, reach-filtered, in deterministic board order. `[[]]` when nothing to choose. */
export function enumerateTargetSets(
  s: GameState,
  owner: PlayerId,
  req: TargetRequest,
  reach?: ReachConstraint,
): Coord[][] {
  switch (req.kind) {
    case 'none':
      return [[]];
    case 'unit': {
      return sortedUnits(s)
        .filter((u) => !(req.enemyOnly && u.owner === owner))
        .filter((u) => !(req.friendlyOnly && u.owner !== owner))
        .filter((u) => !(req.excludeLeaders && u.isLeader))
        .filter((u) => inReach(u.pos, reach))
        .map((u) => [u.pos]);
    }
    case 'line3': {
      return LINES3.filter((line) => line.every((c) => inReach(c, reach))).map((line) =>
        line.map((c) => ({ ...c })),
      );
    }
    case 'area': {
      const anchors: Coord[] = [];
      for (let col = 1; col <= BOARD_SIZE; col++) {
        for (let row = 1; row <= BOARD_SIZE; row++) {
          const anchor = { col, row };
          if (!inReach(anchor, reach)) continue;
          const footprint = areaFootprint(anchor, req.size);
          if (req.excludeLeaders && footprint.some((c) => unitAt(s, c)?.isLeader)) continue;
          if (req.wantsUnits && !footprint.some((c) => unitAt(s, c))) continue;
          anchors.push(anchor);
        }
      }
      return anchors.map((a) => [a]);
    }
    case 'raiseTile': {
      // Pre-checks mirror the engine so an emitted Raise can never throw downstream.
      if (unitSlots(s, owner) >= RULES.unitCap) return [];
      const hasMatch = s.players[owner].graveyard.some((id) => {
        const def = s.cardDefs[id];
        return def?.kind === 'unit' && def.type === req.type;
      });
      if (!hasMatch) return [];
      // ⚠ `isOpen`, not `isEmpty`: the engine's own check is `isOpen` (empty AND not a Wall), and an
      // enumerator that offers an action `applyAction` will reject breaks the contract in
      // `legalActions`. Latent until 2026-08-08 — walls only existed on hand-built maps, so a
      // walled tile in a leader's ring was rare. Wildgrowth's bramble maze makes it common, and
      // self-play caught it immediately ("Raise destination occupied or impassable").
      return mooreAdjacent(leaderOf(s, owner).pos)
        .filter((c) => isOpen(s, c) && inReach(c, reach))
        .sort(byColRow)
        .map((c) => [c]);
    }
    case 'fusePair': {
      const friendly = sortedUnits(s).filter((u) => u.owner === owner && !u.isLeader);
      const out: Coord[][] = [];
      for (const u1 of friendly) {
        for (const u2 of friendly) {
          if (u1.id === u2.id) continue;
          if (!orthAdjacent(u1.pos).some((c) => c.col === u2.pos.col && c.row === u2.pos.row)) continue;
          if (!findFusionResult(s, owner, u1.cardId, u2.cardId)) continue;
          if (!inReach(u1.pos, reach) || !inReach(u2.pos, reach)) continue;
          out.push([u1.pos, u2.pos]);
        }
      }
      return out;
    }
    default:
      return assertNever(req, 'TargetRequest');
  }
}

// ---------------------------------------------------------------------------
// Bound action enumeration
// ---------------------------------------------------------------------------

/**
 * Cross the tile sets with the card choices.
 *
 * ⚠ When there is no card request this returns exactly what the pre-2026-08-08 `withTargets` did,
 * object-for-object — which is what makes the card-choice pass additive: every deck that does not
 * opt in enumerates, and therefore plays, bit-identically.
 */
function withChoices(a: Action, sets: Coord[][], req: CardRequest, cardIds: string[]): Action[] {
  const withTiles = sets.map((targets) => (targets.length === 0 ? a : { ...a, targets }));
  if (req.kind === 'none') return withTiles;
  // A card request with nothing to name is an unplayable action, dropped like an unsatisfiable
  // tile request. (`raiseTile` already drops itself on the tile axis; a chosen Search has no tile
  // axis at all, so without this it would be offered and then whiff.)
  return withTiles.flatMap((bound) => cardIds.map((id) => ({ ...bound, chosenCards: [id] })));
}

/** Fully bind one action against an effect list: every tile set crossed with every card choice. */
function bind(
  s: GameState,
  owner: PlayerId,
  a: Action,
  effects: SpellEffectLine[],
  reach?: ReachConstraint,
): Action[] {
  const cards = cardRequest(effects);
  return withChoices(
    a,
    enumerateTargetSets(s, owner, combinedRequest(effects), reach),
    cards,
    cardCandidates(s, owner, cards),
  );
}

/**
 * legalActions(s), with target-bearing actions (CastSpell / FlipCard of a set spell /
 * ActivateAbility) replaced by one fully-bound Action per valid target set — plus
 * face-up casts of LOCATED spells, which legalActions omits. Actions whose request
 * has no valid target set are dropped (unplayable this turn). Every returned action
 * applies via applyAction without throwing.
 */
export function enumerateBoundActions(s: GameState): Action[] {
  if (s.phase === 'gameover') return [];
  if (s.pendingBurn) return legalActions(s); // forced BurnCard choices only
  const owner = s.active;
  const leaderPos = leaderOf(s, owner).pos;
  const out: Action[] = [];

  for (const a of legalActions(s)) {
    switch (a.t) {
      case 'CastSpell': {
        const def = s.cardDefs[a.card];
        if (def?.kind !== 'spell') break;
        const reach = def.scope === 'located' ? { resolvePos: leaderPos } : undefined;
        out.push(...bind(s, owner, a, def.effects, reach));
        break;
      }
      case 'FlipCard': {
        const sc = s.setCards[a.set];
        const def = sc ? s.cardDefs[sc.cardId] : undefined;
        if (!sc || !def) break;
        if (def.kind !== 'spell') {
          out.push(a); // flip-summon of a set unit takes no targets
          break;
        }
        const reach = def.scope === 'located' ? { resolvePos: sc.pos } : undefined;
        out.push(...bind(s, owner, a, def.effects, reach));
        break;
      }
      case 'ActivateAbility': {
        const ability = s.leaders[owner].ability;
        // Same source as the engine's own check in `doActivateAbility` — see `abilityReach`.
        const reach: ReachConstraint | undefined = ability.located
          ? { resolvePos: leaderPos, max: abilityReach() }
          : undefined;
        out.push(...bind(s, owner, a, ability.effects, reach));
        break;
      }
      default:
        out.push(a);
    }
  }

  // Located spells can also be cast face-up (reach anchored to the leader); legalActions omits them.
  for (const cardId of new Set(s.players[owner].hand)) {
    const def = s.cardDefs[cardId];
    if (def?.kind !== 'spell' || def.scope !== 'located') continue;
    if (s.players[owner].sp < spellSpCost(def)) continue;
    out.push(...bind(s, owner, { t: 'CastSpell', card: cardId }, def.effects, { resolvePos: leaderPos }));
  }

  return out;
}
