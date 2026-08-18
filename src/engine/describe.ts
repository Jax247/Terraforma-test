// Human-readable card text generated from the structured effect data.
// Pure functions — no React, no DOM. The UI renders these lines verbatim, so
// the text always matches what the engine actually does.

import type {
  AbilityDef,
  CardDef,
  Condition,
  CountSpec,
  Duration,
  Effect,
  Keyword,
  LeaderDef,
  Rule,
  SigilSpec,
  SpellCardDef,
  SpellEffectLine,
  TargetSpec,
  TokenDef,
  TrapCardDef,
  TriggerScope,
  TriggerWhen,
  TrapTriggerSpec,
  Trigger,
  UnitCardDef,
} from './types';

export interface NameResolver {
  cardName(id: string): string;
  tokenName(id: string): string;
}

export function defaultResolver(
  cards: Record<string, CardDef>,
  tokens: Record<string, TokenDef>,
): NameResolver {
  return {
    cardName: (id) => cards[id]?.name ?? id,
    tokenName: (id) => tokens[id]?.name ?? id,
  };
}

function assertNever(x: never): never {
  throw new Error(`describe: unhandled variant ${JSON.stringify(x)}`);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A face-down located spell that only targets its triggering unit is a mine: set it, don't cast it. */
export function isMineOnly(def: CardDef): boolean {
  return def.kind === 'spell' && def.effects.every((l) => l.target.t === 'TriggeringUnit');
}

export function describeTrigger(t: Trigger): string {
  switch (t) {
    case 'OnSummon': return 'On Summon';
    case 'OnDeath': return 'On Death';
    case 'OnKill': return 'On Kill';
    case 'OnMove': return 'On Move';
    case 'OnCapture': return 'On Capture';
    case 'Passive': return 'Passive';
    case 'StartOfTurn': return 'Start of Turn';
    case 'EndOfTurn': return 'End of Turn';
    case 'OnFlip': return 'On Flip';
    case 'OnAllyDeath': return 'On Any Death';
    case 'OnSpellCast': return 'On Spell Cast';
    case 'OnAbilityCast': return 'On Leader Ability';
    case 'OnTrapTriggered': return 'On Trap Sprung';
    case 'OnSummonAlly': return 'On Ally Summoned';
    case 'OnEnemySummon': return 'On Enemy Summoned';
    case 'OnAttack': return 'On Attack';
    case 'OnDefend': return 'On Defend';
    case 'OnTerrainPainted': return 'On Terrain Painted';
    default: return assertNever(t);
  }
}

/** The triggers that read `when.scope`. Kept in step with `scopeMatches` call sites in engine.ts. */
export const SCOPED_TRIGGERS = new Set<Trigger>([
  'OnCapture', 'OnAllyDeath', 'OnTrapTriggered', 'OnTerrainPainted',
]);

function scopeWord(scope: TriggerScope): string {
  switch (scope) {
    case 'self': return 'this unit';
    case 'friendly': return 'friendly';
    case 'enemy': return 'enemy';
    case 'any': return 'either side';
  }
}

/**
 * Qualifier appended to a trigger's name, e.g. "On Any Death (enemy)" or
 * "On Terrain Painted (friendly, Forest)". Only renders the parts the trigger actually reads.
 */
export function describeWhen(trigger: Trigger, when: TriggerWhen | undefined): string {
  if (!when) return '';
  const parts: string[] = [];
  if (when.scope && SCOPED_TRIGGERS.has(trigger)) parts.push(scopeWord(when.scope));
  if (when.terrain && trigger === 'OnTerrainPainted') parts.push(when.terrain);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/** Noun phrase for a target, used inside effect sentences. */
export function describeTarget(t: TargetSpec): string {
  switch (t.t) {
    case 'Self': return 'this unit';
    case 'ThisTile': return 'this tile';
    case 'DestinationTile': return 'the tile advanced onto';
    case 'TilesMovedThrough': return 'each tile moved through';
    case 'TriggeringUnit': return 'the triggering unit';
    case 'TriggeringTile': return 'the painted tile';
    case 'UnitOnTriggeringTile': return 'the unit on the painted tile';
    case 'Attacker': return 'the attacking unit';
    case 'ChosenUnit': return 'a chosen unit';
    case 'ChosenEnemy': return 'a chosen enemy';
    case 'ChosenFriendly': return 'a chosen friendly unit';
    case 'AdjacentEnemies': return 'all orthogonally adjacent enemies';
    case 'AdjacentEmptyTiles': return 'adjacent empty tiles';
    case 'EmptyTileNear': return 'an empty tile nearby';
    case 'FriendlyOfTypes': return `friendly ${t.types.join('/')} units`;
    case 'FriendlyOfTypesOnTerrain': return `friendly ${t.types.join('/')} units on ${t.terrain}`;
    case 'AdjacentFriendlies': return 'all orthogonally adjacent friendly units';
    case 'AllEnemies': return 'all enemy units';
    case 'EnemiesOfTypes': return `enemy ${t.types.join('/')} units`;
    case 'AllUnitsOnTerrain': return `all units on ${t.terrain}`;
    case 'TilesAroundLeader': return 'the tiles around your leader';
    case 'Line3': return '3 tiles in a straight line';
    case 'Area2x2': return 'a 2×2 area';
    case 'Area3x3': return 'a 3×3 area';
    default: return assertNever(t);
  }
}

/** Whether the target noun phrase is grammatically plural ("get" vs "gets"). */
function targetIsPlural(t: TargetSpec): boolean {
  switch (t.t) {
    case 'TilesMovedThrough':
    case 'AdjacentEnemies':
    case 'AdjacentEmptyTiles':
    case 'FriendlyOfTypes':
    case 'FriendlyOfTypesOnTerrain':
    case 'AdjacentFriendlies':
    case 'AllEnemies':
    case 'EnemiesOfTypes':
    case 'AllUnitsOnTerrain':
    case 'TilesAroundLeader':
      return true;
    default:
      return false;
  }
}

function describeCount(c: CountSpec): string {
  switch (c.c) {
    case 'TerrainTilesAround': return `each ${c.terrain} tile in its surrounding 8`;
    case 'TypeInOwnGraveyard': return `each ${c.type} in your graveyard`;
    default: return assertNever(c);
  }
}

function describeDuration(d: Duration): string {
  switch (d.kind) {
    case 'turns': return ` for ${plural(d.turnsLeft, 'turn')}`;
    case 'endOfTurn': return ' until end of turn';
    case 'permanent': return '';
    default: return assertNever(d);
  }
}

/** Lowercase verb phrase, target embedded. Lines capitalize as needed. */
export function describeEffect(e: Effect, target: TargetSpec, names: NameResolver): string {
  const tp = describeTarget(target);
  const gets = targetIsPlural(target) ? 'get' : 'gets';
  switch (e.e) {
    case 'PaintTerrain': return `paint ${tp} ${e.terrain}`;
    case 'AuraAtk': return `${tp} ${gets} ${signed(e.amount)} ATK`;
    case 'AuraAtkPerCount': return `${tp} ${gets} ${signed(e.amount)} ATK for ${describeCount(e.count)}`;
    case 'AuraDef': return `${tp} ${gets} ${signed(e.amount)} DEF`;
    case 'Damage': return `deal ${e.amount} damage to ${tp}`;
    case 'Destroy': return `destroy ${tp}`;
    case 'SummonToken': return `summon ${plural(e.count, names.tokenName(e.tokenId))} to ${tp}`;
    case 'Push': return `push ${tp} ${plural(e.tiles, 'tile')} away`;
    case 'Pull': return `pull ${tp} ${plural(e.tiles, 'tile')} closer`;
    case 'ApplyStatus': {
      const denial: Partial<Record<typeof e.status, string>> = {
        Stunned: 'stun',
        Snared: 'snare',
        Disarmed: 'disarm',
        Suppressed: 'suppress',
        Marked: 'mark',
      };
      const verb = denial[e.status];
      if (verb) return `${verb} ${tp}${describeDuration(e.duration)}`;
      return `${tp} ${gets} ${signed(e.amount)} ${e.status === 'DefMod' ? 'DEF' : 'ATK'}${describeDuration(e.duration)}`;
    }
    case 'Transform': {
      const kw = e.addKeywords?.length ? `; gains ${e.addKeywords.join(', ')}` : '';
      return `transform ${tp}: ATK becomes ${e.atk}${kw}`;
    }
    case 'RaiseFromGraveyard':
      return target.t === 'ChosenUnit'
        ? `raise a chosen ${e.type} from your graveyard`
        : `raise a ${e.type} from your graveyard to ${tp}`;
    case 'GrantWallPass': return `let ${tp} enter and pass through Wall tiles${describeDuration(e.duration)}`;
    case 'GrantKeyword': return `${tp} ${gets} ${e.keyword}${describeDuration(e.duration)}`;
    case 'AddCounter': {
      const n = Math.abs(e.amount);
      const track = e.track.toUpperCase();
      return e.amount >= 0
        ? `put ${plural(n, `${track} counter`)} on ${tp}`
        : `remove ${plural(n, `${track} counter`)} from ${tp}`;
    }
    case 'Search': {
      const f = e.filter;
      const bits = [
        f.type ? `${f.type}` : '',
        f.keyword ? `${f.keyword}` : '',
        f.maxLevel !== undefined ? `level ${f.maxLevel} or lower` : '',
        f.kind ?? '',
      ].filter(Boolean).join(' ');
      const what = bits || 'card';
      return e.mode === 'random'
        ? `search your deck for a random ${what}, add it to your hand, then shuffle`
        : `search your deck for a ${what}, add it to your hand, then shuffle`;
    }
    case 'Draw': return `draw ${plural(e.n, 'card')}`;
    case 'GainSP': return `gain ${e.n} SP (expires at end of turn)`;
    case 'GrantMove': return `grant ${tp} ${plural(e.tiles, 'extra tile')} of movement this turn`;
    case 'FuseAdjacentFriendly': return 'fuse two adjacent friendly material units';
    default: return assertNever(e);
  }
}

export function describeCondition(c: Condition): string {
  switch (c.k) {
    case 'EffAtkAtMost': return `, if its effective ATK is ${c.amount} or less`;
    case 'DefenderUnmovedThisTurn': return ', if the defender did not move on its own last turn';
    case 'NoAdjacentEnemy': return ', while no enemy is adjacent to it';
    case 'DefenderIsMarked': return ', if the defender is Marked';
    case 'EffAtkAtLeast': return `, if its effective ATK is ${c.amount} or more`;
    case 'NearLeader':
      return c.tiles === 1
        ? ', while adjacent to your leader'
        : `, while within ${c.tiles} tiles of your leader`;
    case 'OnFavoredTerrain': return ', while on its favored terrain';
    case 'InEnemyHalf': return ", while in the opponent's half";
    case 'HoldsSpring': return ', while you hold a spring';
    case 'LeaderOnSpring': return ', while your leader stands on a spring';
    case 'LeaderBelowHalfPool': return ', while your LP is below half';
    case 'GraveyardCountAtLeast':
      return `, if your graveyard holds ${c.count} or more ${c.type}`;
    case 'IsType': return `, if it is ${c.types.join('/')}`;
    case 'LevelAtLeast': return `, if it is level ${c.amount} or higher`;
    case 'HasKeyword': return `, if it has ${c.keyword}`;
    case 'InDefenseStance': return ', while in defense stance';
    case 'IsToken': return ', if it is a token';
    default: return assertNever(c);
  }
}

export function describeRule(r: Rule, names: NameResolver): string {
  const cond = r.condition ? describeCondition(r.condition) : '';
  // Qualifiers only mean something on the triggers that read them; printing one elsewhere would
  // claim a distinction the engine does not make.
  const when = describeWhen(r.trigger, r.when);
  return `${describeTrigger(r.trigger)}${when}: ${describeEffect(r.effect, r.target, names)}${cond}.`;
}

export function describeEffectLine(l: SpellEffectLine, names: NameResolver): string {
  const cond = l.condition ? describeCondition(l.condition) : '';
  return `${cap(describeEffect(l.effect, l.target, names))}${cond}.`;
}

/** One-line gloss for marked ground, shared by the game board and the map editor. */
export function describeSigil(spec: SigilSpec): string {
  const turns = `${spec.turns} turn${spec.turns === 1 ? '' : 's'}`;
  if (spec.turns <= 0) return 'inert';
  const denial: Partial<Record<SigilSpec['status'], string>> = {
    Stunned: 'stuns', Snared: 'snares', Disarmed: 'disarms', Suppressed: 'suppresses', Marked: 'marks',
  };
  const verb = denial[spec.status];
  if (verb) return `${verb} for ${turns}`;
  const stat = spec.status === 'DefMod' ? 'DEF' : 'ATK';
  return `${signed(spec.amount)} ${stat} for ${turns}`;
}

/** Reach text for a Ranged card. Spells out the dead zone, which is the counter-intuitive half. */
export function describeRange(range = 1): string {
  if (range <= 1) return 'Range 1 — attacks an orthogonally adjacent enemy without moving in.';
  return `Range ${range} — attacks exactly ${range} tiles away in a straight orthogonal line, `
    + `never nearer. A Wall blocks the shot, and anything that closes inside the range shuts it off.`;
}

export function keywordGloss(k: Keyword): string {
  switch (k) {
    case 'Frenzy': return '+5 ATK per orthogonally adjacent ally (max +20)';
    case 'Anchored': return 'cannot be pushed or pulled';
    case 'Ranged': return 'attacks at its exact range without moving; cannot hit anything nearer, and a Wall blocks the line';
    case 'Guard': return 'enemies beside it cannot walk away — they may only move to another tile beside it, or attack';
    case 'Piercing': return 'breaks a braced defender and tramples the excess into its owner’s LP';
    case 'Wallwalk': return 'may enter and pass through Wall tiles';
    default: return assertNever(k);
  }
}

function keywordLines(keywords: Keyword[]): string[] {
  return keywords.map((k) => `${k} — ${keywordGloss(k)}.`);
}

function describeTrapTrigger(t: TrapTriggerSpec): string {
  switch (t.t) {
    case 'zone': return "Triggers when an enemy unit enters this card's tile or its surrounding 8.";
    case 'enemyAttacksFriendly': return 'Triggers when an enemy attacks a friendly unit.';
    case 'enemyActivatesSpell': return 'Triggers when an enemy activates a spell.';
    default: return assertNever(t);
  }
}

function describeUnit(def: UnitCardDef, names: NameResolver): string[] {
  const lines = [
    ...(def.sp !== undefined && def.sp !== def.level ? [`Costs ${def.sp} SP to summon.`] : []),
    ...keywordLines(def.keywords),
    ...def.rules.map((r) => describeRule(r, names)),
  ];
  if (def.fusion) {
    lines.push(`Fusion: ${def.fusion.materials.map((id) => names.cardName(id)).join(' + ')}.`);
  }
  return lines.length ? lines : ['No abilities.'];
}

function describeSpell(def: SpellCardDef, names: NameResolver): string[] {
  // A mine is billed when it is SET, not when it goes off — say which, since the player pays at
  // a different moment from every other spell.
  const when = isMineOnly(def) ? 'to set' : 'to activate';
  const cost = def.sp ? ` Costs ${def.sp} SP ${when}.` : '';
  const meta = `${cap(def.scope)}${def.ascension ? ' Ascension' : ''} spell.${cost}`;
  const mine = isMineOnly(def) ? ['Set face-down as a mine; triggers on enemy contact.'] : [];
  return [meta, ...mine, ...def.effects.map((l) => describeEffectLine(l, names))];
}

function describeTrap(def: TrapCardDef, names: NameResolver): string[] {
  const cost = def.sp ? ` Costs ${def.sp} SP to set.` : '';
  const interrupt =
    def.interrupt === 'negate'
      ? `Trap — negates the triggering action.${cost}`
      : `Trap — responds (the triggering action still completes).${cost}`;
  return [interrupt, describeTrapTrigger(def.trigger), ...def.effects.map((l) => describeEffectLine(l, names))];
}

export function describeCard(def: CardDef, names: NameResolver): string[] {
  switch (def.kind) {
    case 'unit': return describeUnit(def, names);
    case 'spell': return describeSpell(def, names);
    case 'trap': return describeTrap(def, names);
    default: return assertNever(def);
  }
}

export function describeAbility(a: AbilityDef, names: NameResolver): string[] {
  const reach = a.located ? " (within the leader's reach)" : '';
  const meta = `Ability: ${a.name} — ${a.cost} SP, ${a.located ? 'located' : 'global'}${reach}.`;
  return [meta, ...a.effects.map((l) => describeEffectLine(l, names))];
}

export function describeLeader(def: LeaderDef, names: NameResolver): string[] {
  return [...def.rules.map((r) => describeRule(r, names)), ...describeAbility(def.ability, names)];
}

export function describeToken(def: TokenDef): string[] {
  const lines = keywordLines(def.keywords);
  return lines.length ? lines : ['No abilities.'];
}
