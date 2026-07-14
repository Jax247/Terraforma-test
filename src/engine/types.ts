// Terraforma POC engine types.
// Pure data — no React, no DOM. See Rules Spec (Language-Agnostic).md.

export type TypeName =
  | 'Beast' | 'Insect' | 'Dragon' | 'Avian' | 'Aqua' | 'Warrior' | 'Spellcaster'
  | 'Fiend' | 'Undead' | 'Machine' | 'Inferno' | 'Verdant' | 'Terra';

export type Terrain =
  | 'Normal' | 'Forest' | 'Mountain' | 'Sea' | 'Grassland' | 'Desert' | 'Shadow' | 'Sanctuary';

export type PlayerId = 0 | 1;

/** 1-indexed, (1,1)..(7,7). Row 1 is P1's back line. */
export interface Coord { col: number; row: number }

export type Keyword = 'Frenzy' | 'Rooted' | 'Ranged';

export type Duration =
  | { kind: 'turns'; turnsLeft: number }   // ticks at start of the affected unit's controller's turn
  | { kind: 'endOfTurn' }                  // expires at the end of the current (any player's) turn
  | { kind: 'permanent' };

export interface TimedStatus {
  id: string;
  kind: 'Immobilized' | 'AtkMod';
  amount: number; // 0 for Immobilized
  duration: Duration;
}

// ---------------------------------------------------------------------------
// Card vocabulary: TRIGGER -> EFFECT -> TARGET (+ CONDITION), per the vault.
// Only the primitives the sim content needs are implemented.
// ---------------------------------------------------------------------------

export type Trigger =
  | 'OnSummon' | 'OnDeath' | 'OnKill' | 'OnMove' | 'OnCapture' | 'Passive' | 'StartOfTurn';

export type CountSpec =
  // TODO(open): terrain has no owner + global counts explode (sim-1 gap #6);
  // working ruling: count matching terrain in the unit's surrounding 8.
  | { c: 'TerrainTilesAround'; terrain: Terrain }
  | { c: 'TypeInOwnGraveyard'; type: TypeName };

export type Effect =
  | { e: 'PaintTerrain'; terrain: Terrain }
  | { e: 'AuraAtk'; amount: number }                            // Passive-only flat aura
  | { e: 'AuraAtkPerCount'; amount: number; count: CountSpec }  // Passive-only scaling aura
  | { e: 'Damage'; amount: number }   // TODO(open): vs units ruled "destroy if amount >= effective ATK"; vs leader hits LP
  | { e: 'Destroy' }
  | { e: 'SummonToken'; tokenId: string; count: number }
  | { e: 'Push'; tiles: number }      // away from the effect's origin; blocked movement stops at last empty tile
  | { e: 'Pull'; tiles: number }      // toward the effect's origin
  | { e: 'ApplyStatus'; status: 'Immobilized' | 'AtkMod'; amount: number; duration: Duration }
  | { e: 'Transform'; atk: number; addKeywords?: Keyword[] }    // Ascension; TODO(open): permanent per POC ruling
  | { e: 'RaiseFromGraveyard'; type: TypeName }                 // graveyard -> summon-zone tile, sick
  | { e: 'Draw'; n: number }
  | { e: 'GainSP'; n: number }                                  // overflow-capable, expires at end of turn
  | { e: 'GrantMove'; tiles: number }                           // this turn
  | { e: 'FuseAdjacentFriendly' };                              // Assemble: fuse two adjacent friendly materials

export type TargetSpec =
  | { t: 'Self' }
  | { t: 'ThisTile' }
  | { t: 'DestinationTile' }        // OnKill: the tile advanced onto
  | { t: 'TilesMovedThrough' }      // OnMove; TODO(open): for a 1-tile move = destination (sim-1 ruling)
  | { t: 'TriggeringUnit' }         // mines / zone traps
  | { t: 'Attacker' }               // traps keying "enemy attacks a friendly"
  | { t: 'ChosenUnit' }             // bound via Action.targets[0]
  | { t: 'ChosenEnemy' }
  | { t: 'AdjacentEnemies' }        // all orthogonally adjacent enemies (e.g. Pyre Warden)
  | { t: 'AdjacentEmptyTiles' }     // token placement; TODO(open): overflow = place as many as fit
  | { t: 'EmptyTileNear' }          // token placement adjacent to source, first fit
  | { t: 'FriendlyOfTypes'; types: TypeName[] }
  | { t: 'FriendlyOfTypesOnTerrain'; types: TypeName[]; terrain: Terrain } // leader passives (own-tile predicate)
  | { t: 'Line3' }                  // 3 chosen tiles (validated contiguous straight line)
  | { t: 'Area2x2' }                // chosen tile = top-left corner
  | { t: 'Area3x3' };               // chosen tile = center

export type Condition =
  // TODO(open): conditions read EFFECTIVE ATK per the derived-stats architecture (sim-1 gap #8).
  | { k: 'EffAtkAtMost'; amount: number }
  | { k: 'DefenderUnmovedThisTurn' };  // combat-context (Kaelen punish passive)

export interface Rule {
  trigger: Trigger;
  effect: Effect;
  target: TargetSpec;
  condition?: Condition;
}

// ---------------------------------------------------------------------------
// Card definitions (content is data, not code)
// ---------------------------------------------------------------------------

export interface UnitCardDef {
  kind: 'unit';
  id: string;
  name: string;
  type: TypeName;
  level: number; // SP cost
  atk: number;
  keywords: Keyword[];
  rules: Rule[];
  /** Present only on fusion-pool cards: the two material card ids. */
  fusion?: { materials: [string, string] };
}

export interface SpellEffectLine { effect: Effect; target: TargetSpec; condition?: Condition }

export interface SpellCardDef {
  kind: 'spell';
  id: string;
  name: string;
  /** global = names a category, resolves from your zone; located = must be at/adjacent to its target. */
  scope: 'global' | 'located';
  effects: SpellEffectLine[];
  ascension?: boolean;
}

export type TrapTriggerSpec =
  | { t: 'zone' }                    // enemy unit enters the trap's tile or its surrounding 8
  | { t: 'enemyAttacksFriendly' }
  | { t: 'enemyActivatesSpell' };

export interface TrapCardDef {
  kind: 'trap';
  id: string;
  name: string;
  /** negate = cancel the paused triggering action; respond = it completes after the trap. */
  interrupt: 'negate' | 'respond';
  trigger: TrapTriggerSpec;
  effects: SpellEffectLine[];
}

export type CardDef = UnitCardDef | SpellCardDef | TrapCardDef;

export interface TokenDef {
  id: string;
  name: string;
  type: TypeName;
  atk: number;
  keywords: Keyword[];
}

export interface AbilityDef {
  id: string;
  name: string;
  cost: number;
  /** Located abilities need their anchor within the leader's reach; global fire from anywhere. */
  located: boolean;
  effects: SpellEffectLine[];
  /** Located anchor override: 'friendlyUnit' anchors reach to any friendly unit (Overgrowth per sim 5). */
  anchor?: 'leader' | 'friendlyUnit';
}

export interface LeaderDef {
  id: string;
  name: string;
  type: TypeName;
  atk: number;
  /** Passive auras plus leader triggers (Briar OnMove paint, Oskar OnCapture draw). */
  rules: Rule[];
  ability: AbilityDef;
}

// ---------------------------------------------------------------------------
// Board & game state
// ---------------------------------------------------------------------------

export type Occupant = { kind: 'unit'; id: string } | { kind: 'set'; id: string };

export interface Tile {
  terrain: Terrain;
  spring: boolean;
  springActive: boolean;
  /** Round at which a captured spring relights. TODO(open): vault says "synchronized"; sim-1 ruled per-spring 3 turns after its own capture. */
  springRelightRound?: number;
  occupant?: Occupant;
}

/** board[col-1][row-1] */
export type Board = Tile[][];

export interface Unit {
  id: string;
  owner: PlayerId;
  cardId: string;    // card def id, or token def id for tokens
  name: string;
  type: TypeName;
  baseAtk: number;
  level: number;
  pos: Coord;
  isToken: boolean;
  isLeader: boolean;
  summoningSick: boolean;
  hasActed: boolean;      // has moved / attacked / fused this turn
  movedThisTurn: boolean; // reset at the start of every player turn (for punish-passives)
  keywords: Keyword[];
  statuses: TimedStatus[];
  extraMove: number;      // granted movement, this turn
}

export interface SetCard {
  id: string;
  owner: PlayerId;
  cardId: string;
  kind: 'spell' | 'trap';
  pos: Coord;
  hasActed: boolean;
}

export interface PlayerState {
  leaderLife: number;
  sp: number;
  hand: string[];       // card def ids (duplicates allowed)
  deck: string[];
  graveyard: string[];
  fusionPool: string[]; // fusion-pool card def ids
  turnCount: number;    // own turns taken so far
}

export type Phase = 'action' | 'gameover';

export interface GameState {
  board: Board;
  units: Record<string, Unit>;
  setCards: Record<string, SetCard>;
  players: [PlayerState, PlayerState];
  active: PlayerId;
  /** 1-based round; increments when P1 (player 0) starts a turn after the first. */
  round: number;
  phase: Phase;
  voidPile: string[];
  winner?: PlayerId;
  nextId: number;
  log: string[];
  // Content registry lives in state so tests can inject sim-only decks.
  cardDefs: Record<string, CardDef>;
  tokenDefs: Record<string, TokenDef>;
  leaders: [LeaderDef, LeaderDef];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { t: 'Summon'; card: string; tile: Coord }
  | { t: 'Move'; unit: string; to: Coord }        // resolves to move | attack | fuse | mine-contact
  | { t: 'RangedAttack'; unit: string; target: Coord }
  | { t: 'SetCard'; card: string; tile: Coord }
  | { t: 'MoveSet'; set: string; to: Coord }
  | { t: 'FlipCard'; set: string; targets?: Coord[] }
  | { t: 'CastSpell'; card: string; targets?: Coord[] }
  | { t: 'ActivateAbility'; targets?: Coord[] }
  | { t: 'EndTurn' };

export interface CombatCtx {
  role: 'attacker' | 'defender';
  battleTile: Coord;   // the defended tile — terrain resolves here for BOTH combatants
  opponentId: string;
}
