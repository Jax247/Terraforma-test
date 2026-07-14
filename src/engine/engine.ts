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
  sameCoord,
  tileAt,
  unitAt,
} from './board';
import { effectiveAtk } from './stats';
import type {
  Action,
  Condition,
  Coord,
  Duration,
  Effect,
  GameState,
  PlayerId,
  Rule,
  SetCard,
  SpellCardDef,
  SpellEffectLine,
  TargetSpec,
  TrapCardDef,
  Unit,
} from './types';

export const UNIT_CAP = 5;
export const NONUNIT_CAP = 5;
export const SPRING_SP = 3;
export const SPRING_RECHARGE_ROUNDS = 3;
export const STARTING_LIFE = 200;
export const STARTING_HAND = 5;

function fail(msg: string): never {
  throw new Error(msg);
}

function nextId(s: GameState, prefix: string): string {
  const id = `${prefix}${s.nextId}`;
  s.nextId += 1;
  return id;
}

function log(s: GameState, msg: string): void {
  s.log.push(msg);
}

export function spMax(turnCount: number): number {
  return Math.min(12, 4 + 3 * (turnCount - 1));
}

// ---------------------------------------------------------------------------
// Binding context for effect execution
// ---------------------------------------------------------------------------

interface Binding {
  owner: PlayerId;          // controller of the effect
  sourcePos: Coord;         // where the effect resolves from (unit / set card / leader)
  selfUnitId?: string;
  chosen?: Coord[];         // player-supplied targets
  triggeringUnitId?: string;
  attackerId?: string;
  pathTiles?: Coord[];      // OnMove
  destinationTile?: Coord;  // OnKill
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

function setCardCount(s: GameState, p: PlayerId): number {
  return Object.values(s.setCards).filter((c) => c.owner === p).length;
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
  const def = s.cardDefs[u.cardId];
  if (def?.kind === 'unit') {
    for (const rule of def.rules) {
      if (rule.trigger !== 'OnDeath') continue;
      execLine(s, { effect: rule.effect, target: rule.target, condition: rule.condition }, {
        owner: u.owner,
        sourcePos: u.pos,
        selfUnitId: u.id,
      });
    }
  }
}

function moveUnitOnBoard(s: GameState, u: Unit, to: Coord): void {
  tileAt(s.board, u.pos).occupant = undefined;
  const tile = tileAt(s.board, to);
  if (tile.occupant) fail(`cannot move onto occupied tile (${to.col},${to.row})`);
  tile.occupant = { kind: 'unit', id: u.id };
  u.pos = to;
  u.movedThisTurn = true;
  checkSpringCapture(s, u);
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
  tile.springRelightRound = s.round + SPRING_RECHARGE_ROUNDS;
  s.players[u.owner].sp += SPRING_SP; // overflows the cap; expires at end of turn
  log(s, `${u.name} captures the spring at (${u.pos.col},${u.pos.row}): +${SPRING_SP} SP`);
  fireOnCapture(s, u);
}

function fireOnCapture(s: GameState, capturer: Unit): void {
  const def = s.cardDefs[capturer.cardId];
  const rules: Rule[] = def?.kind === 'unit' ? def.rules : [];
  for (const rule of rules) {
    if (rule.trigger !== 'OnCapture') continue;
    execLine(s, rule, { owner: capturer.owner, sourcePos: capturer.pos, selfUnitId: capturer.id });
  }
  // TODO(open): leader OnCapture (Oskar "OnCapture -> Draw 1") ruled to fire on ANY
  // friendly capture, not only the leader's own.
  for (const rule of s.leaders[capturer.owner].rules) {
    if (rule.trigger !== 'OnCapture') continue;
    execLine(s, rule, {
      owner: capturer.owner,
      sourcePos: leaderOf(s, capturer.owner).pos,
      selfUnitId: leaderOf(s, capturer.owner).id,
    });
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
    case 'Attacker': {
      const u = b.attackerId ? s.units[b.attackerId] : undefined;
      return u ? [u] : [];
    }
    case 'ChosenUnit':
    case 'ChosenEnemy': {
      const c = b.chosen?.[0];
      if (!c) fail('target required');
      const u = unitAt(s, c);
      if (!u) fail('no unit at target');
      if (target.t === 'ChosenEnemy' && u.owner === b.owner) fail('must target an enemy');
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
    case 'AdjacentEmptyTiles':
      return mooreAdjacent(b.sourcePos).filter((c) => isEmpty(s, c));
    case 'EmptyTileNear': {
      const empty = mooreAdjacent(b.sourcePos).filter((c) => isEmpty(s, c));
      return empty.length > 0 ? [empty[0]!] : [];
    }
    default:
      return [];
  }
}

function conditionHolds(s: GameState, cond: Condition | undefined, targetUnit: Unit | undefined): boolean {
  if (!cond) return true;
  switch (cond.k) {
    case 'EffAtkAtMost':
      // TODO(open): reads EFFECTIVE ATK (derived-stats architecture; sim-1 gap #8).
      return targetUnit !== undefined && effectiveAtk(s, targetUnit) <= cond.amount;
    case 'DefenderUnmovedThisTurn':
      return true; // combat-context only; handled inside effectiveAtk
  }
}

function displaceUnit(s: GameState, u: Unit, origin: Coord, tiles: number, mode: 'push' | 'pull'): void {
  if (u.keywords.includes('Rooted')) {
    log(s, `${u.name} is Rooted — displacement has no effect`);
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
    if (!inBounds(next) || !isEmpty(s, next)) break;
    cur = next;
  }
  if (!sameCoord(cur, u.pos)) {
    moveUnitOnBoard(s, u, cur);
    log(s, `${u.name} displaced to (${cur.col},${cur.row})`);
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
  if (amount >= effectiveAtk(s, target)) {
    log(s, `${target.name} destroyed by ${amount} damage`);
    destroyUnit(s, target.id);
  } else {
    log(s, `${target.name} survives ${amount} damage`);
  }
}

function summonTokens(s: GameState, tokenId: string, count: number, tiles: Coord[], owner: PlayerId): void {
  const def = s.tokenDefs[tokenId] ?? fail(`unknown token ${tokenId}`);
  // TODO(open): overflow ruling — place as many as fit, extras fizzle.
  for (let i = 0; i < count && i < tiles.length; i++) {
    const pos = tiles[i]!;
    const u: Unit = {
      id: nextId(s, 'u'),
      owner,
      cardId: def.id,
      name: def.name,
      type: def.type,
      baseAtk: def.atk,
      level: 0,
      pos,
      isToken: true,
      isLeader: false,
      summoningSick: true, // tokens get summoning sickness too
      hasActed: false,
      movedThisTurn: false,
      keywords: [...def.keywords],
      statuses: [],
      extraMove: 0,
    };
    placeUnit(s, u);
    log(s, `token ${u.name} appears at (${pos.col},${pos.row})`);
  }
}

let statusSeq = 0;

function applyStatus(s: GameState, u: Unit, kind: 'Immobilized' | 'AtkMod', amount: number, duration: Duration): void {
  u.statuses.push({ id: `st${statusSeq++}`, kind, amount, duration: structuredClone(duration) });
  log(s, `${u.name} gains ${kind}${kind === 'AtkMod' ? ` ${amount}` : ''}`);
}

function drawCards(s: GameState, p: PlayerId, n: number): void {
  for (let i = 0; i < n; i++) {
    const card = s.players[p].deck.shift();
    if (card === undefined) return; // empty deck: stop drawing — never a loss
    s.players[p].hand.push(card);
  }
}

function execLine(s: GameState, line: SpellEffectLine, b: Binding): void {
  const eff: Effect = line.effect;
  switch (eff.e) {
    case 'PaintTerrain': {
      for (const c of resolveTargetTiles(s, line.target, b)) {
        tileAt(s.board, c).terrain = eff.terrain;
      }
      log(s, `terrain painted ${eff.terrain}`);
      return;
    }
    case 'Damage': {
      for (const u of resolveTargetUnits(s, line.target, b)) {
        if (!conditionHolds(s, line.condition, u)) continue;
        applyDamage(s, u, eff.amount);
      }
      return;
    }
    case 'Destroy': {
      for (const u of resolveTargetUnits(s, line.target, b)) {
        if (!conditionHolds(s, line.condition, u)) {
          log(s, `${u.name}: destroy condition not met — fizzles`);
          continue;
        }
        if (u.isLeader) fail('cannot Destroy a leader');
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
      // Push outer units first so inner ones aren't blocked by their own pack.
      units.sort((x, y) => chebyshev(y.pos, b.sourcePos) - chebyshev(x.pos, b.sourcePos));
      if (eff.e === 'Pull') units.reverse();
      for (const u of units) {
        if (u.id === b.selfUnitId) continue;
        displaceUnit(s, u, b.sourcePos, eff.tiles, eff.e === 'Push' ? 'push' : 'pull');
      }
      return;
    }
    case 'ApplyStatus': {
      for (const u of resolveTargetUnits(s, line.target, b)) {
        if (!conditionHolds(s, line.condition, u)) continue;
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
      if (!isEmpty(s, tile)) fail('Raise destination occupied');
      if (realUnitCount(s, b.owner) >= UNIT_CAP) fail('unit cap reached');
      const grave = s.players[b.owner].graveyard;
      // TODO(open): card choice — POC takes the most recent matching card in the graveyard.
      let idx = -1;
      for (let i = grave.length - 1; i >= 0; i--) {
        const def = s.cardDefs[grave[i]!];
        if (def?.kind === 'unit' && def.type === eff.type) {
          idx = i;
          break;
        }
      }
      if (idx === -1) fail(`no ${eff.type} in graveyard`);
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
      executeFusion(s, u1, u2, u2.pos, { spendMove: false });
      return;
    }
    case 'AuraAtk':
    case 'AuraAtkPerCount':
      return; // standing auras: read by effectiveAtk, never "executed"
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
    level: def.level,
    pos,
    isToken: false,
    isLeader: false,
    summoningSick: true,
    hasActed: false,
    movedThisTurn: false,
    keywords: [...def.keywords],
    statuses: [],
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
      const zone = [trap.pos, ...mooreAdjacent(trap.pos)];
      if (zone.some((c) => sameCoord(c, event.destination))) triggered.push(trap);
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
    };
    for (const line of def.effects) execLine(s, line, binding);
    if (def.interrupt === 'negate') negated = true;
  }
  return !negated;
}

// ---------------------------------------------------------------------------
// Combat (Rules Spec §5)
// ---------------------------------------------------------------------------

function resolveCombat(s: GameState, attacker: Unit, defender: Unit, opts: { advance: boolean }): void {
  const battleTile = defender.pos;
  const aEff = effectiveAtk(s, attacker, { role: 'attacker', battleTile, opponentId: defender.id });

  if (defender.isLeader) {
    // Attritional: chip lands FIRST (even if the attacker dies to the counter), then strikeback. No advance.
    s.players[defender.owner].leaderLife -= aEff;
    log(s, `${attacker.name} hits leader ${defender.name} for ${aEff} (LP ${s.players[defender.owner].leaderLife})`);
    checkWin(s);
    if (s.winner !== undefined) return;
    const dEff = effectiveAtk(s, defender, { role: 'defender', battleTile, opponentId: attacker.id });
    if (dEff >= aEff) {
      log(s, `leader strikeback ${dEff} >= ${aEff}: ${attacker.name} destroyed`);
      destroyUnit(s, attacker.id);
    }
    return;
  }

  if (attacker.isLeader) {
    // Leader attacks a unit: binary for the unit, attritional for the leader.
    const dEff = effectiveAtk(s, defender, { role: 'defender', battleTile, opponentId: attacker.id });
    if (aEff > dEff) {
      destroyUnit(s, defender.id);
      log(s, `leader ${attacker.name} (${aEff}) kills ${defender.name} (${dEff})`);
      if (opts.advance) advanceAfterKill(s, attacker, battleTile);
    } else {
      // Defender survives and strikes back: chip to the attacking leader's pool.
      s.players[attacker.owner].leaderLife -= dEff;
      log(s, `leader ${attacker.name} fails to kill; strikeback ${dEff} to LP (${s.players[attacker.owner].leaderLife})`);
      checkWin(s);
    }
    return;
  }

  const dEff = effectiveAtk(s, defender, { role: 'defender', battleTile, opponentId: attacker.id });
  if (aEff > dEff) {
    log(s, `${attacker.name} (${aEff}) kills ${defender.name} (${dEff})`);
    destroyUnit(s, defender.id);
    if (opts.advance) advanceAfterKill(s, attacker, battleTile);
    fireOnKill(s, attacker, battleTile);
  } else if (aEff < dEff) {
    log(s, `${attacker.name} (${aEff}) dies attacking ${defender.name} (${dEff}) — defender holds`);
    destroyUnit(s, attacker.id);
  } else {
    log(s, `tie at ${aEff}: mutual destruction, no advance`);
    destroyUnit(s, defender.id);
    destroyUnit(s, attacker.id);
  }
}

function advanceAfterKill(s: GameState, attacker: Unit, tile: Coord): void {
  if (!s.units[attacker.id]) return; // died mid-resolution (shouldn't happen, but safe)
  moveUnitOnBoard(s, attacker, tile);
  log(s, `${attacker.name} advances onto (${tile.col},${tile.row})`);
}

function fireOnKill(s: GameState, attacker: Unit, destination: Coord): void {
  if (!s.units[attacker.id]) return;
  // Resolution order (locked): combat -> destroy -> advance -> On-Kill fires with position updated.
  const def = s.cardDefs[attacker.cardId];
  if (def?.kind !== 'unit') return;
  for (const rule of def.rules) {
    if (rule.trigger !== 'OnKill') continue;
    execLine(s, rule, {
      owner: attacker.owner,
      sourcePos: attacker.pos,
      selfUnitId: attacker.id,
      destinationTile: destination,
    });
  }
}

function fireOnMove(s: GameState, mover: Unit, path: Coord[]): void {
  const rules: Rule[] = [];
  const def = s.cardDefs[mover.cardId];
  if (def?.kind === 'unit') rules.push(...def.rules);
  if (mover.isLeader) rules.push(...s.leaders[mover.owner].rules);
  for (const rule of rules) {
    if (rule.trigger !== 'OnMove') continue;
    execLine(s, rule, {
      owner: mover.owner,
      sourcePos: mover.pos,
      selfUnitId: mover.id,
      pathTiles: path,
    });
  }
}

function checkWin(s: GameState): void {
  for (const p of [0, 1] as const) {
    if (s.players[p].leaderLife <= 0) {
      s.winner = p === 0 ? 1 : 0;
      s.phase = 'gameover';
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
function reachableDestinations(s: GameState, u: Unit): Coord[] {
  const range = 1 + u.extraMove;
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
      out.push(n);
      if (isEmpty(s, n)) queue.push({ c: n, d: d + 1 }); // can only pass THROUGH empty tiles
    }
  }
  return out;
}

function isImmobilized(u: Unit): boolean {
  return u.statuses.some((st) => st.kind === 'Immobilized');
}

// ---------------------------------------------------------------------------
// Fusion
// ---------------------------------------------------------------------------

function findFusionResult(s: GameState, owner: PlayerId, cardA: string, cardB: string): string | undefined {
  for (const fid of s.players[owner].fusionPool) {
    const def = s.cardDefs[fid];
    if (def?.kind !== 'unit' || !def.fusion) continue;
    const [m1, m2] = def.fusion.materials;
    if ((m1 === cardA && m2 === cardB) || (m1 === cardB && m2 === cardA)) return fid;
  }
  return undefined;
}

function executeFusion(s: GameState, mover: Unit, stationary: Unit, destination: Coord, opts: { spendMove: boolean }): void {
  const owner = mover.owner;
  const resultId = findFusionResult(s, owner, mover.cardId, stationary.cardId) ?? fail('not a registered fusion pair');
  // Both materials consumed. TODO(open): ruled materials go to the graveyard (spent cards).
  for (const mat of [mover, stationary]) {
    tileAt(s.board, mat.pos).occupant = undefined;
    delete s.units[mat.id];
    if (!mat.isToken) s.players[owner].graveyard.push(mat.cardId);
  }
  s.players[owner].fusionPool = s.players[owner].fusionPool.filter((id) => id !== resultId);
  const fused = spawnUnitFromCard(s, resultId, owner, destination); // summoning-sick (no fuse-and-swing)
  if (opts.spendMove) fused.hasActed = true;
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

function resolveSpell(s: GameState, def: SpellCardDef, owner: PlayerId, resolvePos: Coord, targets: Coord[] | undefined, triggeringUnitId?: string): void {
  const binding: Binding = {
    owner,
    sourcePos: resolvePos,
    chosen: targets,
    triggeringUnitId,
  };
  for (const line of def.effects) execLine(s, line, binding);
  s.players[owner].graveyard.push(def.id);
  log(s, `spell ${def.name} resolves`);
}

/** A face-down located spell is a mine/boon if any of its effects target the triggering unit. */
function isUnitAffecting(def: SpellCardDef): boolean {
  return def.effects.some((l) => l.target.t === 'TriggeringUnit');
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

function tickStatuses(s: GameState, p: PlayerId): void {
  // Timed statuses tick at the start of the AFFECTED unit's controller's turn.
  for (const u of Object.values(s.units)) {
    if (u.owner !== p) continue;
    u.statuses = u.statuses.filter((st) => {
      if (st.duration.kind !== 'turns') return true;
      st.duration.turnsLeft -= 1;
      return st.duration.turnsLeft > 0;
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
    u.movedThisTurn = false; // punish-passives read "this turn" for either side
    if (u.owner === p) {
      u.summoningSick = false;
      u.hasActed = false;
      u.extraMove = 0;
    }
  }
  for (const c of Object.values(s.setCards)) {
    if (c.owner === p) c.hasActed = false;
  }
  tickStatuses(s, p);

  // Resource phase: SP refresh (not accrual), then draw 1.
  ps.sp = spMax(ps.turnCount);
  if (p === 1 && ps.turnCount === 1) ps.sp += 1; // going-second coin: one-time, non-bankable
  drawCards(s, p, 1); // TODO(open): P1's first draw not skipped (sim-1 gap #1, unresolved)

  // Springs relight nominally in the Start phase, but an occupy-at-relight capture
  // grants +3 SP that must survive the Resource refresh — so relight resolves after it.
  relightSprings(s);
  log(s, `— player ${p} turn ${ps.turnCount} (round ${s.round}): ${ps.sp} SP`);
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

function endTurn(s: GameState): void {
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
      doSetCard(s, a.card, a.tile);
      break;
    case 'MoveSet':
      doMoveSet(s, a.set, a.to);
      break;
    case 'FlipCard':
      doFlipCard(s, a.set, a.targets);
      break;
    case 'CastSpell':
      doCastSpell(s, a.card, a.targets);
      break;
    case 'ActivateAbility':
      doActivateAbility(s, a.targets);
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
  if (!inBounds(tile) || !isEmpty(s, tile)) fail('summon tile must be empty');
  if (ps.sp < def.level) fail(`not enough SP (${ps.sp} < ${def.level})`);
  if (realUnitCount(s, s.active) >= UNIT_CAP) fail('unit cap (5 real units) reached');
  ps.sp -= def.level;
  ps.hand.splice(idx, 1);
  const u = spawnUnitFromCard(s, cardId, s.active, tile);
  for (const rule of def.rules) {
    if (rule.trigger !== 'OnSummon') continue;
    // OnSummon with a chosen target is not supported in the Action payload for POC —
    // Grave Tyrant's targeted Destroy picks the first legal enemy. TODO: target choice.
    execLine(s, rule, autoBindChosen(s, rule, { owner: s.active, sourcePos: u.pos, selfUnitId: u.id }));
  }
  checkSpringCapture(s, u); // summoning onto an active spring: entering is entering
}

/** For OnSummon rules with Chosen* targets, auto-pick the first legal candidate (POC shortcut). */
function autoBindChosen(s: GameState, rule: Rule, b: Binding): Binding {
  if (rule.target.t !== 'ChosenEnemy' && rule.target.t !== 'ChosenUnit') return b;
  for (const u of Object.values(s.units)) {
    if (u.isLeader) continue;
    if (rule.target.t === 'ChosenEnemy' && u.owner === b.owner) continue;
    if (!conditionHolds(s, rule.condition, u)) continue;
    return { ...b, chosen: [u.pos] };
  }
  return { ...b, chosen: undefined };
}

function doMove(s: GameState, unitId: string, to: Coord): void {
  const u = s.units[unitId] ?? fail('no such unit');
  if (u.owner !== s.active) fail('not your unit');
  if (u.hasActed) fail('unit already acted this turn');
  if (isImmobilized(u)) fail('unit is immobilized');
  if (!inBounds(to)) fail('destination out of bounds');
  if (!reachableDestinations(s, u).some((c) => sameCoord(c, to))) fail('destination not reachable');

  const occ = tileAt(s.board, to).occupant;
  u.hasActed = true;

  // --- Attack ---
  if (occ?.kind === 'unit') {
    const target = s.units[occ.id]!;
    if (target.owner !== u.owner) {
      if (u.summoningSick) fail('summoning-sick units cannot attack');
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
      resolveCombat(s, u, target, { advance: true });
      return;
    }
    // --- Friendly destination: fuse or illegal ---
    if (findFusionResult(s, u.owner, u.cardId, target.cardId)) {
      if (isImmobilized(target)) fail('stationary material is immobilized'); // conservative
      executeFusion(s, u, target, target.pos, { spendMove: true });
      return;
    }
    fail('cannot move onto a friendly unit (unless a registered fusion pair)');
  }

  // --- Set-card destination ---
  if (occ?.kind === 'set') {
    const set = s.setCards[occ.id]!;
    const def = s.cardDefs[set.cardId]!;
    if (set.owner !== u.owner) {
      if (def.kind === 'trap') {
        // Enemy trap: stepping onto its own tile is a zone entry.
        const ok = fireTraps(s, { kind: 'moveIntoZone', moverId: u.id, destination: to });
        if (!ok) return;
        if (s.units[u.id] && isEmpty(s, to)) completePlainMove(s, u, to);
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
  if (!isEmpty(s, to)) return; // trap effects blocked the tile somehow
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
  resolveSpell(s, def, set.owner, set.pos, undefined, mover.id);
  if (s.units[mover.id] && isEmpty(s, to)) completePlainMove(s, mover, to);
}

function doRangedAttack(s: GameState, unitId: string, target: Coord): void {
  const u = s.units[unitId] ?? fail('no such unit');
  if (u.owner !== s.active) fail('not your unit');
  if (!u.keywords.includes('Ranged')) fail('unit is not Ranged');
  if (u.hasActed) fail('unit already acted this turn');
  if (u.summoningSick) fail('summoning-sick units cannot attack');
  // TODO(open): Ranged reach ruled = orthogonally adjacent without entering; strikeback
  // still applies (vault leaves Ranged-vs-strikeback open).
  if (!orthAdjacent(u.pos).some((c) => sameCoord(c, target))) fail('ranged target must be orthogonally adjacent');
  const defender = unitAt(s, target) ?? fail('no unit at target');
  if (defender.owner === u.owner) fail('cannot attack a friendly unit');
  u.hasActed = true;
  const ok = fireTraps(s, { kind: 'attack', attackerId: u.id, defenderId: defender.id });
  if (!ok) return;
  if (!s.units[u.id] || !s.units[defender.id]) return;
  resolveCombat(s, u, defender, { advance: false }); // no exposure: never advances
}

function doSetCard(s: GameState, cardId: string, tile: Coord): void {
  const ps = s.players[s.active];
  const idx = activeHandCard(s, cardId);
  const def = s.cardDefs[cardId];
  if (def?.kind !== 'spell' && def?.kind !== 'trap') fail('only spells/traps can be set');
  const leader = leaderOf(s, s.active);
  if (!mooreAdjacent(leader.pos).some((c) => sameCoord(c, tile))) fail('set must be in the leader summon zone');
  if (!isEmpty(s, tile)) fail('set tile must be empty');
  if (setCardCount(s, s.active) >= NONUNIT_CAP) fail('non-unit cap (5 set cards) reached');
  ps.hand.splice(idx, 1);
  const sc: SetCard = { id: nextId(s, 'sc'), owner: s.active, cardId, kind: def.kind, pos: tile, hasActed: false };
  s.setCards[sc.id] = sc;
  tileAt(s.board, tile).occupant = { kind: 'set', id: sc.id };
  log(s, `a card is set face-down at (${tile.col},${tile.row})`);
}

function doMoveSet(s: GameState, setId: string, to: Coord): void {
  const sc = s.setCards[setId] ?? fail('no such set card');
  if (sc.owner !== s.active) fail('not your set card');
  if (sc.hasActed) fail('set card already moved this turn');
  if (!orthAdjacent(sc.pos).some((c) => sameCoord(c, to))) fail('set cards move 1 tile orthogonally');
  if (!isEmpty(s, to)) fail('destination occupied');
  // Moving a trap into reach of an enemy does NOT trigger it (locked).
  tileAt(s.board, sc.pos).occupant = undefined;
  tileAt(s.board, to).occupant = { kind: 'set', id: sc.id };
  sc.pos = to;
  sc.hasActed = true;
  log(s, `a face-down card moves to (${to.col},${to.row})`);
}

function doFlipCard(s: GameState, setId: string, targets?: Coord[]): void {
  const sc = s.setCards[setId] ?? fail('no such set card');
  if (sc.owner !== s.active) fail('not your set card');
  const def = s.cardDefs[sc.cardId];
  if (def?.kind !== 'spell') fail('the setter cannot flip their own trap');
  checkLocatedReach(def, sc.pos, targets);
  // Flipping a set spell is a spell activation: opposing traps may chain (before-completion).
  tileAt(s.board, sc.pos).occupant = undefined;
  delete s.setCards[sc.id];
  const ok = fireTraps(s, { kind: 'spellActivation', caster: s.active });
  if (!ok) {
    s.players[s.active].graveyard.push(sc.cardId);
    log(s, `spell ${def.name} is negated`);
    return;
  }
  resolveSpell(s, def, s.active, sc.pos, targets);
}

function doCastSpell(s: GameState, cardId: string, targets?: Coord[]): void {
  const ps = s.players[s.active];
  const idx = activeHandCard(s, cardId);
  const def = s.cardDefs[cardId];
  if (def?.kind !== 'spell') fail('not a spell');
  // Face-up = instant, resolves from your zone (the leader's position anchors located reach).
  const leader = leaderOf(s, s.active);
  checkLocatedReach(def, leader.pos, targets);
  ps.hand.splice(idx, 1);
  const ok = fireTraps(s, { kind: 'spellActivation', caster: s.active });
  if (!ok) {
    ps.graveyard.push(cardId);
    log(s, `spell ${def.name} is negated`);
    return;
  }
  resolveSpell(s, def, s.active, leader.pos, targets);
}

function doActivateAbility(s: GameState, targets?: Coord[]): void {
  const ps = s.players[s.active];
  const ability = s.leaders[s.active].ability;
  if (ps.sp < ability.cost) fail(`not enough SP for ${ability.name}`);
  const leader = leaderOf(s, s.active);
  if (ability.located) {
    const anchor = ability.anchor ?? 'leader';
    for (const c of targets ?? []) {
      if (anchor === 'leader') {
        if (chebyshev(c, leader.pos) > 1) fail(`${ability.name}: target out of the leader's reach`);
      } else {
        const near = Object.values(s.units).some(
          (u) => u.owner === s.active && chebyshev(c, u.pos) <= 1,
        );
        if (!near) fail(`${ability.name}: target must be adjacent to a friendly unit`);
      }
    }
  }
  ps.sp -= ability.cost;
  log(s, `${s.leaders[s.active].name} activates ${ability.name} (-${ability.cost} SP)`);
  const binding: Binding = {
    owner: s.active,
    sourcePos: leader.pos,
    selfUnitId: leader.id,
    chosen: targets,
  };
  for (const line of ability.effects) execLine(s, line, binding);
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
      level: 0,
      pos: starts[p],
      isToken: false,
      isLeader: true,
      summoningSick: false,
      hasActed: false,
      movedThisTurn: false,
      keywords: [],
      statuses: [],
      extraMove: 0,
    };
    placeUnit(s, u);
    drawCards(s, p, STARTING_HAND);
  }
  startTurn(s); // P1's start+resource phases run; state rests in the action phase
  return s;
}

function freshPlayer(cfg: PlayerConfig): import('./types').PlayerState {
  return {
    leaderLife: STARTING_LIFE,
    sp: 0,
    hand: [],
    deck: [...cfg.deck],
    graveyard: [],
    fusionPool: [...cfg.fusionPool],
    turnCount: 0,
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
  u.summoningSick = opts?.sick ?? false;
  return u;
}

// ---------------------------------------------------------------------------
// Legal actions (UI highlighting; not exhaustive for target-bearing actions)
// ---------------------------------------------------------------------------

export function legalActions(s: GameState): Action[] {
  if (s.phase === 'gameover') return [];
  const out: Action[] = [{ t: 'EndTurn' }];
  const ps = s.players[s.active];
  const leader = leaderOf(s, s.active);
  const zone = mooreAdjacent(leader.pos).filter((c) => isEmpty(s, c));

  for (const cardId of new Set(ps.hand)) {
    const def = s.cardDefs[cardId];
    if (!def) continue;
    if (def.kind === 'unit' && ps.sp >= def.level && realUnitCount(s, s.active) < UNIT_CAP) {
      for (const tile of zone) out.push({ t: 'Summon', card: cardId, tile });
    }
    if ((def.kind === 'spell' || def.kind === 'trap') && setCardCount(s, s.active) < NONUNIT_CAP) {
      for (const tile of zone) out.push({ t: 'SetCard', card: cardId, tile });
    }
    if (def.kind === 'spell' && def.scope === 'global') {
      out.push({ t: 'CastSpell', card: cardId });
    }
  }

  for (const u of Object.values(s.units)) {
    if (u.owner !== s.active || u.hasActed || isImmobilized(u)) continue;
    for (const to of reachableDestinations(s, u)) {
      const occ = tileAt(s.board, to).occupant;
      if (occ?.kind === 'unit') {
        const t = s.units[occ.id]!;
        if (t.owner !== u.owner && !u.summoningSick) out.push({ t: 'Move', unit: u.id, to });
        else if (t.owner === u.owner && findFusionResult(s, u.owner, u.cardId, t.cardId)) out.push({ t: 'Move', unit: u.id, to });
      } else if (occ?.kind === 'set') {
        const sc = s.setCards[occ.id]!;
        const def = s.cardDefs[sc.cardId]!;
        if (sc.owner !== u.owner) out.push({ t: 'Move', unit: u.id, to });
        else if (def.kind === 'spell' && isUnitAffecting(def)) out.push({ t: 'Move', unit: u.id, to });
      } else {
        out.push({ t: 'Move', unit: u.id, to });
      }
    }
    if (u.keywords.includes('Ranged') && !u.summoningSick) {
      for (const c of orthAdjacent(u.pos)) {
        const t = unitAt(s, c);
        if (t && t.owner !== u.owner) out.push({ t: 'RangedAttack', unit: u.id, target: c });
      }
    }
  }

  for (const sc of Object.values(s.setCards)) {
    if (sc.owner !== s.active || sc.hasActed) continue;
    for (const to of orthAdjacent(sc.pos)) {
      if (isEmpty(s, to)) out.push({ t: 'MoveSet', set: sc.id, to });
    }
    const def = s.cardDefs[sc.cardId];
    if (def?.kind === 'spell') out.push({ t: 'FlipCard', set: sc.id });
  }

  if (ps.sp >= s.leaders[s.active].ability.cost) out.push({ t: 'ActivateAbility' });
  return out;
}
