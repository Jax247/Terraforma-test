// Terraforma POC engine. Pure TS — no React, no DOM.
// applyAction(state, action) -> state. Validates, mutates a clone, checks triggers, checks win.

import {
  chebyshev,
  cloneState,
  inBounds,
  isEmpty,
  isStraightContiguousLine,
  leaderOf,
  mooreAdjacent,
  orthAdjacent,
  rangedTargets,
  sameCoord,
  canOccupy,
  canPassWalls,
  isOpen,
  isWall,
  tileAt,
  unitAt,
} from './board';
import { conditionHolds, effectiveAtk, effectiveDef, favoredTerrain } from './stats';
import type {
  Action,
  CardDef,
  Condition,
  Coord,
  Duration,
  Effect,
  GameState,
  PlayerId,
  Rule,
  SearchFilter,
  SetCard,
  SpellCardDef,
  SpellEffectLine,
  StatusEffectKind,
  TargetSpec,
  Terrain,
  Tile,
  TrapCardDef,
  Trigger,
  TriggerScope,
  Unit,
  UnitCardDef,
} from './types';
import { DEFAULT_SEED, nextRandom, shuffled } from './rng';
import { RULES } from './rules';
import {
  cannotAttack, cannotMove, cannotStrikeBack, DENIAL_STATUSES, hasKeyword, isStunned, isSuppressed,
  TAG_STATUSES,
} from './status';

function fail(msg: string): never {
  throw new Error(msg);
}

/** A unit still serving summoning sickness cannot attack, fuse, shoot, or change stance. */
export const isSick = (u: Unit): boolean => u.sickTurns > 0;

function nextId(s: GameState, prefix: string): string {
  const id = `${prefix}${s.nextId}`;
  s.nextId += 1;
  return id;
}

function log(s: GameState, msg: string): void {
  s.log.push(msg);
}

export function spMax(turnCount: number): number {
  // Cap flattened 12 -> 10 -> 8 (2026-07-17 economy experiment): an 8 SP bomb
  // consumes a whole cap turn. Vault says 12; not ratified — see RULES.spCap.
  //
  // STEP flattened 3 -> 1 on 2026-08-09, so the curve is 4/5/6/7/8 and the top end arrives on
  // turn 5 rather than turn 3. ⚠ EVERY A/B NUMBER RECORDED BEFORE 2026-08-09 WAS MEASURED ON
  // THE 4/7/8 CURVE.
  return Math.min(RULES.spCap, RULES.spBase + RULES.spStep * (turnCount - 1));
}

/**
 * Flanking (adopted 2026-07-17 after A/B trials; vault write-up pending playtest):
 * an attacking unit gains +RULES.flankPerAlly effective ATK per other friendly
 * NON-TOKEN unit adjacent to the defender, at most RULES.flankMaxAllies allies.
 * Unit-vs-unit combat only — leaders neither grant nor receive it. Tokens are
 * excluded by design: token-eligible flanking handed the swarm archetype the
 * meta in trials, while real-units-only kept the win order at baseline.
 */

/** Friendly non-leader, non-token units within Chebyshev 1 of `pos`, excluding `excludeId`.
 *  Exported because the AI evaluator has to predict a real combat outcome to price a defending
 *  body, and a flank bonus it computed itself would be a second source of truth for the number. */
export function flankAllies(s: GameState, pos: Coord, owner: PlayerId, excludeId: string): number {
  let n = 0;
  for (const c of mooreAdjacent(pos)) {
    const u = unitAt(s, c);
    if (u && u.owner === owner && !u.isLeader && !u.isToken && u.id !== excludeId) n += 1;
  }
  return n;
}

/** SP price to summon a unit (face-up or set face-down): explicit override or its level. */
export function unitSpCost(def: UnitCardDef): number {
  return def.sp ?? def.level;
}

/**
 * SP price paid when a spell ACTIVATES — cast face-up from hand, or flipped up from set.
 *
 * A mine pays this same number, but at a different moment: it is charged when the mine is SET
 * (see `setSpCost`), because a mine detonates off enemy contact rather than an activation, and
 * that contact happens on the enemy's turn when the owner has no SP to pay with.
 */
export function spellSpCost(def: SpellCardDef): number {
  return def.sp ?? 0;
}

/** SP price to set a trap face-down. Charged at SET — see `TrapCardDef.sp`. */
export function trapSpCost(def: TrapCardDef): number {
  return def.sp ?? 0;
}

/**
 * SP charged for SETTING a card face-down — the single answer for the engine, `legalActions`,
 * the bot's affordability check and the UI, so all four agree on what a set costs.
 *
 * - **unit** — its summon price; a face-down unit is a hidden summon.
 * - **trap** — its set price; a trap can never be paid for at activation (opponent's turn).
 * - **mine** (a face-down spell that can be sprung by contact) — its spell price, prepaid here for
 *   the same reason: contact can happen on the enemy's turn. `doFlipCard` therefore does NOT
 *   charge it again if the owner flips it up manually instead.
 * - **any other spell** — 0. A travelling board spell is paid for when it is flipped and resolves.
 */
export function setSpCost(def: CardDef): number {
  if (def.kind === 'unit') return unitSpCost(def);
  if (def.kind === 'trap') return trapSpCost(def);
  return isUnitAffecting(def) ? spellSpCost(def) : 0;
}

/** The SP number PRINTED on a card, whichever moment it is charged at — for display and sorting. */
export function cardSpCost(def: CardDef): number {
  if (def.kind === 'unit') return unitSpCost(def);
  if (def.kind === 'trap') return trapSpCost(def);
  return spellSpCost(def);
}

// ---------------------------------------------------------------------------
// Binding context for effect execution
// ---------------------------------------------------------------------------

interface Binding {
  owner: PlayerId;          // controller of the effect
  sourcePos: Coord;         // where the effect resolves from (unit / set card / leader)
  selfUnitId?: string;
  chosen?: Coord[];         // player-supplied target TILES
  /** Player-supplied card ids from a zone (chosen Raise / Search). See `Action.chosenCards`. */
  chosenCards?: string[];
  triggeringUnitId?: string;
  /** The tile a trigger was about (the painted tile on `OnTerrainPainted`). */
  triggeringTile?: Coord;
  attackerId?: string;
  pathTiles?: Coord[];      // OnMove
  destinationTile?: Coord;  // OnKill
  /** Trigger-fired effects fizzle on a missing target; player actions throw instead. */
  lenient?: boolean;
}

// ---------------------------------------------------------------------------
// Unit lifecycle
// ---------------------------------------------------------------------------

function placeUnit(s: GameState, u: Unit): void {
  const tile = tileAt(s.board, u.pos);
  if (tile.occupant) fail(`tile (${u.pos.col},${u.pos.row}) occupied`);
  tile.occupant = { kind: 'unit', id: u.id };
  s.units[u.id] = u;
}

function realUnitCount(s: GameState, p: PlayerId): number {
  return Object.values(s.units).filter((u) => u.owner === p && !u.isToken && !u.isLeader).length;
}

/** Face-down units are still units — they occupy a slot in the 5-unit cap while hidden. */
function faceDownUnitCount(s: GameState, p: PlayerId): number {
  return Object.values(s.setCards).filter((c) => c.owner === p && c.kind === 'unit').length;
}

/** Real + face-down units, for the 5-unit field cap. */
export function unitSlots(s: GameState, p: PlayerId): number {
  return realUnitCount(s, p) + faceDownUnitCount(s, p);
}

/** Only spells/traps count against the 5 non-unit cap; face-down units do not. */
export function setCardCount(s: GameState, p: PlayerId): number {
  return Object.values(s.setCards).filter((c) => c.owner === p && c.kind !== 'unit').length;
}

function destroyUnit(s: GameState, unitId: string): void {
  const u = s.units[unitId];
  if (!u) return;
  if (u.isLeader) fail('leaders are never destroyed as pieces — LP is the pool');
  tileAt(s.board, u.pos).occupant = undefined;
  delete s.units[unitId];
  if (u.isToken) {
    log(s, `${u.name} (token) vanishes`);
  } else {
    // Fused units go to the graveyard as the fused card (Graveyard & Void, locked).
    s.players[u.owner].graveyard.push(u.cardId);
    log(s, `${u.name} destroyed -> graveyard`);
  }
  // On-Death fires after removal, from the death position.
  {
    for (const rule of unitRules(s, u)) {
      if (rule.trigger !== 'OnDeath') continue;
      execLine(s, { effect: rule.effect, target: rule.target, condition: rule.condition }, {
        owner: u.owner,
        sourcePos: u.pos,
        selfUnitId: u.id,
        lenient: true,
      });
    }
  }
  // ...then the board reacts (Deathwatch). Ordered second on purpose: a unit's own death rattle
  // resolves before anything watching it, so a Deathwatch listener sees the post-rattle board.
  fireDeathwatch(s, u);
}

/**
 * Maximum nesting for death chains. A Deathwatch effect can kill, which fires Deathwatch again;
 * without a ceiling two units that kill on each other's death would recurse until the stack blew.
 *
 * The counter unwinds in a `finally`, so it is self-balancing and needs no per-action reset —
 * which matters because `applyAction` clones state but module scope persists across calls.
 */
const MAX_DEATH_CHAIN = 8;
let deathChainDepth = 0;

function fireDeathwatch(s: GameState, dead: Unit): void {
  if (deathChainDepth >= MAX_DEATH_CHAIN) {
    log(s, `death chain depth ${MAX_DEATH_CHAIN} reached — further On Any Death triggers skipped`);
    return;
  }
  deathChainDepth += 1;
  try {
    // `dead` is already out of s.units, so it cannot listen to its own death — that is what
    // OnDeath is for. excludeUnitId is belt-and-braces for the same fact.
    fireBoardTrigger(s, 'OnAllyDeath', {
      subjectOwner: dead.owner,
      defaultScope: 'friendly',
      excludeUnitId: dead.id,
    });
  } finally {
    deathChainDepth -= 1;
  }
}

function moveUnitOnBoard(s: GameState, u: Unit, to: Coord): void {
  tileAt(s.board, u.pos).occupant = undefined;
  const tile = tileAt(s.board, to);
  if (tile.occupant) fail(`cannot move onto occupied tile (${to.col},${to.row})`);
  tile.occupant = { kind: 'unit', id: u.id };
  u.pos = to;
  u.movedThisTurn = true;
  // The single chokepoint every kind of arrival flows through — a plain move, a displacement,
  // and an advance-on-kill all land here — so a sigil fires however the unit got here.
  // Deliberately not `placeUnit`: that is also the game-setup path, and summoning onto your
  // own marked ground is not an "entry" the sigil should punish.
  fireSigil(s, u, tile);
  checkSpringCapture(s, u);
}

/** Marked ground bites on ENTRY only; standing still never re-applies. */
function fireSigil(s: GameState, u: Unit, tile: Tile): void {
  const spec = tile.sigil;
  if (!spec || spec.turns <= 0) return;
  const where = `(${u.pos.col},${u.pos.row})`;
  // Leaders are CC-immune, so a sigil cannot deny one its turn — it bills the leader the only
  // way anything bills a leader in this game: attritionally, straight off the LP pool
  // (Combat Resolution: "combat is binary for units, attritional for the leader"). The status
  // kind is irrelevant here; a leader takes the same LP hit off a Stunned or an AtkMod sigil.
  if (u.isLeader) {
    if (RULES.sigilLeaderLp <= 0) return;
    s.players[u.owner].leaderLife -= RULES.sigilLeaderLp;
    log(s, `${u.name} steps on a sigil at ${where}: ${RULES.sigilLeaderLp} LP (${s.players[u.owner].leaderLife})`);
    checkWin(s);
    return;
  }
  applyStatus(s, u, spec.status, spec.amount, { kind: 'turns', turnsLeft: spec.turns });
  log(s, `${u.name} steps on a sigil at ${where}`);
}

// ---------------------------------------------------------------------------
// Springs
// ---------------------------------------------------------------------------

function checkSpringCapture(s: GameState, u: Unit): void {
  const tile = tileAt(s.board, u.pos);
  if (!tile.spring || !tile.springActive) return;
  tile.springActive = false;
  // TODO(open): vault says "synchronized relight"; sim-1 ruling was per-spring
  // 3 turns after its own capture — POC uses the per-spring ruling.
  tile.springRelightRound = s.round + RULES.springRechargeRounds;
  s.players[u.owner].sp += RULES.springSp; // overflows the cap; expires at end of turn
  log(s, `${u.name} captures the spring at (${u.pos.col},${u.pos.row}): +${RULES.springSp} SP`);
  fireOnCapture(s, u);
}

/**
 * A unit's own printed rules, or nothing at all while it is Suppressed. Every trigger path goes
 * through here so suppression cannot be forgotten at one site. Leader auras that TARGET a
 * suppressed unit still apply: suppression silences this unit's own text, not other cards'.
 */
function unitRules(s: GameState, u: Unit): Rule[] {
  if (isSuppressed(u)) return [];
  const def = s.cardDefs[u.cardId];
  return def?.kind === 'unit' ? def.rules : [];
}

/**
 * Does a scoped trigger's `scope` accept an event that happened to `subjectOwner`, from the point
 * of view of a rule controlled by `listenerOwner`?
 *
 * `self` is not decidable here (it needs unit identity, not just ownership) and is handled at
 * each call site; this covers the ownership-only cases.
 */
function scopeMatches(scope: TriggerScope, listenerOwner: PlayerId, subjectOwner: PlayerId): boolean {
  switch (scope) {
    case 'any': return true;
    case 'friendly': return subjectOwner === listenerOwner;
    case 'enemy': return subjectOwner !== listenerOwner;
    case 'self': return subjectOwner === listenerOwner; // call sites narrow further by unit id
  }
}

/**
 * Fire one trigger across every face-up unit on the board, plus both leaders.
 *
 * The shared spine for the board-wide reactive triggers added 2026-08-04 (`OnAllyDeath`,
 * `OnTrapTriggered`, `OnSummonAlly`, `OnEnemySummon`, `OnSpellCast`, `OnAbilityCast`). Each
 * listener resolves from its OWN tile with itself as `Self`, and the unit that caused the event —
 * where there is one — binds as `TriggeringUnit`, so a condition can inspect it.
 *
 * Iterates a SNAPSHOT of unit ids and re-checks liveness each step, because a listener's effect
 * can kill other listeners (or end the game) part-way through the sweep.
 */
function fireBoardTrigger(
  s: GameState,
  trigger: Trigger,
  opts: {
    /** Owner of the thing that happened, for scope matching. */
    subjectOwner: PlayerId;
    /** The unit the event is about, if any — bound as `TriggeringUnit`. */
    triggeringUnitId?: string;
    /** The tile the event is about, if any — bound as `TriggeringTile`. */
    triggeringTile?: Coord;
    /** The terrain a tile became, tested against `when.terrain`. Terrainfall only. */
    terrain?: Terrain;
    /** Default scope when a rule does not state one. */
    defaultScope: TriggerScope;
    /** Listeners to skip (e.g. the unit that just died fires OnDeath, not OnAllyDeath). */
    excludeUnitId?: string;
  },
): void {
  const listeners = Object.keys(s.units);
  for (const id of listeners) {
    if (s.phase === 'gameover') return;
    const listener = s.units[id];
    if (!listener || id === opts.excludeUnitId) continue;
    const rules = listener.isLeader ? s.leaders[listener.owner].rules : unitRules(s, listener);
    for (const rule of rules) {
      if (rule.trigger !== trigger) continue;
      if (!scopeMatches(rule.when?.scope ?? opts.defaultScope, listener.owner, opts.subjectOwner)) continue;
      // A stated terrain filter only passes on an event that carries a terrain and matches it.
      if (rule.when?.terrain && rule.when.terrain !== opts.terrain) continue;
      // Per-EVENT gate on the unit that caused the trigger — see TriggerWhen.triggerUnit. Note
      // `subject` is the triggering unit here, not the listener: this predicate is about the
      // thing that happened, not about who is watching.
      if (rule.when?.triggerUnit) {
        const trig = opts.triggeringUnitId ? s.units[opts.triggeringUnitId] : undefined;
        if (!conditionHolds(s, rule.when.triggerUnit, { subject: trig, trigger: trig, owner: listener.owner })) continue;
      }
      if (!s.units[id]) break; // a previous rule on this same unit killed it
      execLine(s, rule, {
        owner: listener.owner,
        sourcePos: listener.pos,
        selfUnitId: listener.id,
        triggeringUnitId: opts.triggeringUnitId,
        triggeringTile: opts.triggeringTile,
        lenient: true,
      });
    }
  }
}

/**
 * A spring changed hands. Fires `OnCapture` for every listener whose `scope` accepts it.
 *
 * ✅ **Resolves the long-standing TODO(open) here.** Scope used to be hardcoded and asymmetric: a
 * UNIT's rule fired only when that unit was itself the capturer, while a LEADER's rule fired on
 * any friendly capture. Neither was stated on the card, and the lock is why the trigger produced
 * only four near-identical cards. `Rule.scope` now says which is meant, and the DEFAULTS
 * reproduce the old behaviour exactly (`self` for units, `friendly` for leaders) so the four
 * existing cards and Oskar are byte-identical until content opts in.
 *
 * `enemy` / `any` are newly expressible: a card can now punish the OPPONENT for taking ground.
 */
function fireOnCapture(s: GameState, capturer: Unit): void {
  // Every face-up unit listens; `self` (the default for units) narrows to the capturer itself.
  for (const id of Object.keys(s.units)) {
    if (s.phase === 'gameover') return;
    const listener = s.units[id];
    if (!listener || listener.isLeader) continue;
    for (const rule of unitRules(s, listener)) {
      if (rule.trigger !== 'OnCapture') continue;
      const scope = rule.when?.scope ?? 'self';
      if (scope === 'self' ? listener.id !== capturer.id : !scopeMatches(scope, listener.owner, capturer.owner)) continue;
      if (!s.units[id]) break;
      execLine(s, rule, {
        owner: listener.owner,
        sourcePos: listener.pos,
        selfUnitId: listener.id,
        triggeringUnitId: capturer.id,
        lenient: true,
      });
    }
  }
  // Leaders: both of them, so an `enemy`-scoped leader rule can answer the opponent's capture.
  for (const p of [0, 1] as const) {
    for (const rule of s.leaders[p].rules) {
      if (rule.trigger !== 'OnCapture') continue;
      const scope = rule.when?.scope ?? 'friendly';
      // `self` on a leader means "the leader personally took it" — the leader IS a unit.
      if (scope === 'self' ? leaderOf(s, p).id !== capturer.id : !scopeMatches(scope, p, capturer.owner)) continue;
      execLine(s, rule, {
        owner: p,
        sourcePos: leaderOf(s, p).pos,
        selfUnitId: leaderOf(s, p).id,
        triggeringUnitId: capturer.id,
        lenient: true,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Targets & effects
// ---------------------------------------------------------------------------

function resolveTargetUnits(s: GameState, target: TargetSpec, b: Binding): Unit[] {
  switch (target.t) {
    case 'Self': {
      const u = b.selfUnitId ? s.units[b.selfUnitId] : undefined;
      return u ? [u] : [];
    }
    case 'TriggeringUnit': {
      const u = b.triggeringUnitId ? s.units[b.triggeringUnitId] : undefined;
      return u ? [u] : [];
    }
    case 'UnitOnTriggeringTile': {
      const u = b.triggeringTile ? unitAt(s, b.triggeringTile) : undefined;
      return u ? [u] : [];
    }
    case 'Attacker': {
      const u = b.attackerId ? s.units[b.attackerId] : undefined;
      return u ? [u] : [];
    }
    case 'ChosenUnit':
    case 'ChosenFriendly':
    case 'ChosenEnemy': {
      const c = b.chosen?.[0];
      if (!c) {
        if (b.lenient) return []; // no legal target: the triggered effect fizzles
        fail('target required');
      }
      const u = unitAt(s, c);
      if (!u) fail('no unit at target');
      if (target.t === 'ChosenEnemy' && u.owner === b.owner) fail('must target an enemy');
      if (target.t === 'ChosenFriendly' && u.owner !== b.owner) fail('must target a friendly');
      return [u];
    }
    case 'AdjacentEnemies': {
      return orthAdjacent(b.sourcePos)
        .map((c) => unitAt(s, c))
        .filter((u): u is Unit => u !== undefined && u.owner !== b.owner);
    }
    case 'FriendlyOfTypes':
      return Object.values(s.units).filter(
        (u) => u.owner === b.owner && target.types.includes(u.type),
      );
    case 'AdjacentFriendlies':
      return orthAdjacent(b.sourcePos)
        .map((c) => unitAt(s, c))
        .filter((u): u is Unit => u !== undefined && u.owner === b.owner);
    case 'AllEnemies':
      return Object.values(s.units).filter((u) => u.owner !== b.owner);
    case 'EnemiesOfTypes':
      return Object.values(s.units).filter(
        (u) => u.owner !== b.owner && target.types.includes(u.type),
      );
    case 'AllUnitsOnTerrain':
      // Both sides on purpose: this is the kill-zone shape, and a painter who stands in their own
      // hazard should suffer it too.
      return Object.values(s.units).filter(
        (u) => tileAt(s.board, u.pos).terrain === target.terrain,
      );
    case 'FriendlyOfTypesOnTerrain':
      return Object.values(s.units).filter(
        (u) =>
          u.owner === b.owner &&
          target.types.includes(u.type) &&
          tileAt(s.board, u.pos).terrain === target.terrain,
      );
    case 'Area2x2': {
      const tl = b.chosen?.[0];
      if (!tl) fail('target required');
      const units: Unit[] = [];
      for (const d of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const c = { col: tl.col + d[0], row: tl.row + d[1] };
        if (!inBounds(c)) continue;
        const u = unitAt(s, c);
        if (u) units.push(u);
      }
      return units;
    }
    case 'Area3x3': {
      const center = b.chosen?.[0];
      if (!center) fail('target required');
      return [...mooreAdjacent(center), center]
        .map((c) => unitAt(s, c))
        .filter((u): u is Unit => u !== undefined);
    }
    default:
      return [];
  }
}

function resolveTargetTiles(s: GameState, target: TargetSpec, b: Binding): Coord[] {
  switch (target.t) {
    case 'ThisTile':
      return [b.sourcePos];
    case 'DestinationTile':
      return b.destinationTile ? [b.destinationTile] : [];
    case 'TriggeringTile':
      return b.triggeringTile ? [b.triggeringTile] : [];
    case 'TilesMovedThrough':
      // TODO(open): sim-1 ruling — for a 1-tile move this is the destination tile.
      return b.pathTiles ?? [];
    case 'Line3': {
      const tiles = b.chosen ?? [];
      if (tiles.length !== 3) fail('Line3 needs exactly 3 tiles');
      if (!tiles.every(inBounds)) fail('Line3 out of bounds');
      if (!isStraightContiguousLine(tiles)) fail('Line3 must be a straight contiguous line');
      return tiles;
    }
    case 'Area2x2': {
      const tl = b.chosen?.[0];
      if (!tl) fail('target required');
      const tiles: Coord[] = [];
      for (const d of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const c = { col: tl.col + d[0], row: tl.row + d[1] };
        if (inBounds(c)) tiles.push(c);
      }
      return tiles;
    }
    case 'Area3x3': {
      const center = b.chosen?.[0];
      if (!center) fail('target required');
      return [...mooreAdjacent(center), center];
    }
    case 'TilesAroundLeader':
      return mooreAdjacent(leaderOf(s, b.owner).pos);
    case 'AdjacentEmptyTiles':
      return mooreAdjacent(b.sourcePos).filter((c) => isOpen(s, c));
    case 'EmptyTileNear': {
      const empty = mooreAdjacent(b.sourcePos).filter((c) => isOpen(s, c));
      return empty.length > 0 ? [empty[0]!] : [];
    }
    default:
      return [];
  }
}

/**
 * Per-target condition check for an effect line.
 *
 * ⚠ BEHAVIOUR NOTE from the 2026-08-05 consolidation: the old local copy returned `true` for the
 * two combat-context predicates ("handled inside effectiveAtk"), which meant an effect line
 * conditioned on one of them applied to every target outside combat. The shared evaluator DENIES
 * without a combat context instead. No shipped content is affected — the only effect-line
 * conditions in the pool are `EffAtkAtMost` — and the validator now rejects the combination.
 */
function targetConditionHolds(s: GameState, cond: Condition | undefined, u: Unit, b: Binding): boolean {
  return conditionHolds(s, cond, { subject: u, owner: b.owner });
}

function displaceUnit(s: GameState, u: Unit, origin: Coord, tiles: number, mode: 'push' | 'pull'): void {
  if (hasKeyword(u, 'Anchored')) {
    log(s, `${u.name} is Anchored — displacement has no effect`);
    return;
  }
  let dc = Math.sign(u.pos.col - origin.col);
  let dr = Math.sign(u.pos.row - origin.row);
  if (dc === 0 && dr === 0) return; // on the origin itself: no direction
  if (mode === 'pull') {
    dc = -dc;
    dr = -dr;
  }
  let cur = u.pos;
  for (let i = 0; i < tiles; i++) {
    const next = { col: cur.col + dc, row: cur.row + dr };
    // Blocked movement stops at the last empty tile (locked collision rule).
    if (!inBounds(next) || !canOccupy(s, next, u)) break;
    cur = next;
  }
  if (!sameCoord(cur, u.pos)) {
    moveUnitOnBoard(s, u, cur);
    log(s, `${u.name} displaced to (${cur.col},${cur.row})`);
    // A zone trap does not care HOW a unit arrived on its tile — shoving an enemy into a
    // trap zone springs it exactly as walking in would. The displacement has already
    // resolved by this point, so a 'negate' trap has nothing left to cancel and the return
    // value is deliberately dropped. OnMove rules stay unfired: the unit did not choose to
    // move. fireTraps' own enemy-of-owner check is what stops a push from setting off the
    // moved unit's OWN side's traps.
    fireTraps(s, { kind: 'moveIntoZone', moverId: u.id, destination: cur });
  }
}

function applyDamage(s: GameState, target: Unit, amount: number): void {
  if (target.isLeader) {
    s.players[target.owner].leaderLife -= amount;
    log(s, `${target.name} takes ${amount} damage (LP ${s.players[target.owner].leaderLife})`);
    checkWin(s);
    return;
  }
  // TODO(open): Damage vs one-hit units ruled: destroyed if amount >= current effective ATK.
  //
  // The effective ATK is logged because it is the THRESHOLD, not flavour: damage here is pass/fail
  // against it, and a reader (or `npm run impact`) otherwise cannot tell a near miss from a card
  // that was never going to work. It is what showed that raising the damage tier under-delivered —
  // trap victims are self-selected aggressors, so their ATK runs well above the board median.
  const threshold = effectiveAtk(s, target);
  if (amount >= threshold) {
    log(s, `${target.name} destroyed by ${amount} damage (ATK ${threshold})`);
    destroyUnit(s, target.id);
  } else {
    log(s, `${target.name} survives ${amount} damage (ATK ${threshold})`);
  }
}

function summonTokens(s: GameState, tokenId: string, count: number, tiles: Coord[], owner: PlayerId): void {
  const def = s.tokenDefs[tokenId] ?? fail(`unknown token ${tokenId}`);
  // TODO(open): overflow ruling — place as many as fit, extras fizzle.
  // TODO(open): TOKEN CAP (2026-07-17, supersedes the vault's locked "tokens are
  // capped spatially, not numerically"): ≤ RULES.tokenCap tokens per player; overflow
  // fizzles like tile overflow. Driven by Hivebrood playtesting — Brood Matron's
  // free spawn plus Hatch flooded the board within a couple of turns, remaking
  // the fortress-stall shape out of chaff and drowning the movement game.
  let tokensOnBoard = Object.values(s.units).filter((u) => u.owner === owner && u.isToken).length;
  for (let i = 0; i < count && i < tiles.length; i++) {
    if (tokensOnBoard >= RULES.tokenCap) {
      log(s, `token cap (${RULES.tokenCap}) reached — remaining ${def.name} spawns fizzle`);
      return;
    }
    tokensOnBoard += 1;
    const pos = tiles[i]!;
    const u: Unit = {
      id: nextId(s, 'u'),
      owner,
      cardId: def.id,
      name: def.name,
      type: def.type,
      baseAtk: def.atk,
      baseDef: defaultDef(def.atk), // tokens carry no explicit DEF
      level: 0,
      pos,
      isToken: true,
      isLeader: false,
      stance: 'attack',
      sickTurns: RULES.summoningSickTurns, // tokens get summoning sickness too
      hasActed: false,
      movedThisTurn: false,
      keywords: [...def.keywords],
      range: def.range ?? 1,
      statuses: [],
      atkCounters: 0,
      defCounters: 0,
      extraMove: 0,
    };
    placeUnit(s, u);
    log(s, `token ${u.name} appears at (${pos.col},${pos.row})`);
  }
}

let statusSeq = 0;

/** Rank for "keep the longer one" on refresh: permanent beats any count, which beats endOfTurn. */
function durationWeight(d: Duration): number {
  if (d.kind === 'permanent') return Infinity;
  if (d.kind === 'endOfTurn') return 0;
  return d.turnsLeft;
}

function longerDuration(a: Duration, b: Duration): boolean {
  return durationWeight(a) > durationWeight(b);
}

function applyStatus(s: GameState, u: Unit, kind: StatusEffectKind, amount: number, duration: Duration): void {
  // A leader that can be locked down cannot flee, cannot answer, and cannot be played around —
  // the whole game routes through one piece. Immunity is at this chokepoint so it holds for
  // every source (sigil, spell, trap) rather than card by card.
  if (u.isLeader && DENIAL_STATUSES.has(kind)) {
    log(s, `${u.name} is a leader — immune to ${kind}`);
    return;
  }
  // Denial statuses take the LONGER duration rather than stacking a second copy — otherwise
  // re-application chain-locks (walk off a sigil, get shoved back on, never act again). The
  // numeric mods deliberately keep stacking: two different buff cards SHOULD sum.
  if (TAG_STATUSES.has(kind)) {
    const existing = u.statuses.find((st) => st.kind === kind);
    if (existing) {
      if (longerDuration(duration, existing.duration)) existing.duration = structuredClone(duration);
      log(s, `${u.name} is already ${kind} — duration refreshed, not stacked`);
      return;
    }
  }
  u.statuses.push({ id: `st${statusSeq++}`, kind, amount, duration: structuredClone(duration) });
  log(s, `${u.name} gains ${kind}${kind === 'AtkMod' || kind === 'DefMod' ? ` ${amount}` : ''}`);
}

function drawCards(s: GameState, p: PlayerId, n: number): void {
  const ps = s.players[p];
  for (let i = 0; i < n; i++) {
    if (s.phase === 'gameover') return;
    const card = ps.deck.shift();
    if (card === undefined) {
      // Fatigue (2026-07-15 ruling, supersedes "deck-out is never a loss"):
      // each missed draw deals escalating LP damage so stalled games always end.
      ps.fatigue += 1;
      const dmg = RULES.fatigueStep * ps.fatigue;
      ps.leaderLife -= dmg;
      log(s, `player ${p} draws from an empty deck: ${dmg} fatigue damage (LP ${ps.leaderLife})`);
      checkWin(s);
      continue;
    }
    if (addToHand(s, p, card, n - i - 1)) return;
  }
}

/**
 * Put a card in hand and apply the hand cap. Returns true if the cap was breached, meaning the
 * caller must stop.
 *
 * Extracted from `drawCards` so `Search` goes through the identical path — a fetched card
 * overflows the hand exactly the way a drawn one does (2026-08-05 ruling).
 *
 * Hand cap (2026-07-15 ruling): the incoming card enters; the owner must burn one of the OTHERS
 * to the void before acting. Anything still queued behind it waits on that choice.
 */
function addToHand(s: GameState, p: PlayerId, cardId: string, queuedBehind: number): boolean {
  const ps = s.players[p];
  ps.hand.push(cardId);
  if (ps.hand.length <= RULES.handCap) return false;
  s.pendingBurn = { player: p, remainingDraws: queuedBehind };
  log(s, `player ${p} is over the ${RULES.handCap}-card hand cap — must burn a card to the void`);
  return true;
}

/**
 * Deck indices whose card matches the filter — the ONE place a search decides what qualifies.
 *
 * Shared on purpose: `mode: 'random'` picks from this list with `nextRandom`, and a future
 * `mode: 'choose'` would pick from the very same list by player choice. Only the selection
 * differs, which is what makes deliberate search a drop-in rather than a rewrite.
 */
function searchMatches(s: GameState, owner: PlayerId, f: SearchFilter): number[] {
  const out: number[] = [];
  s.players[owner].deck.forEach((cardId, i) => {
    const def = s.cardDefs[cardId];
    if (!def) return; // unknown id, or a fog-masked deck: no match, never a throw
    if (f.kind && def.kind !== f.kind) return;
    if (f.type && !(def.kind === 'unit' && def.type === f.type)) return;
    if (f.keyword && !(def.kind === 'unit' && def.keywords.includes(f.keyword))) return;
    if (f.maxLevel !== undefined && !(def.kind === 'unit' && def.level <= f.maxLevel)) return;
    out.push(i);
  });
  return out;
}

function doBurnCard(s: GameState, index: number): void {
  const pending = s.pendingBurn ?? fail('no hand-cap burn is pending');
  const ps = s.players[pending.player];
  // The incoming card (last in hand) cannot be burned — the burn makes room FOR it.
  if (!Number.isInteger(index) || index < 0 || index >= ps.hand.length - 1) {
    fail(`burn index must pick one of the ${ps.hand.length - 1} pre-draw cards`);
  }
  const burned = ps.hand.splice(index, 1)[0]!;
  s.voidPile.push(burned);
  log(s, `player ${pending.player} burns a card to the void (hand cap)`);
  const remaining = pending.remainingDraws;
  s.pendingBurn = undefined;
  if (remaining > 0) drawCards(s, pending.player, remaining);
}

/**
 * Terrainfall depth ceiling. A listener can paint, which fires Terrainfall again; two cards that
 * each repaint on the other's paint would recurse until the stack blew. Same shape as
 * `MAX_DEATH_CHAIN`: the counter unwinds in a `finally`, so it is self-balancing and needs no
 * per-action reset (`applyAction` clones state, but module scope persists across calls).
 */
const MAX_PAINT_CHAIN = 8;
let paintChainDepth = 0;

/**
 * "Terrainfall" — fires ONCE PER LISTENER per paint event, not once per changed tile.
 *
 * A single paint can turn over many tiles (a Line3 ability, an Area3x3, or every tile a leader
 * walked), and per-tile firing would let one Overgrowth hand every payoff card on the board three
 * triggers. Once-per-listener caps that burst while leaving the common case — a leader's one-tile
 * move — behaving identically either way.
 *
 * Binding the FIRST changed tile is unambiguous because `PaintTerrain` carries a single terrain:
 * every tile changed by one paint became the same thing, so `when.terrain` is a per-event test.
 *
 * "Once per listener" falls out of calling this ONCE per paint event rather than once per changed
 * tile — `fireBoardTrigger` itself is untouched, so a card carrying two Terrainfall rules still
 * resolves both, exactly as it would on any other trigger.
 */
function fireTerrainfall(s: GameState, painter: PlayerId, terrain: Terrain, tile: Coord): void {
  if (paintChainDepth >= MAX_PAINT_CHAIN) {
    log(s, `paint chain depth ${MAX_PAINT_CHAIN} reached — further On Terrain Painted triggers skipped`);
    return;
  }
  paintChainDepth += 1;
  try {
    fireBoardTrigger(s, 'OnTerrainPainted', {
      subjectOwner: painter,
      defaultScope: 'friendly',
      triggeringTile: tile,
      terrain,
    });
  } finally {
    paintChainDepth -= 1;
  }
}

/**
 * Would painting `c` as a Wall wreck the board?
 *
 * ⚠ Walls are the one terrain that can make a game UNPLAYABLE, and they are PERMANENT —
 * `RULES.wallsPaintable` is false, so nothing can ever clear one. `boardLayout.ts` has always
 * validated against this for hand-built maps ("impassable terrain can wreck a map in ways nothing
 * else can"), but that runs at map-BUILD time; once a card can paint Wall at runtime, the same
 * three failure modes come back with no check in front of them. This is that check.
 *
 * It refuses the tile rather than the whole paint — same shape as the existing Wall-immunity
 * branch — so a Line3 that would seal one tile still lands the other two. Checks run against the
 * LIVE board and the LIVE leader positions (not the starts), and sequentially, so a multi-tile
 * paint sees the walls it just laid.
 */
function wallWouldSeal(s: GameState, c: Coord): boolean {
  const leaders = [leaderOf(s, 0), leaderOf(s, 1)];
  // 1. A leader can never be standing inside a wall.
  if (leaders.some((l) => sameCoord(l.pos, c))) return true;
  const blocked = (t: Coord): boolean => sameCoord(t, c) || tileAt(s.board, t).terrain === 'Wall';
  // 2. Every leader keeps at least one open tile in its ring, or it can neither move nor summon.
  for (const l of leaders) {
    if (mooreAdjacent(l.pos).every(blocked)) return true;
  }
  // 3. The two sides must still reach each other over non-Wall tiles, or no game happens.
  const key = (t: Coord): string => `${t.col},${t.row}`;
  const seen = new Set([key(leaders[0]!.pos)]);
  const queue: Coord[] = [leaders[0]!.pos];
  while (queue.length > 0) {
    for (const n of orthAdjacent(queue.shift()!)) {
      if (seen.has(key(n)) || blocked(n)) continue;
      seen.add(key(n));
      queue.push(n);
    }
  }
  return !seen.has(key(leaders[1]!.pos));
}

function execLine(s: GameState, line: SpellEffectLine, b: Binding): void {
  const eff: Effect = line.effect;
  switch (eff.e) {
    case 'PaintTerrain': {
      // Walls shrug off conventional painting: they are structure, not ground cover. The
      // `wallsPaintable` knob exists to A/B whether that immunity is the right call.
      let blocked = 0;
      let wiped = 0;
      /**
       * Tiles whose terrain ACTUALLY changed — the Terrainfall trigger set.
       *
       * ⚠ Deliberately narrower than "tiles we assigned". A paint that sets a tile to the terrain
       * it already was does not belong here: without that, Briar farms free triggers by walking
       * over her own Forest, since her OnMove paints every tile she crosses.
       *
       * ⚠ And deliberately SEPARATE from the sigil branch below. Any resolved paint wipes a
       * sigil, same-terrain ones included, and that behaviour is unchanged — `changed` exists
       * only to decide whether the trigger fires.
       */
      const changed: Coord[] = [];
      let sealed = 0;
      for (const c of resolveTargetTiles(s, line.target, b)) {
        const tile = tileAt(s.board, c);
        if (tile.terrain === 'Wall' && !RULES.wallsPaintable) {
          blocked += 1;
          continue; // a REFUSED paint must not wipe the sigil either
        }
        // Building a wall is the one paint that can make the game unplayable — see `wallWouldSeal`.
        if (eff.terrain === 'Wall' && wallWouldSeal(s, c)) {
          sealed += 1;
          continue;
        }
        if (tile.terrain !== eff.terrain) changed.push(c);
        tile.terrain = eff.terrain;
        // Repainting is a sigil's counterplay: turning the ground over destroys the marking.
        if (tile.sigil) {
          delete tile.sigil;
          wiped += 1;
        }
      }
      const notes = [
        blocked > 0 ? `${blocked} Wall tile(s) unaffected` : '',
        sealed > 0 ? `${sealed} tile(s) refused — would seal the board` : '',
        wiped > 0 ? `${wiped} sigil(s) wiped` : '',
      ].filter(Boolean).join('; ');
      log(s, `terrain painted ${eff.terrain}${notes ? ` (${notes})` : ''}`);
      if (changed.length > 0) fireTerrainfall(s, b.owner, eff.terrain, changed[0]!);
      return;
    }
    case 'Search': {
      const ps = s.players[b.owner];
      const matches = searchMatches(s, b.owner, eff.filter);
      // 'choose' is a true TUTOR and 'random' is a dig; both share the filter, and differ only in
      // which match is taken. Choose was unimplemented until the 2026-08-08 card-choice pass gave
      // an Action a way to name a card — see `Action.chosenCards`.
      let pick = -1;
      if (eff.mode === 'choose') {
        const wanted = b.chosenCards?.[0];
        // An unchosen tutor degrades to the dig rather than throwing: a trigger can carry a Search
        // with no player behind it, and fizzling a whole rule over a missing choice is worse than
        // taking a match. A named card that does not MATCH is a bad action and still fails below.
        if (wanted === undefined) pick = matches.length > 0 ? matches[Math.floor(nextRandom(s) * matches.length)]! : -1;
        else {
          pick = matches.find((i) => ps.deck[i] === wanted) ?? -1;
          if (pick === -1 && !b.lenient) fail(`${wanted} is not a matching card in your deck`);
        }
      } else if (matches.length > 0) {
        pick = matches[Math.floor(nextRandom(s) * matches.length)]!;
      }
      if (pick >= 0) {
        const cardId = ps.deck.splice(pick, 1)[0]!;
        log(s, `player ${b.owner} searches their deck and finds ${s.cardDefs[cardId]?.name ?? cardId}`);
        addToHand(s, b.owner, cardId, 0);
      } else {
        // A whiff fizzles — required for fog, where the opponent's deck is masked and nothing
        // can match. It still shuffles below: one code path, and it cannot leak.
        log(s, `player ${b.owner} searches their deck and finds nothing`);
      }
      ps.deck = shuffled(ps.deck, () => nextRandom(s));
      return;
    }
    case 'AddCounter': {
      for (const u of resolveTargetUnits(s, line.target, b)) {
        if (!targetConditionHolds(s, line.condition, u, b)) continue;
        if (eff.track === 'atk') u.atkCounters += eff.amount;
        else u.defCounters += eff.amount;
        log(s, `${u.name} ${eff.amount >= 0 ? 'gains' : 'loses'} ${Math.abs(eff.amount)} ${eff.track.toUpperCase()} counter(s)`);
      }
      return;
    }
    case 'GrantKeyword': {
      for (const u of resolveTargetUnits(s, line.target, b)) {
        if (!targetConditionHolds(s, line.condition, u, b)) continue;
        u.statuses.push({ id: nextId(s, 'st'), kind: 'Granted', amount: 0, duration: eff.duration, keyword: eff.keyword });
        log(s, `${u.name} gains ${eff.keyword}`);
      }
      return;
    }
    case 'GrantWallPass': {
      for (const u of resolveTargetUnits(s, line.target, b)) {
        if (!targetConditionHolds(s, line.condition, u, b)) continue;
        u.statuses.push({ id: nextId(s, 'st'), kind: 'WallPass', amount: 0, duration: eff.duration });
        log(s, `${u.name} can pass walls`);
      }
      return;
    }
    case 'Damage': {
      for (const u of resolveTargetUnits(s, line.target, b)) {
        if (!targetConditionHolds(s, line.condition, u, b)) continue;
        applyDamage(s, u, eff.amount);
      }
      return;
    }
    case 'Destroy': {
      for (const u of resolveTargetUnits(s, line.target, b)) {
        if (!targetConditionHolds(s, line.condition, u, b)) {
          log(s, `${u.name}: destroy condition not met — fizzles`);
          continue;
        }
        if (u.isLeader) {
          // TODO(open): working ruling — leaders are never destroyed as pieces, so a
          // trigger-fired Destroy (mine/trap catching a leader) fizzles against them.
          // Player-initiated casts keep the hard error as a targeting guard.
          if (b.lenient) {
            log(s, `${u.name} is a leader — Destroy fizzles`);
            continue;
          }
          fail('cannot Destroy a leader');
        }
        destroyUnit(s, u.id);
      }
      return;
    }
    case 'SummonToken': {
      const tiles = resolveTargetTiles(s, line.target, b);
      summonTokens(s, eff.tokenId, eff.count, tiles, b.owner);
      return;
    }
    case 'Push':
    case 'Pull': {
      const units = resolveTargetUnits(s, line.target, b);
      // Area displacement radiates from the AREA's center; single-target from the effect source.
      const isArea = line.target.t === 'Area3x3' || line.target.t === 'Area2x2';
      const origin = isArea ? (b.chosen?.[0] ?? b.sourcePos) : b.sourcePos;
      // Push outer units first so inner ones aren't blocked by their own pack.
      units.sort((x, y) => chebyshev(y.pos, origin) - chebyshev(x.pos, origin));
      if (eff.e === 'Pull') units.reverse();
      for (const u of units) {
        if (u.id === b.selfUnitId) continue;
        // Displacement can now spring zone traps, so an earlier iteration may have killed a
        // later target (or ended the game) — `units` is a snapshot taken before any of it.
        if (s.phase === 'gameover') return;
        if (!s.units[u.id]) continue;
        displaceUnit(s, u, origin, eff.tiles, eff.e === 'Push' ? 'push' : 'pull');
      }
      return;
    }
    case 'ApplyStatus': {
      for (const u of resolveTargetUnits(s, line.target, b)) {
        if (!targetConditionHolds(s, line.condition, u, b)) continue;
        applyStatus(s, u, eff.status, eff.amount, eff.duration);
      }
      return;
    }
    case 'Transform': {
      // Ascension. TODO(open): permanent (POC ruling); unit keeps name/cardId so fusion recipes still match (sim-1 ruling #9).
      for (const u of resolveTargetUnits(s, line.target, b)) {
        if (u.isLeader) fail('cannot Transform a leader');
        u.baseAtk = eff.atk;
        for (const k of eff.addKeywords ?? []) {
          if (!u.keywords.includes(k)) u.keywords.push(k);
        }
        log(s, `${u.name} ascends: ATK ${eff.atk}${eff.addKeywords ? ` +${eff.addKeywords.join(',')}` : ''}`);
      }
      return;
    }
    case 'RaiseFromGraveyard': {
      const tile = b.chosen?.[0] ?? fail('Raise needs a destination tile');
      const leader = leaderOf(s, b.owner);
      if (!mooreAdjacent(leader.pos).some((c) => sameCoord(c, tile))) {
        fail('Raise destination must be a summon-zone tile (leader surrounding-8)');
      }
      if (!isOpen(s, tile)) fail('Raise destination occupied or impassable');
      if (unitSlots(s, b.owner) >= RULES.unitCap) fail('unit cap reached');
      const grave = s.players[b.owner].graveyard;
      const wanted = b.chosenCards?.[0];
      // Card choice (2026-08-08). Scan back-to-front either way, so an unchosen Raise keeps the
      // exact pre-choice behaviour — "the most recent matching card" — that every sim suite, every
      // trigger-fired raise and Duneforged's Raise the Fallen were written against.
      let idx = -1;
      for (let i = grave.length - 1; i >= 0; i--) {
        const def = s.cardDefs[grave[i]!];
        if (def?.kind !== 'unit' || def.type !== eff.type) continue;
        if (wanted !== undefined && grave[i] !== wanted) continue;
        idx = i;
        break;
      }
      if (idx === -1) {
        // A named card that is not there is a bad action, not an empty graveyard: say which.
        if (wanted !== undefined) fail(`${wanted} is not a ${eff.type} in your graveyard`);
        fail(`no ${eff.type} in graveyard`);
      }
      const cardId = grave.splice(idx, 1)[0]!;
      spawnUnitFromCard(s, cardId, b.owner, tile);
      return;
    }
    case 'Draw': {
      drawCards(s, b.owner, eff.n);
      log(s, `player ${b.owner} draws ${eff.n}`);
      return;
    }
    case 'GainSP': {
      s.players[b.owner].sp += eff.n; // overflow-capable; expires at end of turn
      log(s, `player ${b.owner} gains ${eff.n} SP`);
      return;
    }
    case 'GrantMove': {
      for (const u of resolveTargetUnits(s, line.target, b)) {
        u.extraMove += eff.tiles;
      }
      return;
    }
    case 'FuseAdjacentFriendly': {
      const [c1, c2] = [b.chosen?.[0], b.chosen?.[1]];
      if (!c1 || !c2) fail('FuseAdjacentFriendly needs two unit targets');
      const u1 = unitAt(s, c1) ?? fail('no unit at first target');
      const u2 = unitAt(s, c2) ?? fail('no unit at second target');
      if (u1.owner !== b.owner || u2.owner !== b.owner) fail('materials must be friendly');
      if (!orthAdjacent(u1.pos).some((c) => sameCoord(c, u2.pos))) fail('materials must be adjacent');
      executeFusion(s, u1, u2, u2.pos);
      return;
    }
    case 'AuraAtk':
    case 'AuraAtkPerCount':
    case 'AuraDef':
      return; // standing auras: read by effectiveAtk/effectiveDef, never "executed"
  }
}

function spawnUnitFromCard(s: GameState, cardId: string, owner: PlayerId, pos: Coord): Unit {
  const def = s.cardDefs[cardId];
  if (def?.kind !== 'unit') fail(`${cardId} is not a unit card`);
  const u: Unit = {
    id: nextId(s, 'u'),
    owner,
    cardId,
    name: def.name,
    type: def.type,
    baseAtk: def.atk,
    baseDef: def.def ?? defaultDef(def.atk),
    level: def.level,
    pos,
    isToken: false,
    isLeader: false,
    stance: 'attack',
    sickTurns: RULES.summoningSickTurns,
    hasActed: false,
    movedThisTurn: false,
    keywords: [...def.keywords],
    range: def.range ?? 1,
    statuses: [],
    atkCounters: 0,
    defCounters: 0,
    extraMove: 0,
  };
  placeUnit(s, u);
  log(s, `${u.name} enters at (${pos.col},${pos.row})`);
  return u;
}

// ---------------------------------------------------------------------------
// Trap chain (before-completion, LIFO)
// ---------------------------------------------------------------------------

type TrapEvent =
  | { kind: 'moveIntoZone'; moverId: string; destination: Coord }
  | { kind: 'attack'; attackerId: string; defenderId: string }
  | { kind: 'spellActivation'; caster: PlayerId };

/**
 * Collect opposing traps triggered by an event, resolve them LIFO, consume them.
 * Returns false if any trap declared `negate` (the paused action must not complete).
 * NOTE: a trap activation is NOT a spell activation — traps keying on
 * "enemy activates a spell" do not chain off other traps (sim 8, locked).
 */
function fireTraps(s: GameState, event: TrapEvent): boolean {
  const defenderSide: PlayerId = s.active === 0 ? 1 : 0;
  const armed = Object.values(s.setCards)
    .filter((c) => c.owner === defenderSide && c.kind === 'trap')
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const triggered: SetCard[] = [];
  for (const trap of armed) {
    const def = s.cardDefs[trap.cardId] as TrapCardDef | undefined;
    if (!def || def.kind !== 'trap') continue;
    const trig = def.trigger;
    if (event.kind === 'moveIntoZone' && trig.t === 'zone') {
      // A zone trap keys on an ENEMY unit entering. On the ordinary move path the mover is
      // always the active player's unit and therefore always the trap owner's enemy, so this
      // check was historically redundant — but displacement can shove either side's unit
      // around, and without it a push would set off the moved unit's own side's traps.
      const mover = s.units[event.moverId];
      const zone = [trap.pos, ...mooreAdjacent(trap.pos)];
      if (mover && mover.owner !== trap.owner && zone.some((c) => sameCoord(c, event.destination))) {
        triggered.push(trap);
      }
    } else if (event.kind === 'attack' && trig.t === 'enemyAttacksFriendly') {
      triggered.push(trap);
    } else if (event.kind === 'spellActivation' && trig.t === 'enemyActivatesSpell') {
      triggered.push(trap);
    }
  }
  if (triggered.length === 0) return true;

  // LIFO: most recently added link resolves first.
  let negated = false;
  for (const trap of [...triggered].reverse()) {
    const def = s.cardDefs[trap.cardId] as TrapCardDef;
    log(s, `trap ${def.name} fires`);
    // Consume first: the trap leaves the board on activation; its effects may linger as statuses.
    tileAt(s.board, trap.pos).occupant = undefined;
    delete s.setCards[trap.id];
    s.players[trap.owner].graveyard.push(trap.cardId);
    const binding: Binding = {
      owner: trap.owner,
      sourcePos: trap.pos,
      triggeringUnitId: event.kind === 'moveIntoZone' ? event.moverId : event.kind === 'attack' ? event.attackerId : undefined,
      attackerId: event.kind === 'attack' ? event.attackerId : undefined,
      lenient: true,
    };
    for (const line of def.effects) execLine(s, line, binding);
    // The trap has fully resolved; anything keyed to "a trap sprang" fires now. Defaults to the
    // trap OWNER's side, so "whenever one of your traps fires" is the un-annotated reading.
    fireBoardTrigger(s, 'OnTrapTriggered', { subjectOwner: trap.owner, defaultScope: 'friendly' });
    if (def.interrupt === 'negate') negated = true;
  }
  return !negated;
}

// ---------------------------------------------------------------------------
// Combat (Rules Spec §5)
// ---------------------------------------------------------------------------

/** Fallback DEF for cards/tokens that carry no explicit `def` — tokens, and the sim-suite
 *  fixtures that predate two-stat combat. All registered deck content prints its own DEF. */
export const defaultDef = (atk: number): number => Math.round(atk * 0.5);

/**
 * Can the defender hit back at whoever just attacked it?
 *
 * A defender is fighting for its own tile, so a MELEE attacker — who came to it — is always in
 * reach; that keeps every pre-existing exchange, and Guard interception, exactly as it was. Only
 * a shot fired from beyond melee raises the question, and then the answer is the same one that
 * governs attacking generally: can this unit reach that tile? A range-1 shooter is adjacent and
 * gets hit back; a range-2 shooter is answered only by something that can itself reach two tiles
 * (an archer duel). This is the same principle as "striking back is attacking" — a unit does not
 * retaliate here because it CANNOT, not because a status says so.
 */
function canRetaliate(s: GameState, defender: Unit, attacker: Unit, ranged: boolean): boolean {
  if (!ranged) return true;
  if (orthAdjacent(defender.pos).some((c) => sameCoord(c, attacker.pos))) return true;
  return hasKeyword(defender, 'Ranged')
    && rangedTargets(s, defender).some((c) => sameCoord(c, attacker.pos));
}

/**
 * `OnAttack` / `OnDefend`, fired at the top of an exchange — BEFORE stats are read, so a pump or
 * a debuff here actually changes the outcome. That is the whole point of the pair: until now only
 * `OnKill` existed, so a card could only be rewarded for WINNING, and a body that mattered in a
 * fight it lost was unprintable.
 *
 * Firing mid-combat means a listener can legally kill, destroy or displace either combatant, so
 * this returns whether the exchange may still proceed. An attack whose target was shoved out of
 * reach simply does not happen — which is exactly what a defensive trick should do, not a bug to
 * paper over.
 *
 * Rules come from the unit AND, for a leader, its leader rules — same collection pattern as
 * `fireOnMove` / `fireOnKill`.
 */
function fireCombatTriggers(s: GameState, attacker: Unit, defender: Unit): boolean {
  const aPos = { ...attacker.pos };
  const dPos = { ...defender.pos };
  const fire = (u: Unit, trigger: 'OnAttack' | 'OnDefend', foeId: string) => {
    const rules: Rule[] = [...unitRules(s, u)];
    if (u.isLeader) rules.push(...s.leaders[u.owner].rules);
    for (const rule of rules) {
      if (rule.trigger !== trigger) continue;
      if (!s.units[u.id]) return; // killed by an earlier rule on this same unit
      execLine(s, rule, {
        owner: u.owner,
        sourcePos: u.pos,
        selfUnitId: u.id,
        triggeringUnitId: foeId,
        lenient: true,
      });
    }
  };
  fire(attacker, 'OnAttack', defender.id);
  if (s.phase !== 'gameover' && s.units[defender.id]) fire(defender, 'OnDefend', attacker.id);

  // Re-validate: everything below reads live positions and stats.
  if (s.phase === 'gameover') return false;
  if (!s.units[attacker.id] || !s.units[defender.id]) return false;
  if (!sameCoord(attacker.pos, aPos) || !sameCoord(defender.pos, dPos)) {
    log(s, `${attacker.name}'s attack is broken off — the fight moved`);
    return false;
  }
  return true;
}

function resolveCombat(s: GameState, attacker: Unit, defender: Unit, opts: { advance: boolean; ranged?: boolean }): void {
  // ⚠ Guard used to INTERCEPT here (2026-07-18 experiment, never enabled): an attack on a guarded
  // leader was redirected onto the guard. Re-spec'd 2026-08-09 to a PIN in the movement rule — see
  // `guardPins`. Combat is now completely Guard-free; the keyword decides where you may GO, never
  // who you end up fighting.
  if (!fireCombatTriggers(s, attacker, defender)) return;
  const battleTile = defender.pos;
  // A shot leaves the shooter where it stands, so terrain resolves per-tile rather than on the
  // battle tile for both — see `terrainTile` in stats.ts.
  const ranged = opts.ranged === true;
  const aEff = effectiveAtk(s, attacker, { role: 'attacker', battleTile, opponentId: defender.id, ranged });

  if (defender.isLeader) {
    // Attritional: chip lands FIRST (even if the attacker dies to the counter), then strikeback. No advance.
    s.players[defender.owner].leaderLife -= aEff;
    log(s, `${attacker.name} hits leader ${defender.name} for ${aEff} (LP ${s.players[defender.owner].leaderLife})`);
    checkWin(s);
    if (s.winner !== undefined) return;
    const dEff = effectiveAtk(s, defender, { role: 'defender', battleTile, opponentId: attacker.id, ranged });
    if (dEff >= aEff) {
      if (attacker.isLeader) {
        // TODO(open): leader-vs-leader is unruled. Working ruling: a leader is never
        // destroyed as a piece, so the strikeback that would destroy a unit attacker
        // chips the attacking leader's pool for dEff instead (same >= condition).
        s.players[attacker.owner].leaderLife -= dEff;
        log(s, `leader strikeback ${dEff} >= ${aEff}: ${attacker.name} takes ${dEff} to LP (${s.players[attacker.owner].leaderLife})`);
        checkWin(s);
      } else {
        log(s, `leader strikeback ${dEff} >= ${aEff}: ${attacker.name} destroyed`);
        destroyUnit(s, attacker.id);
      }
    }
    return;
  }

  // Two-stat combat: a unit in defense stance is attacked against its DEF, not its ATK.
  //
  // Checked BEFORE the attacker-is-a-leader branch (ruling 2026-08-04): a leader attacking a unit
  // in defense stance resolves exactly like any other attacker. The stance is a property of the
  // DEFENDER, so it cannot mean one thing against a body and nothing against a leader — and until
  // this ruling it meant nothing, because the leader branch was taken first and resolved against
  // the defender's ATK. That also keeps the vault's split intact rather than breaking it: "binary
  // for units" still decides the piece (the leader kills a wall it out-stats and takes no LP for
  // it, since leaders carry no Piercing), and "attritional for the leader" still bills the leader,
  // now as the wall's reflect onto its own pool instead of a full-ATK strikeback.
  if (defender.stance === 'defense') {
    resolveDefenseCombat(s, attacker, defender, battleTile, aEff, opts);
    return;
  }

  if (attacker.isLeader) {
    // Leader attacks a unit in ATTACK stance: binary for the unit, attritional for the leader.
    const dEff = effectiveAtk(s, defender, { role: 'defender', battleTile, opponentId: attacker.id, ranged });
    const helpless = cannotStrikeBack(defender) || !canRetaliate(s, defender, attacker, ranged);
    if (aEff > dEff || (helpless && aEff === dEff)) {
      destroyUnit(s, defender.id);
      log(s, `leader ${attacker.name} (${aEff}) kills ${defender.name} (${dEff})`);
      if (opts.advance) advanceAfterKill(s, attacker, battleTile);
      // Same resolution order as the unit path: destroy -> advance -> OnKill. This branch had no
      // fireOnKill call at all before 2026-08-04, so a leader that killed a unit in ATTACK stance
      // fired nothing — while the same leader killing a unit in DEFENSE stance did fire, because
      // that path routes through resolveDefenseCombat. An inconsistency, not a design.
      fireOnKill(s, attacker, battleTile);
    } else if (helpless) {
      log(s, `leader ${attacker.name} cannot break ${defender.name} (${dEff}), but it is helpless — no strikeback`);
    } else {
      // Defender survives and strikes back: chip to the attacking leader's pool.
      s.players[attacker.owner].leaderLife -= dEff;
      log(s, `leader ${attacker.name} fails to kill; strikeback ${dEff} to LP (${s.players[attacker.owner].leaderLife})`);
      checkWin(s);
    }
    return;
  }

  const dEff = effectiveAtk(s, defender, { role: 'defender', battleTile, opponentId: attacker.id, ranged });
  const aTot = aEff + flankBonus(s, attacker, battleTile);
  // A defender that cannot hurt its attacker loses ties, and a losing attacker bounces off
  // instead of dying. Two ways to be harmless: denied your offence, or unable to REACH.
  const helpless = cannotStrikeBack(defender) || !canRetaliate(s, defender, attacker, ranged);
  if (aTot > dEff || (helpless && aTot === dEff)) {
    const overflow = aTot - dEff;
    s.players[defender.owner].leaderLife -= overflow;
    log(s, `${attacker.name} (${aTot}) kills ${defender.name} (${dEff})${overflow > 0 ? `; ${overflow} overflow to LP (${s.players[defender.owner].leaderLife})` : ' — helpless, no strikeback'}`);
    destroyUnit(s, defender.id);
    if (opts.advance) advanceAfterKill(s, attacker, battleTile);
    fireOnKill(s, attacker, battleTile);
    checkWin(s);
  } else if (helpless) {
    // Out-statted but harmless: the attack simply fails. No death, no overflow, no advance.
    log(s, `${attacker.name} (${aTot}) cannot break ${defender.name} (${dEff}), but it is helpless — no strikeback`);
  } else if (aTot < dEff) {
    const overflow = dEff - aTot;
    s.players[attacker.owner].leaderLife -= overflow;
    log(s, `${attacker.name} (${aTot}) dies attacking ${defender.name} (${dEff}) — defender holds; ${overflow} overflow to LP (${s.players[attacker.owner].leaderLife})`);
    destroyUnit(s, attacker.id);
    checkWin(s);
  } else {
    log(s, `tie at ${aTot}: mutual destruction, no advance`);
    destroyUnit(s, defender.id);
    destroyUnit(s, attacker.id);
  }
}

/**
 * Unit vs a unit in DEFENSE STANCE (Rules Spec §5, ratified 2026-08-04 — the promotion of the
 * 2026-07-21 two-stat prototype). The defender is fought against its effective DEF:
 *
 *   A > D   defence broken, defender destroyed. LP passes ONLY if the attacker Pierces, which
 *           tramples the whole margin (A−D). A non-piercer takes the piece and nothing else.
 *   A < D   the wall holds and REFLECTS (D−A) to the attacker's owner. No counter-kill: a wall
 *           punishes what it turns away, it does not destroy it.
 *   A = D   the wall holds. Nothing happens to either side.
 *
 * Flank still boosts the attacker — walls crack by numbers — but DEF never flanks: a defender
 * is holding a tile, not massing on one. A LEADER attacker gets no flank bonus either, because
 * leaders neither grant nor receive one (see RULES.flankPerAlly); it is otherwise resolved here
 * exactly like a unit attacker.
 *
 * Piercing is defined here and nowhere else: it converts overkill into LP. It does NOT reduce,
 * ignore or bypass any DEF (the prototype's `ignoreFrac`), so a wall taller than your ATK still
 * stops a piercer dead and reflects. That is what makes its +1 DC honest — the keyword buys
 * reach past the body, never a discount on the body.
 *
 * Two branches the prototype carried are deliberately NOT here. A non-piercing break concedes no
 * LP (`overflowFrac`: falsified twice, and letting everyone trample would leave Piercing as
 * nothing but a discount), and a failed break chips nothing (`failChipFrac`: near-null at both
 * doses, and the turtle-fatigue it was written against turned out to be the never-shuffled-decks
 * bug, fixed 2026-08-01).
 */
function resolveDefenseCombat(
  s: GameState,
  attacker: Unit,
  defender: Unit,
  battleTile: Coord,
  aEff: number,
  opts: { advance: boolean; ranged?: boolean },
): void {
  const aTot = aEff + (attacker.isLeader ? 0 : flankBonus(s, attacker, battleTile));
  const wall = effectiveDef(s, defender, { role: 'defender', battleTile, opponentId: attacker.id, ranged: opts.ranged === true });

  if (aTot > wall) {
    // Wall broken. LP passes only if the attacker Pierces (trample the excess).
    if (hasKeyword(attacker, 'Piercing')) {
      const trample = aTot - wall;
      s.players[defender.owner].leaderLife -= trample;
      log(s, `${attacker.name} (${aTot}) vs ${defender.name} defense ${wall}: defense broken, pierces ${trample} to LP (${s.players[defender.owner].leaderLife})`);
    } else {
      log(s, `${attacker.name} (${aTot}) vs ${defender.name} defense ${wall}: defense broken, no LP`);
    }
    destroyUnit(s, defender.id);
    if (opts.advance) advanceAfterKill(s, attacker, battleTile);
    fireOnKill(s, attacker, battleTile);
    checkWin(s);
  } else if (cannotStrikeBack(defender) || !canRetaliate(s, defender, attacker, opts.ranged === true)) {
    // A stunned or out-of-reach wall still holds — suppression of the counter is not a free break
    // — but it reflects nothing. Attacking it is merely wasted, never punished.
    log(s, `${attacker.name} (${aTot}) vs ${defender.name} defense ${wall}: wall holds, but it is helpless — no reflect`);
  } else if (aTot < wall) {
    // Wall holds and reflects the shortfall onto the attacker's owner. No counter-kill.
    const reflect = wall - aTot;
    s.players[attacker.owner].leaderLife -= reflect;
    log(s, `${attacker.name} (${aTot}) vs ${defender.name} defense ${wall}: wall holds, ${reflect} reflect to LP (${s.players[attacker.owner].leaderLife})`);
    checkWin(s);
  } else {
    log(s, `${attacker.name} (${aTot}) vs ${defender.name} defense ${wall}: wall holds`);
  }
}

/** Flanking bonus for a unit attacking a unit (see RULES.flankPerAlly above). */
function flankBonus(s: GameState, attacker: Unit, battleTile: Coord): number {
  const n = Math.min(RULES.flankMaxAllies, flankAllies(s, battleTile, attacker.owner, attacker.id));
  if (n > 0) log(s, `${attacker.name} flanks with ${n} all${n === 1 ? 'y' : 'ies'}: +${RULES.flankPerAlly * n}`);
  return RULES.flankPerAlly * n;
}

function advanceAfterKill(s: GameState, attacker: Unit, tile: Coord): void {
  if (!s.units[attacker.id]) return; // died mid-resolution (shouldn't happen, but safe)
  /**
   * ⚠ THE TILE MAY HAVE STOPPED BEING ENTERABLE WHILE WE KILLED THE THING ON IT. `destroyUnit`
   * fires the victim's `OnDeath` BEFORE this runs, so a body that paints terrain as it dies can
   * turn its own tile into a Wall in the attacker's face — which would otherwise strand a unit
   * inside impassable terrain, the one state the Wall rules exist to prevent.
   *
   * The kill still stands; only the advance is denied. That is the honest reading and it makes the
   * thicket a real cost to the attacker rather than a free tile.
   */
  if (!canOccupy(s, tile, attacker)) {
    log(s, `${attacker.name} cannot advance onto (${tile.col},${tile.row}) — the ground closed`);
    return;
  }
  moveUnitOnBoard(s, attacker, tile);
  log(s, `${attacker.name} advances onto (${tile.col},${tile.row})`);
}

function fireOnKill(s: GameState, attacker: Unit, destination: Coord): void {
  if (!s.units[attacker.id]) return;
  // Resolution order (locked): combat -> destroy -> advance -> On-Kill fires with position updated.
  // A leader's own OnKill rules fire here too, exactly as `fireOnMove` does for OnMove — without
  // this the rule parses, type-checks and silently never runs (`validateLeader` now guards the
  // inverse case, a leader rule on a trigger nothing dispatches).
  const rules: Rule[] = [...unitRules(s, attacker)];
  if (attacker.isLeader) rules.push(...s.leaders[attacker.owner].rules);
  for (const rule of rules) {
    if (rule.trigger !== 'OnKill') continue;
    execLine(s, rule, {
      owner: attacker.owner,
      sourcePos: attacker.pos,
      selfUnitId: attacker.id,
      destinationTile: destination,
      lenient: true,
    });
  }
}

function fireOnMove(s: GameState, mover: Unit, path: Coord[]): void {
  const rules: Rule[] = [...unitRules(s, mover)];
  if (mover.isLeader) rules.push(...s.leaders[mover.owner].rules);
  for (const rule of rules) {
    if (rule.trigger !== 'OnMove') continue;
    execLine(s, rule, {
      owner: mover.owner,
      sourcePos: mover.pos,
      selfUnitId: mover.id,
      pathTiles: path,
      lenient: true,
    });
  }
}

function checkWin(s: GameState): void {
  for (const p of [0, 1] as const) {
    if (s.players[p].leaderLife <= 0) {
      s.winner = p === 0 ? 1 : 0;
      s.phase = 'gameover';
      s.pendingBurn = undefined; // a hand-cap choice can't outlive the game
      log(s, `player ${s.winner} wins — leader LP depleted`);
      // TODO(open): simultaneous lethal / checkmate not modeled (POC: LP<=0 only).
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Movement reach
// ---------------------------------------------------------------------------

/** Legal movement range: 1 + extraMove orthogonal steps through empty tiles; the final tile may be occupied (attack/fuse/contact). */
/**
 * Extra movement from standing on your own favored terrain (2026-08-05 experiment, default 0).
 *
 * The half of DotR's terrain system Terraforma didn't inherit: there, favored terrain granted the
 * stat bonus AND a second move, so painting governed mobility as well as combat. Here that makes a
 * painting leader able to lay a highway its own tribe travels on.
 *
 * Reads the tile the unit STANDS on when the move begins, not tiles crossed — the same "reads
 * where the unit stands" rule the aura architecture uses, and it keeps the movement budget from
 * being path-dependent. Applies to leaders too: they are Units on this same path, and under
 * Support Range a leader that must come forward is exactly who wants the road.
 */
function favoredMoveBonus(s: GameState, u: Unit): number {
  if (RULES.favoredTerrainMove <= 0) return 0;
  return tileAt(s.board, u.pos).terrain === favoredTerrain(u.type) ? RULES.favoredTerrainMove : 0;
}

/**
 * GUARD (pin) — the enemy Guards this unit is currently stuck to.
 *
 * > While a unit stands orthogonally adjacent to an enemy Guard, it may not end a move on an
 * > EMPTY tile that is not also orthogonally adjacent to that Guard. **Attacks are unaffected.**
 *
 * Re-spec'd 2026-08-09 from the never-enabled interception version. The vault had already moved:
 * `Crowd Control & Status Effects.md` describes Guard as "you cannot walk past me" and rules out
 * taunt on the grounds that Guard "already does the useful half" — the engine simply never
 * followed. The old A/B was vacuous anyway (0/3840) because no card carried the keyword.
 *
 * ⚠ WHY THIS CANNOT SOFT-LOCK, which is the whole reason it restricts only moves onto EMPTY tiles.
 * The CC note warns that while-standing movement denial soft-locks, but that was about denial
 * STATUSES, where the victim can do nothing at all. Here movement IS attacking, so a pinned unit
 * always has the Guard itself as a legal target, may always shuffle between the Guard's other
 * adjacent tiles, and may always pass. It is pinned, never frozen.
 *
 * Rulings, and why:
 *   · LEADERS ARE PINNED. The 2026-08-02 leader CC-immunity fizzles denial STATUSES at the
 *     `applyStatus` chokepoint; a pin is a positional fact about a body on the board, not a status,
 *     so it does not reach. A pinned leader can always swing at the Guard.
 *   · TOKENS CANNOT GUARD (carried over from the interception spec) — a token engine would make
 *     the pin free and endless.
 *   · SUMMONING-SICK UNITS CANNOT GUARD. No emergency screens: a Guard costs a turn before it bites.
 *   · `Suppressed` TURNS IT OFF for free, because `hasKeyword` in status.ts is the single place
 *     keyword possession is decided.
 *   · PUSH/PULL IGNORE IT. Forced movement is not the unit's move, so displacement is the designed
 *     counterplay — and `Anchored` is in turn the answer to that.
 *   · TWO GUARDS INTERSECT: the destination must satisfy every Guard the unit is adjacent to. That
 *     can legally leave zero moves, which is fine — attack, or pass.
 */
export function guardPins(s: GameState, u: Unit): Unit[] {
  const pins: Unit[] = [];
  for (const c of orthAdjacent(u.pos)) {
    const g = unitAt(s, c);
    if (!g || g.owner === u.owner || g.isToken || isSick(g)) continue;
    if (!hasKeyword(g, 'Guard')) continue;
    pins.push(g);
  }
  return pins;
}

/** Is this unit currently held by at least one enemy Guard? The AI evaluator's read on the pin. */
export const isPinnedByGuard = (s: GameState, u: Unit): boolean => guardPins(s, u).length > 0;

/** Tiles this unit may cross in one turn. Shared so every mover reads the same number. */
function moveRange(s: GameState, u: Unit): number {
  return 1 + u.extraMove + favoredMoveBonus(s, u);
}

function reachableDestinations(s: GameState, u: Unit): Coord[] {
  // Single source for BOTH `doMove`'s validation and `legalActions`, so engine and AI cannot
  // disagree about where a unit may go — unlike the located-ability reach rule, which is
  // implemented twice and needs `abilityReach()` to keep the two in step.
  const range = moveRange(s, u);
  // Guard restricts the DESTINATION, not the route: with a multi-tile move you may still path
  // around, you just cannot come to rest anywhere that is not still beside every Guard on you.
  const pins = guardPins(s, u);
  const pinned = (c: Coord) =>
    pins.every((g) => orthAdjacent(g.pos).some((t) => t.col === c.col && t.row === c.row));
  const seen = new Map<string, number>();
  const key = (c: Coord) => `${c.col},${c.row}`;
  const out: Coord[] = [];
  const queue: { c: Coord; d: number }[] = [{ c: u.pos, d: 0 }];
  seen.set(key(u.pos), 0);
  while (queue.length > 0) {
    const { c, d } = queue.shift()!;
    if (d === range) continue;
    for (const n of orthAdjacent(c)) {
      if (seen.has(key(n))) continue;
      seen.set(key(n), d + 1);
      // A Wall this unit cannot pass is neither a destination nor a route. Note the knock-on:
      // an enemy standing ON a wall (only a wall-passer can be there) is likewise unreachable
      // by a unit that cannot pass walls — it has to be answered with Ranged or an effect.
      if (isWall(s, n) && !canPassWalls(u)) continue;
      // An occupied tile is an ATTACK (or a fuse) and Guard never restricts those — only the
      // walking-away half. That exemption is what keeps the pin from being a lock.
      if (!isEmpty(s, n) || pinned(n)) out.push(n);
      if (isEmpty(s, n)) queue.push({ c: n, d: d + 1 }); // can only pass THROUGH empty tiles
    }
  }
  return out;
}

/**
 * Steps this unit needs to REACH each empty tile it can walk to, its own tile at 0.
 *
 * ⚠ Mirrors the traversal half of `reachableDestinations` — same range, same empty-tiles-only
 * routing, same wall rule — and must be kept in step with it. It exists separately because closing
 * to contact needs DISTANCES, which that function discards: it returns the set of destinations,
 * and an attack target is not a tile the attacker ends up standing on.
 */
function stepsToEmptyTiles(s: GameState, u: Unit): Map<string, number> {
  const range = moveRange(s, u);
  const key = (c: Coord) => `${c.col},${c.row}`;
  const dist = new Map<string, number>([[key(u.pos), 0]]);
  const queue: { c: Coord; d: number }[] = [{ c: u.pos, d: 0 }];
  while (queue.length > 0) {
    const { c, d } = queue.shift()!;
    if (d === range) continue;
    for (const n of orthAdjacent(c)) {
      if (dist.has(key(n))) continue;
      if (isWall(s, n) && !canPassWalls(u)) continue;
      if (!isEmpty(s, n)) continue; // routes run through empty ground only
      dist.set(key(n), d + 1);
      queue.push({ c: n, d: d + 1 });
    }
  }
  return dist;
}

/**
 * Where a melee attacker comes to rest when it has to CLOSE on `target`: the nearest empty tile
 * orthogonally beside it. `undefined` when the unit already stands in contact (nothing to travel)
 * or when no adjacent tile is both empty and reachable.
 *
 * The tile is guaranteed to be within the unit's move where one exists at all: `doMove` has
 * already validated the target as a reachable destination, and the BFS only reaches it THROUGH an
 * empty neighbour, so the nearest such neighbour is at most `range - 1` steps away.
 */
function approachTile(s: GameState, u: Unit, target: Coord): Coord | undefined {
  if (orthAdjacent(target).some((c) => sameCoord(c, u.pos))) return undefined; // already in contact
  const dist = stepsToEmptyTiles(s, u);
  let best: Coord | undefined;
  let bestD = Infinity;
  for (const c of orthAdjacent(target)) {
    const d = dist.get(`${c.col},${c.row}`);
    if (d === undefined || d >= bestD || !canOccupy(s, c, u)) continue;
    best = c;
    bestD = d;
  }
  return best;
}

/**
 * Walk a melee attacker up to its target before it strikes.
 *
 * A unit with more than one tile of movement that attacked something several tiles away never
 * actually travelled — it struck from where it stood, which is a Ranged attack by another name.
 * It now stops on the last tile of its route, in contact, and fights from there.
 *
 * Routed through `moveUnitOnBoard` (as an advance-after-kill is) so the arrival is a real one:
 * sigils bite and springs are captured. That means the approach can KILL the attacker, so this
 * reports whether there is still an attack left to resolve.
 */
function closeToContact(s: GameState, u: Unit, target: Coord): boolean {
  const stop = approachTile(s, u, target);
  if (stop) {
    moveUnitOnBoard(s, u, stop);
    log(s, `${u.name} closes to (${stop.col},${stop.row})`);
  }
  return s.units[u.id] !== undefined;
}

// Status predicates live in status.ts so board/stats can read them without importing the engine.
export {
  cannotAttack, cannotMove, cannotStrikeBack, DENIAL_STATUSES, hasKeyword,
  isDisarmed, isSnared, isStunned, isSuppressed,
} from './status';

// ---------------------------------------------------------------------------
// Fusion
// ---------------------------------------------------------------------------

export function findFusionResult(s: GameState, owner: PlayerId, cardA: string, cardB: string): string | undefined {
  for (const fid of s.players[owner].fusionPool) {
    const def = s.cardDefs[fid];
    if (def?.kind !== 'unit' || !def.fusion) continue;
    const [m1, m2] = def.fusion.materials;
    if ((m1 === cardA && m2 === cardB) || (m1 === cardB && m2 === cardA)) return fid;
  }
  return undefined;
}

/**
 * ⚠ THE FUSED UNIT INHERITS ITS MATERIALS' UNSPENT ACTION (2026-08-08).
 *
 * Previously the fused body always arrived having acted, so assembling cost a full turn of tempo
 * from two units and returned one that could do nothing. The rule now is: **if either material
 * still had its action, the fusion has one.**
 *
 * On the move path that reduces exactly to "did the STATIONARY material still have its action?",
 * because `doMove` has already spent the mover's — the move onto the tile IS the fuse. So:
 *   · assemble on one turn, fuse on the next  -> the fusion swings immediately;
 *   · attack with the stationary body first, then fuse into it -> the fusion arrives inert.
 * The player chooses which, and the cost is legible either way.
 *
 * ⚠ This supersedes the vault's *proposed* (never locked) "no fuse-and-swing burst". Two fresh
 * materials can now fuse and attack in the same turn — that is the point, and it is bounded by the
 * assembly being visible for at least a turn beforehand.
 */
function executeFusion(s: GameState, mover: Unit, stationary: Unit, destination: Coord): void {
  const owner = mover.owner;
  const resultId = findFusionResult(s, owner, mover.cardId, stationary.cardId) ?? fail('not a registered fusion pair');
  // Both materials consumed. TODO(open): ruled materials go to the graveyard (spent cards).
  for (const mat of [mover, stationary]) {
    tileAt(s.board, mat.pos).occupant = undefined;
    delete s.units[mat.id];
    if (!mat.isToken) s.players[owner].graveyard.push(mat.cardId);
  }
  s.players[owner].fusionPool = s.players[owner].fusionPool.filter((id) => id !== resultId);
  const fused = spawnUnitFromCard(s, resultId, owner, destination);
  fused.hasActed = mover.hasActed && stationary.hasActed;
  log(s, `fusion: ${mover.name} + ${stationary.name} -> ${fused.name}`);
  checkSpringCapture(s, fused);
}

// ---------------------------------------------------------------------------
// Spell resolution
// ---------------------------------------------------------------------------

/** Located effects resolve at their location: every chosen target tile must be within reach 1 of the resolve position. */
function checkLocatedReach(def: SpellCardDef, resolvePos: Coord, targets: Coord[] | undefined): void {
  if (def.scope !== 'located') return;
  for (const c of targets ?? []) {
    if (chebyshev(c, resolvePos) > 1) {
      // TODO(open): "at/adjacent" reach ruled as Chebyshev <= 1 from where the spell resolves
      // (leader position for face-up casts, the set card's tile for flips).
      fail(`located spell out of reach of (${c.col},${c.row}) — set it face-down and travel it`);
    }
  }
}

/**
 * The player-supplied half of a spell activation. Grew into a bag when card choice landed: with
 * `targets`, `chosenCards` and `triggeringUnitId` all optional, four positional `undefined`s at the
 * call sites were worse than naming them.
 */
interface SpellResolution {
  /** Chosen TILES. */
  targets?: Coord[];
  /** Chosen CARD ids from a zone — see `Action.chosenCards`. */
  chosenCards?: string[];
  /** Set only for contact-triggered resolutions (mines), which makes the whole line lenient. */
  triggeringUnitId?: string;
}

function resolveSpell(s: GameState, def: SpellCardDef, owner: PlayerId, resolvePos: Coord, opt: SpellResolution = {}): void {
  const { targets, chosenCards, triggeringUnitId } = opt;
  const binding: Binding = {
    owner,
    sourcePos: resolvePos,
    chosen: targets,
    chosenCards,
    triggeringUnitId,
    // Contact-triggered resolutions (mines) fizzle on impossible effects instead
    // of failing the mover's action; player casts pass targets and stay strict.
    lenient: triggeringUnitId !== undefined,
  };
  for (const line of def.effects) execLine(s, line, binding);
  s.players[owner].graveyard.push(def.id);
  log(s, `spell ${def.name} resolves`);
  // `OnSpellCast` fires on a player ACTIVATION only, never on a mine. A mine detonates off enemy
  // contact rather than being activated (it pays no SP either, for the same reason), and
  // `triggeringUnitId === undefined` is already this function's discriminator for that — it is
  // what decides `lenient` above. Fires after resolution, so a listener never mutates the board
  // mid-spell.
  if (triggeringUnitId === undefined) {
    fireBoardTrigger(s, 'OnSpellCast', { subjectOwner: owner, defaultScope: 'friendly' });
  }
}

/** A face-down located spell is a mine/boon if any of its effects target the triggering unit. */
function isUnitAffecting(def: SpellCardDef): boolean {
  return def.effects.some((l) => l.target.t === 'TriggeringUnit');
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * Timed statuses tick at the start of the AFFECTED unit's controller's turn.
 *
 * `turnsLeft: N` means "present during exactly N of the victim's own turns" — the vault's
 * locked reading (Non-Unit Cards: "'stunned for 2 turns' always costs the victim exactly
 * 2 of its own activations"). Getting that requires dropping a status that is ALREADY spent
 * rather than decrementing-then-dropping-at-zero: the naive order retires the status at the
 * start of the Nth turn, before the victim ever acts on it, so N only ever cost N−1
 * activations. Checking before decrementing also makes the "applied during the victim's own
 * turn" case behave — it costs N full turns *after* the one it landed on, per the vault's
 * "decrements on each subsequent turn the victim takes (not the turn applied)".
 */
function tickStatuses(s: GameState, p: PlayerId): void {
  for (const u of Object.values(s.units)) {
    if (u.owner !== p) continue;
    u.statuses = u.statuses.filter((st) => {
      if (st.duration.kind !== 'turns') return true;
      if (st.duration.turnsLeft === 0) return false; // spent on the previous turn — retire it now
      st.duration.turnsLeft -= 1;
      return true;
    });
  }
}

function startTurn(s: GameState): void {
  const p = s.active;
  const ps = s.players[p];
  ps.turnCount += 1;
  if (p === 0 && ps.turnCount > 1) s.round += 1;

  // Start phase: sickness clears, statuses tick, springs relight.
  for (const u of Object.values(s.units)) {
    if (u.owner === p) {
      // Cleared for the ACTIVE player only (2026-08-04 fix). Clearing every unit here made
      // `DefenderUnmovedThisTurn` inert: an enemy defender was wiped clean at the start of your
      // turn, so it always read "unmoved" and the punish bonus always applied. Scoped to the
      // owner, the flag now means "moved during its own most recent turn" — i.e. PARKED — which
      // is what a punish-passive is for and what the condition's name always claimed.
      u.movedThisTurn = false;
      if (u.sickTurns > 0) u.sickTurns -= 1;
      u.hasActed = false;
      u.extraMove = 0;
    }
  }
  for (const c of Object.values(s.setCards)) {
    if (c.owner === p) c.hasActed = false;
  }
  tickStatuses(s, p);

  // Resource phase: SP refresh (not accrual), then draw 1.
  //
  // ⚠ ACCRUAL WAS PROTOTYPED AND REVERTED (2026-08-09). Flat 3/turn banking to a raised cap was
  // built behind a knob and measured: it does NOT work with the pool as costed. Refresh hands you a
  // full allowance every turn regardless of what you spent last turn, so every turn is an
  // independent chance at an 8-cost; accrual makes every purchase compete with every other across
  // time, and 6+ SP bodies played collapsed 3.33 -> 0.17 per game. Even at DOUBLE the income it
  // stayed 60% below refresh, and an eval term for banking (`spSaving`) barely moved it — a linear
  // bonus cannot express three turns of abstinence. Adopting accrual means re-costing the top end
  // down from 7-8 to ~4-5, pool-wide; it is not a knob. Full write-up in the vault's Open Threads.
  ps.sp = spMax(ps.turnCount);
  if (p === 1 && ps.turnCount === 1) ps.sp += 1; // going-second coin: one-time, non-bankable
  drawCards(s, p, 1); // TODO(open): P1's first draw not skipped (sim-1 gap #1, unresolved)

  // Springs relight nominally in the Start phase, but an occupy-at-relight capture
  // grants +3 SP that must survive the Resource refresh — so relight resolves after it.
  relightSprings(s);
  log(s, `— player ${p} turn ${ps.turnCount} (round ${s.round}): ${ps.sp} SP`);
  fireStartOfTurn(s);
}

/**
 * StartOfTurn rules fire only for the ACTIVE player's leader and units, after
 * the full start sequence (status tick → SP refresh → draw → spring relight),
 * so effects see fresh SP and the post-relight board. Burn deaths chain
 * OnDeath normally; leader LP damage can end the game during the start phase.
 */
function fireStartOfTurn(s: GameState): void {
  const p = s.active;
  const leaderUnit = leaderOf(s, p);
  for (const rule of s.leaders[p].rules) {
    if (rule.trigger !== 'StartOfTurn') continue;
    execLine(s, rule, { owner: p, sourcePos: leaderUnit.pos, selfUnitId: leaderUnit.id, lenient: true });
  }
  const mine = Object.values(s.units).filter((u) => u.owner === p && !u.isLeader && !u.isToken);
  for (const u of mine) {
    for (const rule of unitRules(s, u)) {
      if (rule.trigger !== 'StartOfTurn') continue;
      if (!s.units[u.id]) break; // destroyed by an earlier StartOfTurn effect
      execLine(s, rule, { owner: p, sourcePos: u.pos, selfUnitId: u.id, lenient: true });
    }
  }
}

function relightSprings(s: GameState): void {
  for (let col = 1; col <= 7; col++) {
    for (let row = 1; row <= 7; row++) {
      const tile = tileAt(s.board, { col, row });
      if (!tile.spring || tile.springActive) continue;
      if (tile.springRelightRound !== undefined && s.round >= tile.springRelightRound) {
        tile.springActive = true;
        tile.springRelightRound = undefined;
        log(s, `spring at (${col},${row}) relights`);
        // Occupying at relight counts as a capture (sim-1 ruling #10a).
        const occ = tile.occupant;
        if (occ?.kind === 'unit') {
          const u = s.units[occ.id];
          if (u) checkSpringCapture(s, u);
        }
      }
    }
  }
}

/**
 * EndOfTurn rules for the ACTIVE player's leader and units — the mirror of `fireStartOfTurn`.
 * Runs BEFORE endOfTurn statuses expire and before unspent SP is discarded, so a rule can still
 * see the turn it is ending: "if you summoned this turn", "spend what you didn't use".
 */
function fireEndOfTurn(s: GameState): void {
  const p = s.active;
  const leaderUnit = leaderOf(s, p);
  for (const rule of s.leaders[p].rules) {
    if (rule.trigger !== 'EndOfTurn') continue;
    execLine(s, rule, { owner: p, sourcePos: leaderUnit.pos, selfUnitId: leaderUnit.id, lenient: true });
  }
  const mine = Object.values(s.units).filter((u) => u.owner === p && !u.isLeader).map((u) => u.id);
  for (const id of mine) {
    const u = s.units[id];
    if (!u) continue; // destroyed by an earlier EndOfTurn effect
    for (const rule of unitRules(s, u)) {
      if (rule.trigger !== 'EndOfTurn') continue;
      if (!s.units[id]) break;
      execLine(s, rule, { owner: p, sourcePos: u.pos, selfUnitId: u.id, lenient: true });
    }
  }
}

function endTurn(s: GameState): void {
  fireEndOfTurn(s);
  if (s.phase === 'gameover') return; // an EndOfTurn burn can close the game
  // End phase: end-of-turn effects expire; unspent SP is discarded.
  for (const u of Object.values(s.units)) {
    u.statuses = u.statuses.filter((st) => st.duration.kind !== 'endOfTurn');
    u.extraMove = 0;
  }
  s.players[s.active].sp = 0;
  s.active = s.active === 0 ? 1 : 0;
  startTurn(s);
}

// ---------------------------------------------------------------------------
// Action application
// ---------------------------------------------------------------------------

export function applyAction(prev: GameState, a: Action): GameState {
  if (prev.phase === 'gameover') fail('game is over');
  // A pending hand-cap burn blocks everything else until resolved.
  // TODO(open): pendingBurn for the NON-active player (e.g. a future trap that draws)
  // has no actor model yet — current content only draws on the owner's own turn.
  if (prev.pendingBurn && a.t !== 'BurnCard') fail('hand over cap — burn a card to the void first');
  const s = cloneState(prev);
  switch (a.t) {
    case 'Summon':
      doSummon(s, a.card, a.tile);
      break;
    case 'Move':
      doMove(s, a.unit, a.to);
      break;
    case 'RangedAttack':
      doRangedAttack(s, a.unit, a.target);
      break;
    case 'SetCard':
      doSetCard(s, a.card, a.tile, a.stance);
      break;
    case 'MoveSet':
      doMoveSet(s, a.set, a.to);
      break;
    case 'FlipCard':
      doFlipCard(s, a.set, a.targets, a.chosenCards);
      break;
    case 'CastSpell':
      doCastSpell(s, a.card, a.targets, a.chosenCards);
      break;
    case 'ActivateAbility':
      doActivateAbility(s, a.targets, a.chosenCards);
      break;
    case 'SetStance':
      doSetStance(s, a.unit, a.stance);
      break;
    case 'BurnCard':
      doBurnCard(s, a.index);
      break;
    case 'EndTurn':
      endTurn(s);
      break;
  }
  return s;
}

function activeHandCard(s: GameState, cardId: string): number {
  const idx = s.players[s.active].hand.indexOf(cardId);
  if (idx === -1) fail(`${cardId} not in hand`);
  return idx;
}

function doSummon(s: GameState, cardId: string, tile: Coord): void {
  const ps = s.players[s.active];
  const idx = activeHandCard(s, cardId);
  const def = s.cardDefs[cardId];
  if (def?.kind !== 'unit') fail('not a unit card');
  const leader = leaderOf(s, s.active);
  if (!mooreAdjacent(leader.pos).some((c) => sameCoord(c, tile))) fail('summon must be in the leader summon zone (surrounding 8)');
  if (!inBounds(tile) || !isOpen(s, tile)) fail('summon tile must be an empty, passable tile');
  if (ps.sp < unitSpCost(def)) fail(`not enough SP (${ps.sp} < ${unitSpCost(def)})`);
  if (unitSlots(s, s.active) >= RULES.unitCap) fail(`unit cap (${RULES.unitCap} units) reached`);
  ps.sp -= unitSpCost(def);
  ps.hand.splice(idx, 1);
  const u = spawnUnitFromCard(s, cardId, s.active, tile);
  for (const rule of def.rules) {
    if (rule.trigger !== 'OnSummon') continue;
    // OnSummon with a chosen target is not supported in the Action payload for POC —
    // Grave Tyrant's targeted Destroy picks the first legal enemy. TODO: target choice.
    execLine(s, rule, autoBindChosen(s, rule, { owner: s.active, sourcePos: u.pos, selfUnitId: u.id }));
  }
  fireLeaderOnSummon(s, u);
  // Board-wide summon reactions. Both fire AFTER the summon has fully resolved — `OnEnemySummon`
  // responds, it never negates (that stays the trap layer's job), so by here the new unit is a
  // real piece on a real tile and a condition inspecting it reads its true state.
  fireBoardTrigger(s, 'OnSummonAlly', { subjectOwner: u.owner, triggeringUnitId: u.id, defaultScope: 'friendly', excludeUnitId: u.id });
  fireBoardTrigger(s, 'OnEnemySummon', { subjectOwner: u.owner, triggeringUnitId: u.id, defaultScope: 'enemy' });
  if (s.units[u.id]) checkSpringCapture(s, u); // summoning onto an active spring: entering is entering
}

/**
 * The leader's own OnSummon rules — "whenever you summon a unit". The leader IS the summoning
 * hub (see the vault's The Leader), so this is the most natural leader trigger in the game, and
 * it had no dispatch site at all before 2026-08-04: `doSummon` only ever read the summoned
 * card's own rules.
 *
 * Scope is deliberately the HARD SUMMON from hand — the act that pays SP and occupies a
 * summon-zone tile. Token spawns (`SummonToken`) and graveyard returns (`RaiseFromGraveyard`)
 * run through their own paths and do NOT fire this: a Brood Matron whose free per-turn spawn
 * also triggered an OnSummon payoff would be paying itself, and recursion decks would double-dip.
 *
 * Binding vocabulary: `TriggeringUnit` = the unit just summoned, `Self` = the leader, and the
 * effect resolves FROM the leader's tile (so a located effect measures reach from the leader,
 * consistently with every other leader rule).
 */
function fireLeaderOnSummon(s: GameState, summoned: Unit): void {
  const leader = leaderOf(s, summoned.owner);
  for (const rule of s.leaders[summoned.owner].rules) {
    if (rule.trigger !== 'OnSummon') continue;
    execLine(s, rule, {
      owner: summoned.owner,
      sourcePos: leader.pos,
      selfUnitId: leader.id,
      triggeringUnitId: summoned.id,
      lenient: true,
    });
  }
}

/** For OnSummon rules with Chosen* targets, auto-pick the first legal candidate (POC shortcut). */
function autoBindChosen(s: GameState, rule: Rule, b: Binding): Binding {
  if (rule.target.t !== 'ChosenEnemy' && rule.target.t !== 'ChosenUnit') return { ...b, lenient: true };
  for (const u of Object.values(s.units)) {
    if (u.isLeader) continue;
    if (rule.target.t === 'ChosenEnemy' && u.owner === b.owner) continue;
    if (!targetConditionHolds(s, rule.condition, u, b)) continue;
    return { ...b, chosen: [u.pos], lenient: true };
  }
  return { ...b, chosen: undefined, lenient: true };
}

function doMove(s: GameState, unitId: string, to: Coord): void {
  const u = s.units[unitId] ?? fail('no such unit');
  if (u.owner !== s.active) fail('not your unit');
  if (u.hasActed) fail('unit already acted this turn');
  if (cannotMove(u)) fail('unit cannot move');
  if (!inBounds(to)) fail('destination out of bounds');
  if (!reachableDestinations(s, u).some((c) => sameCoord(c, to))) fail('destination not reachable');

  const occ = tileAt(s.board, to).occupant;
  u.hasActed = true;

  // --- Attack ---
  if (occ?.kind === 'unit') {
    const target = s.units[occ.id]!;
    if (target.owner !== u.owner) {
      if (cannotAttack(u)) fail('unit cannot attack');
      if (isSick(u)) fail('summoning-sick units cannot attack');
      // Before-completion: zone traps + attack traps pause the attack.
      const zoneOk = fireTraps(s, { kind: 'moveIntoZone', moverId: u.id, destination: to });
      const atkOk = fireTraps(s, { kind: 'attack', attackerId: u.id, defenderId: target.id });
      if (!zoneOk || !atkOk) {
        log(s, `${u.name}'s attack is negated`);
        return;
      }
      if (!s.units[u.id]) return; // attacker was destroyed by a trap
      if (!s.units[target.id]) {
        // Defender was removed by a trap; the move completes as a plain move.
        completePlainMove(s, u, to);
        return;
      }
      // A melee attacker has to reach its target. Against a LEADER that never happened: the leader
      // branch of `resolveCombat` deliberately does not advance (you cannot take a leader's tile),
      // so a unit with 2+ movement chipped LP from where it stood without ever closing — melee at
      // a distance. It now walks up and stops in contact first.
      //
      // Only leaders need this here. Against a unit the attacker already ends up on the battle
      // tile when it kills (`advanceAfterKill`), and staying put when it fails to kill is the
      // deliberate "the wall turns it away" rule rather than an oversight.
      if (target.isLeader && !closeToContact(s, u, target.pos)) return;
      resolveCombat(s, u, target, { advance: true });
      return;
    }
    // --- Friendly destination: fuse or illegal ---
    if (findFusionResult(s, u.owner, u.cardId, target.cardId)) {
      if (cannotMove(target)) fail('stationary fusion material cannot move'); // conservative
      executeFusion(s, u, target, target.pos);
      return;
    }
    fail('cannot move onto a friendly unit (unless a registered fusion pair)');
  }

  // --- Set-card destination ---
  if (occ?.kind === 'set') {
    const set = s.setCards[occ.id]!;
    const def = s.cardDefs[set.cardId]!;
    if (set.owner !== u.owner) {
      if (def.kind === 'unit') {
        if (cannotAttack(u)) fail('unit cannot attack');
        // Attacking a face-down unit flips it up; combat then resolves normally.
        // ⚠ Does NOT force 'defense' any more (2026-08-16). Being face-down is concealment, not
        // a posture: the card fights on whatever stance it was set in, exactly as it would have
        // if its owner had flipped it up themselves.
        const defender = flipSetUnitUp(s, set);
        log(s, `${defender.name} flips face-up, attacked by ${u.name}`);
        resolveCombat(s, u, defender, { advance: true });
        return;
      }
      if (def.kind === 'trap') {
        // Enemy trap: stepping onto its own tile is a zone entry.
        const ok = fireTraps(s, { kind: 'moveIntoZone', moverId: u.id, destination: to });
        if (!ok) return;
        if (s.units[u.id] && canOccupy(s, to, u)) completePlainMove(s, u, to);
        return;
      }
      if (def.kind === 'spell') {
        if (isUnitAffecting(def)) {
          triggerMine(s, set, def, u, to);
        } else {
          // Board spell attacked while face-down -> destroyed.
          tileAt(s.board, set.pos).occupant = undefined;
          delete s.setCards[set.id];
          s.players[set.owner].graveyard.push(set.cardId);
          log(s, `face-down board spell ${def.name} destroyed`);
          completePlainMove(s, u, to);
        }
        return;
      }
      fail('unreachable');
    }
    // Own set card: mines trigger friend-or-foe; own traps/boards are illegal to step on.
    if (def.kind === 'spell' && isUnitAffecting(def)) {
      triggerMine(s, set, def, u, to);
      return;
    }
    fail('cannot move onto your own set card');
  }

  // --- Plain move into empty tile (zone traps may still fire) ---
  const ok = fireTraps(s, { kind: 'moveIntoZone', moverId: u.id, destination: to });
  if (!ok) {
    log(s, `${u.name}'s move is negated`);
    return;
  }
  if (!s.units[u.id]) return; // destroyed by trap
  if (!canOccupy(s, to, u)) return; // trap effects blocked the tile somehow
  completePlainMove(s, u, to);
}

function completePlainMove(s: GameState, u: Unit, to: Coord): void {
  const from = u.pos;
  moveUnitOnBoard(s, u, to);
  // TODO(open): path for multi-tile moves is not tracked tile-by-tile; OnMove paint uses
  // origin-exclusive straight-line interpolation when aligned, else just the destination.
  const path = interpolatePath(from, to);
  fireOnMove(s, u, path);
}

function interpolatePath(from: Coord, to: Coord): Coord[] {
  const path: Coord[] = [];
  if (from.col === to.col || from.row === to.row) {
    const steps = Math.abs(from.col - to.col) + Math.abs(from.row - to.row);
    const dc = Math.sign(to.col - from.col);
    const dr = Math.sign(to.row - from.row);
    for (let i = 1; i <= steps; i++) path.push({ col: from.col + dc * i, row: from.row + dr * i });
  } else {
    path.push(to);
  }
  return path;
}

function triggerMine(s: GameState, set: SetCard, def: SpellCardDef, mover: Unit, to: Coord): void {
  // Pinpoint contact: only the exact tile. Friend or foe. One-shot.
  tileAt(s.board, set.pos).occupant = undefined;
  delete s.setCards[set.id];
  log(s, `${mover.name} steps onto ${def.name} — it triggers`);
  resolveSpell(s, def, set.owner, set.pos, { triggeringUnitId: mover.id });
  if (s.units[mover.id] && canOccupy(s, to, mover)) completePlainMove(s, mover, to);
}

function doRangedAttack(s: GameState, unitId: string, target: Coord): void {
  const u = s.units[unitId] ?? fail('no such unit');
  if (u.owner !== s.active) fail('not your unit');
  if (!hasKeyword(u, 'Ranged')) fail('unit is not Ranged');
  if (u.hasActed) fail('unit already acted this turn');
  // Snared is deliberately absent: shrugging off a snare is exactly what Ranged is for.
  if (cannotAttack(u)) fail('unit cannot attack');
  if (isSick(u)) fail('summoning-sick units cannot attack');
  if (!rangedTargets(s, u).some((c) => sameCoord(c, target))) {
    // Range 1 keeps the original wording — that phrasing is what pre-existing tests assert, and
    // holding it fixed is the proof that a range-1 shooter behaves exactly as it always did.
    fail(u.range <= 1
      ? 'ranged target must be orthogonally adjacent'
      : `ranged target must be exactly ${u.range} orthogonal tiles away, in line and unblocked by a Wall`);
  }
  const defender = unitAt(s, target) ?? fail('no unit at target');
  if (defender.owner === u.owner) fail('cannot attack a friendly unit');
  u.hasActed = true;
  const ok = fireTraps(s, { kind: 'attack', attackerId: u.id, defenderId: defender.id });
  if (!ok) return;
  if (!s.units[u.id] || !s.units[defender.id]) return;
  resolveCombat(s, u, defender, { advance: false, ranged: true }); // no exposure: never advances
}

function doSetCard(s: GameState, cardId: string, tile: Coord, stance: 'attack' | 'defense' = 'attack'): void {
  const ps = s.players[s.active];
  const idx = activeHandCard(s, cardId);
  const def = s.cardDefs[cardId];
  if (def?.kind !== 'spell' && def?.kind !== 'trap' && def?.kind !== 'unit') {
    fail('only units, spells, or traps can be set');
  }
  const leader = leaderOf(s, s.active);
  if (!mooreAdjacent(leader.pos).some((c) => sameCoord(c, tile))) fail('set must be in the leader summon zone');
  if (!isOpen(s, tile)) fail('set tile must be an empty, passable tile');
  // A face-down unit is a hidden summon: costs its summon SP and takes a slot in the unit cap.
  // A trap or a mine prepays here too (`setSpCost`) — neither can ever be charged at activation,
  // which happens on the opponent's turn. A travelling board spell still sets free and pays at flip.
  // Everything that is not a unit takes a slot in the non-unit cap.
  const cost = setSpCost(def);
  if (ps.sp < cost) fail(`not enough SP to set ${def.name} (${ps.sp} < ${cost})`);
  if (def.kind === 'unit') {
    if (unitSlots(s, s.active) >= RULES.unitCap) fail(`unit cap (${RULES.unitCap} units) reached`);
  } else if (setCardCount(s, s.active) >= RULES.nonUnitCap) {
    fail(`non-unit cap (${RULES.nonUnitCap} set cards) reached`);
  }
  ps.sp -= cost;
  ps.hand.splice(idx, 1);
  const sc: SetCard = {
    id: nextId(s, 'sc'),
    owner: s.active,
    cardId,
    kind: def.kind,
    pos: tile,
    hasActed: false,
    setTurnCount: ps.turnCount,
    // Only a unit has a stance to hold. Spells and traps store 'attack' as an inert default so
    // the field is never undefined; nothing reads it for them.
    stance: def.kind === 'unit' ? stance : 'attack',
  };
  s.setCards[sc.id] = sc;
  tileAt(s.board, tile).occupant = { kind: 'set', id: sc.id };
  // Identical log for every set card — the back must not reveal what it is (universal bluff).
  log(s, `a card is set face-down at (${tile.col},${tile.row})`);
}

/**
 * Reveal a face-down unit as a real unit on its tile. Used by manual flip-summon and by
 * an enemy attacking it. Does NOT re-fire OnSummon — Set is a distinct action from Summon.
 *
 * Since 2026-08-04 it DOES fire `OnFlip`, which is what makes the universal bluff a real
 * mind-game: a set card can now punish the attack that revealed it, rather than the back being
 * pure information-hiding. The single chokepoint for both reveal paths, so a flip triggers
 * however it happened.
 */
function flipSetUnitUp(s: GameState, sc: SetCard, opts?: { sick?: boolean }): Unit {
  const def = s.cardDefs[sc.cardId];
  if (def?.kind !== 'unit') fail('not a face-down unit');
  tileAt(s.board, sc.pos).occupant = undefined;
  delete s.setCards[sc.id];
  const u = spawnUnitFromCard(s, sc.cardId, sc.owner, sc.pos);
  // The stance it was SET in, whatever revealed it. This is the single chokepoint for both
  // reveal paths, so flip-summon and being-attacked can no longer disagree about the stat the
  // card fights on (they used to: attack-reveal forced 'defense', flip-summon left 'attack').
  u.stance = sc.stance;
  u.sickTurns = opts?.sick ? Math.max(1, RULES.summoningSickTurns) : 0;
  for (const rule of unitRules(s, u)) {
    if (rule.trigger !== 'OnFlip') continue;
    execLine(s, rule, { owner: u.owner, sourcePos: u.pos, selfUnitId: u.id, lenient: true });
  }
  if (s.units[u.id]) checkSpringCapture(s, u); // flipping onto an active spring counts as occupying it
  return u;
}

function doMoveSet(s: GameState, setId: string, to: Coord): void {
  const sc = s.setCards[setId] ?? fail('no such set card');
  if (sc.owner !== s.active) fail('not your set card');
  if (sc.hasActed) fail('set card already moved this turn');
  if (!orthAdjacent(sc.pos).some((c) => sameCoord(c, to))) fail('set cards move 1 tile orthogonally');
  if (!isOpen(s, to)) fail('destination occupied or impassable');
  // Moving a trap into reach of an enemy does NOT trigger it (locked).
  tileAt(s.board, sc.pos).occupant = undefined;
  tileAt(s.board, to).occupant = { kind: 'set', id: sc.id };
  sc.pos = to;
  sc.hasActed = true;
  log(s, `a face-down card moves to (${to.col},${to.row})`);
}

function doSetStance(s: GameState, unitId: string, stance: 'attack' | 'defense'): void {
  const u = s.units[unitId] ?? fail('no such unit');
  if (u.owner !== s.active) fail('not your unit');
  if (u.isLeader) fail('leaders cannot take a defense stance');
  if (isStunned(u)) fail('unit is stunned');
  if (isSick(u)) fail('a unit cannot change stance the turn it arrives');
  if (u.hasActed) fail('unit has already acted this turn');
  if (u.stance === stance) fail('unit is already in that stance');
  u.stance = stance;
  u.hasActed = true; // a stance change consumes the unit's action for the turn
  log(s, `${u.name} takes a ${stance} stance`);
}

function doFlipCard(s: GameState, setId: string, targets?: Coord[], chosenCards?: string[]): void {
  const sc = s.setCards[setId] ?? fail('no such set card');
  if (sc.owner !== s.active) fail('not your set card');
  const def = s.cardDefs[sc.cardId];
  if (def?.kind === 'unit') {
    // Flip-summon: reveal as a unit. Summoning-sick only if set this same turn.
    const sick = sc.setTurnCount === s.players[s.active].turnCount;
    const u = flipSetUnitUp(s, sc, { sick });
    log(s, `${u.name} flips face-up${sick ? ' (summoning sick)' : ''}`);
    return;
  }
  if (def?.kind !== 'spell') fail('the setter cannot flip their own trap');
  checkLocatedReach(def, sc.pos, targets);
  // A mine already paid its SP when it was set (`setSpCost`); flipping it up manually rather than
  // waiting for contact must not bill the same card twice.
  if (!isUnitAffecting(def)) paySpellSp(s, def);
  // Flipping a set spell is a spell activation: opposing traps may chain (before-completion).
  tileAt(s.board, sc.pos).occupant = undefined;
  delete s.setCards[sc.id];
  const ok = fireTraps(s, { kind: 'spellActivation', caster: s.active });
  if (!ok) {
    s.players[s.active].graveyard.push(sc.cardId);
    log(s, `spell ${def.name} is negated`);
    return;
  }
  resolveSpell(s, def, s.active, sc.pos, { targets, chosenCards });
}

/** Charge a spell's SP at activation, before traps chain — like the card itself, the SP is lost if negated. */
function paySpellSp(s: GameState, def: SpellCardDef): void {
  const cost = spellSpCost(def);
  if (cost === 0) return;
  const ps = s.players[s.active];
  if (ps.sp < cost) fail(`not enough SP for ${def.name} (${ps.sp} < ${cost})`);
  ps.sp -= cost;
  log(s, `${def.name} costs ${cost} SP`);
}

function doCastSpell(s: GameState, cardId: string, targets?: Coord[], chosenCards?: string[]): void {
  const ps = s.players[s.active];
  const idx = activeHandCard(s, cardId);
  const def = s.cardDefs[cardId];
  if (def?.kind !== 'spell') fail('not a spell');
  // Face-up = instant, resolves from your zone (the leader's position anchors located reach).
  const leader = leaderOf(s, s.active);
  checkLocatedReach(def, leader.pos, targets);
  paySpellSp(s, def);
  ps.hand.splice(idx, 1);
  const ok = fireTraps(s, { kind: 'spellActivation', caster: s.active });
  if (!ok) {
    ps.graveyard.push(cardId);
    log(s, `spell ${def.name} is negated`);
    return;
  }
  resolveSpell(s, def, s.active, leader.pos, { targets, chosenCards });
}

/**
 * How far a LOCATED leader ability reaches.
 *
 * ⚠ This rule is enforced here AND enumerated independently by `targeting.ts` (`inReach`), so the
 * two must read the same source or the bot proposes targets the engine rejects. Exported for
 * exactly that reason — `targeting.ts` calls this rather than keeping its own copy.
 *
 * Located SPELL travel is deliberately NOT this: that is a spell rule and stays at 1.
 */
export function abilityReach(): number {
  return RULES.supportRange > 0 ? RULES.supportRange : 1;
}

function doActivateAbility(s: GameState, targets?: Coord[], chosenCards?: string[]): void {
  const ps = s.players[s.active];
  const ability = s.leaders[s.active].ability;
  if (ps.sp < ability.cost) fail(`not enough SP for ${ability.name}`);
  const leader = leaderOf(s, s.active);
  if (ability.located) {
    for (const c of targets ?? []) {
      if (chebyshev(c, leader.pos) > abilityReach()) fail(`${ability.name}: target out of the leader's reach`);
    }
  }
  ps.sp -= ability.cost;
  log(s, `${s.leaders[s.active].name} activates ${ability.name} (-${ability.cost} SP)`);
  const binding: Binding = {
    owner: s.active,
    sourcePos: leader.pos,
    selfUnitId: leader.id,
    chosen: targets,
    chosenCards,
  };
  for (const line of ability.effects) execLine(s, line, binding);
  // Payoff hook: cards that reward using the leader's active. Fires after the ability resolves,
  // so choosing an active also chooses which payoff cards switch on.
  fireBoardTrigger(s, 'OnAbilityCast', { subjectOwner: s.active, defaultScope: 'friendly' });
}

// ---------------------------------------------------------------------------
// Game setup
// ---------------------------------------------------------------------------

export interface PlayerConfig {
  leader: import('./types').LeaderDef;
  deck: string[];       // card def ids, draw order (index 0 = top)
  fusionPool: string[];
}

export interface GameConfig {
  board: import('./types').Board;
  cardDefs: Record<string, import('./types').CardDef>;
  tokenDefs: Record<string, import('./types').TokenDef>;
  players: [PlayerConfig, PlayerConfig];
  /**
   * Seed for mid-game randomness (see `GameState.rngSeed`). Optional and defaulted, so every
   * existing caller is unchanged. Callers that already seed their DECK shuffle — the A/B harness,
   * `scripts/diagnose.ts`, the AI tests — should pass the same seed here once any content
   * consumes randomness, so a run stays reproducible end to end.
   */
  seed?: number;
}

export function initGame(cfg: GameConfig): GameState {
  const s: GameState = {
    board: structuredClone(cfg.board),
    units: {},
    setCards: {},
    players: [freshPlayer(cfg.players[0]), freshPlayer(cfg.players[1])],
    active: 0,
    round: 1,
    phase: 'action',
    voidPile: [],
    nextId: 1,
    rngSeed: cfg.seed ?? DEFAULT_SEED,
    log: [],
    cardDefs: structuredClone(cfg.cardDefs),
    tokenDefs: structuredClone(cfg.tokenDefs),
    leaders: [structuredClone(cfg.players[0].leader), structuredClone(cfg.players[1].leader)],
  };
  // Leaders start at (4,1) / (4,7).
  const starts: [Coord, Coord] = [{ col: 4, row: 1 }, { col: 4, row: 7 }];
  for (const p of [0, 1] as const) {
    const ld = s.leaders[p];
    const u: Unit = {
      id: `leader${p}`,
      owner: p,
      cardId: ld.id,
      name: ld.name,
      type: ld.type,
      baseAtk: ld.atk,
      baseDef: 0, // leaders never take a defense stance
      level: 0,
      pos: starts[p],
      isToken: false,
      isLeader: true,
      stance: 'attack',
      sickTurns: 0, // leaders are never summoning-sick
      hasActed: false,
      movedThisTurn: false,
      keywords: ld.range !== undefined ? ['Ranged'] : [],
      // A leader that declares a range IS a shooter — carrying `range` without the keyword
      // would leave it unable to use the very attack the field exists for.
      range: ld.range ?? 1,
      statuses: [],
      atkCounters: 0,
      defCounters: 0,
      extraMove: 0,
    };
    placeUnit(s, u);
    drawCards(s, p, RULES.startingHand);
  }
  startTurn(s); // P1's start+resource phases run; state rests in the action phase
  return s;
}

function freshPlayer(cfg: PlayerConfig): import('./types').PlayerState {
  return {
    leaderLife: RULES.startingLife,
    sp: 0,
    hand: [],
    deck: [...cfg.deck],
    graveyard: [],
    fusionPool: [...cfg.fusionPool],
    turnCount: 0,
    fatigue: 0,
  };
}

/**
 * Test-fixture helper: spawn a unit directly (no SP, no zone check, no OnSummon triggers).
 * Mutates the given state. Not part of the game API.
 */
export function debugSpawn(
  s: GameState,
  cardId: string,
  owner: PlayerId,
  pos: Coord,
  opts?: { sick?: boolean },
): Unit {
  const u = spawnUnitFromCard(s, cardId, owner, pos);
  u.sickTurns = opts?.sick ? Math.max(1, RULES.summoningSickTurns) : 0;
  return u;
}

// ---------------------------------------------------------------------------
// Legal actions (UI highlighting; not exhaustive for target-bearing actions)
// ---------------------------------------------------------------------------

export function legalActions(s: GameState): Action[] {
  if (s.phase === 'gameover') return [];
  if (s.pendingBurn) {
    // Forced choice: one BurnCard per burnable card (everything but the incoming last card).
    const hand = s.players[s.pendingBurn.player].hand;
    return hand.slice(0, -1).map((_, index) => ({ t: 'BurnCard', index }));
  }
  const out: Action[] = [{ t: 'EndTurn' }];
  const ps = s.players[s.active];
  const leader = leaderOf(s, s.active);
  const zone = mooreAdjacent(leader.pos).filter((c) => isOpen(s, c));

  for (const cardId of new Set(ps.hand)) {
    const def = s.cardDefs[cardId];
    if (!def) continue;
    if (def.kind === 'unit' && ps.sp >= unitSpCost(def) && unitSlots(s, s.active) < RULES.unitCap) {
      // A unit can be summoned face-up or set face-down (same cost & cap), and a face-down unit
      // chooses its stance on the way down — since 2026-08-16 that is the ONLY way a hidden unit
      // can end up fighting on DEF, so both stances must be offered or the option is unreachable.
      for (const tile of zone) {
        out.push({ t: 'Summon', card: cardId, tile });
        out.push({ t: 'SetCard', card: cardId, tile, stance: 'attack' });
        out.push({ t: 'SetCard', card: cardId, tile, stance: 'defense' });
      }
    }
    // Setting is no longer free: a trap pays its own SP here and a mine prepays its spell SP,
    // so the offer has to be affordable or `doSetCard` would throw on it.
    if ((def.kind === 'spell' || def.kind === 'trap')
      && ps.sp >= setSpCost(def)
      && setCardCount(s, s.active) < RULES.nonUnitCap) {
      for (const tile of zone) out.push({ t: 'SetCard', card: cardId, tile });
    }
    if (def.kind === 'spell' && def.scope === 'global' && ps.sp >= spellSpCost(def)) {
      out.push({ t: 'CastSpell', card: cardId });
    }
  }

  for (const u of Object.values(s.units)) {
    if (u.owner !== s.active || u.hasActed) continue;
    // The denial axis splits here rather than skipping the unit wholesale: a Disarmed unit can
    // still reposition, and a Snared one can still shoot if it is Ranged. Every branch below
    // mirrors a guard in doMove/doRangedAttack — legalActions must never offer an action that
    // would then throw (the fuzz suite runs these fully bound, with no benign-error allowlist).
    const stuck = cannotMove(u);
    const unarmed = cannotAttack(u);
    // A defending unit cannot move or attack; it may only switch back to attack (below).
    if (u.stance === 'defense') {
      if (!isSick(u) && !isStunned(u)) out.push({ t: 'SetStance', unit: u.id, stance: 'attack' });
      continue;
    }
    if (!u.isLeader && !isSick(u) && !isStunned(u)) {
      out.push({ t: 'SetStance', unit: u.id, stance: 'defense' });
    }
    if (!stuck) {
      for (const to of reachableDestinations(s, u)) {
        const occ = tileAt(s.board, to).occupant;
        if (occ?.kind === 'unit') {
          const t = s.units[occ.id]!;
          if (t.owner !== u.owner && !isSick(u) && !unarmed) out.push({ t: 'Move', unit: u.id, to });
          else if (t.owner === u.owner && !cannotMove(t) && findFusionResult(s, u.owner, u.cardId, t.cardId)) out.push({ t: 'Move', unit: u.id, to });
        } else if (occ?.kind === 'set') {
          const sc = s.setCards[occ.id]!;
          const def = s.cardDefs[sc.cardId]!;
          // An enemy face-down UNIT is attacked (so offence denial applies); anything else is
          // mine contact, which is not an attack.
          if (sc.owner !== u.owner) {
            if (def.kind !== 'unit' || !unarmed) out.push({ t: 'Move', unit: u.id, to });
          } else if (def.kind === 'spell' && isUnitAffecting(def)) {
            out.push({ t: 'Move', unit: u.id, to });
          }
        } else {
          out.push({ t: 'Move', unit: u.id, to });
        }
      }
    }
    if (hasKeyword(u, 'Ranged') && !isSick(u) && !unarmed) {
      for (const c of rangedTargets(s, u)) {
        const t = unitAt(s, c);
        if (t && t.owner !== u.owner) out.push({ t: 'RangedAttack', unit: u.id, target: c });
      }
    }
  }

  for (const sc of Object.values(s.setCards)) {
    if (sc.owner !== s.active || sc.hasActed) continue;
    for (const to of orthAdjacent(sc.pos)) {
      if (isOpen(s, to)) out.push({ t: 'MoveSet', set: sc.id, to });
    }
    const def = s.cardDefs[sc.cardId];
    // Owner can flip up their own set spell (resolve it, paying its SP) or set unit (flip-summon);
    // never a trap. A mine prepaid at set, so it can always be flipped regardless of SP now.
    if (def?.kind === 'unit'
      || (def?.kind === 'spell' && (isUnitAffecting(def) || ps.sp >= spellSpCost(def)))) {
      out.push({ t: 'FlipCard', set: sc.id });
    }
  }

  if (ps.sp >= s.leaders[s.active].ability.cost) out.push({ t: 'ActivateAbility' });
  return out;
}
