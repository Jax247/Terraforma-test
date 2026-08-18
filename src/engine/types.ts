// Terraforma POC engine types.
// Pure data — no React, no DOM. See Rules Spec (Language-Agnostic).md.

export type TypeName =
  | 'Beast' | 'Insect' | 'Dragon' | 'Avian' | 'Aqua' | 'Warrior' | 'Spellcaster'
  | 'Fiend' | 'Undead' | 'Machine' | 'Inferno' | 'Verdant' | 'Terra';

export type Terrain =
  | 'Normal' | 'Forest' | 'Mountain' | 'Sea' | 'Grassland' | 'Desert' | 'Shadow' | 'Sanctuary'
  /**
   * Impassable terrain. No unit may enter, pass through, or be deployed onto a Wall, and no
   * face-down card may be placed on one, unless the unit can pass walls (the `Wallwalk`
   * keyword or a `GrantWallPass` status). Conventional terrain painting cannot overwrite a
   * Wall either — see `RULES.wallsPaintable` for the experiment toggle. Carries no terrain
   * ATK/DEF modifier for any type.
   */
  | 'Wall';

export type PlayerId = 0 | 1;

/** 1-indexed, (1,1)..(7,7). Row 1 is P1's back line. */
export interface Coord { col: number; row: number }

export type Keyword = 'Frenzy' | 'Anchored' | 'Ranged' | 'Guard' | 'Piercing' | 'Wallwalk';

/** The statuses a card (or a sigil) may apply. `WallPass` is excluded — it has its own effect. */
export type StatusEffectKind =
  | 'Stunned' | 'Snared' | 'Disarmed' | 'Suppressed' | 'Marked' | 'AtkMod' | 'DefMod';

export type Duration =
  | { kind: 'turns'; turnsLeft: number }   // ticks at start of the affected unit's controller's turn
  | { kind: 'endOfTurn' }                  // expires at the end of the current (any player's) turn
  | { kind: 'permanent' };

export interface TimedStatus {
  id: string;
  /** DefMod is the DEF-side twin of AtkMod, read by effectiveDef. `Granted` carries a keyword. */
  kind: 'Stunned' | 'Snared' | 'Disarmed' | 'Suppressed' | 'Marked' | 'AtkMod' | 'DefMod' | 'WallPass' | 'Granted';
  amount: number; // 0 for Stunned / WallPass / Granted
  duration: Duration;
  /** Set only on `Granted`: which keyword this status confers. Read by `hasKeyword`. */
  keyword?: Keyword;
}

// ---------------------------------------------------------------------------
// Card vocabulary: TRIGGER -> EFFECT -> TARGET (+ CONDITION), per the vault.
// Only the primitives the sim content needs are implemented.
// ---------------------------------------------------------------------------

/**
 * When a rule fires.
 *
 * EVERY member of this union must have a live dispatch site. A trigger with no call site is
 * content that parses, type-checks and silently never runs — the exact defect class found across
 * the leader rules on 2026-08-04. `validateCardRules` / `validateLeader` assert this at load.
 */
export type Trigger =
  | 'OnSummon' | 'OnDeath' | 'OnKill' | 'OnMove' | 'OnCapture' | 'Passive' | 'StartOfTurn'
  // --- 2026-08-04 vocabulary expansion (see the card-vocabulary design report) ---------------
  /** End-of-turn tick, the twin of StartOfTurn. Fires for the active player before the handover. */
  | 'EndOfTurn'
  /** This face-down card was turned face-up (flip-summon, or an opponent's attack revealing it). */
  | 'OnFlip'
  /** ANY unit died — Duelyst's Deathwatch. Scoped by `Rule.scope`; the dying unit's OWN rules
   *  still fire under `OnDeath`, so a unit never Deathwatches its own death. */
  | 'OnAllyDeath'
  /** Their controller activated a spell (MTG prowess). */
  | 'OnSpellCast'
  /** Their controller activated the leader's ability. */
  | 'OnAbilityCast'
  /** A trap sprang. Scoped by `Rule.scope` (whose trap). */
  | 'OnTrapTriggered'
  /** Their controller summoned a unit from hand. The new unit binds as `TriggeringUnit`. */
  | 'OnSummonAlly'
  /** The OPPONENT summoned a unit from hand — the one reactive trigger. The new unit binds as
   *  `TriggeringUnit`, so a condition can inspect it and the rule fire only if it qualifies.
   *  RESPONDS, never negates: the summon has fully resolved by the time this runs. Negation
   *  remains the trap layer's exclusive job (`TrapCardDef.interrupt`). */
  | 'OnEnemySummon'
  /** This unit is initiating an attack / is the one being attacked. Both fire BEFORE the exchange
   *  resolves, so a card can matter in a fight it goes on to lose. */
  | 'OnAttack' | 'OnDefend'
  /**
   * "Terrainfall" — a tile's terrain CHANGED. The payoff axis for the game's signature mechanic:
   * until 2026-08-05 `PaintTerrain` was an effect and never a trigger, so nothing could say
   * "when a tile becomes Forest, do X".
   *
   * Fires once per listener per paint event (not once per changed tile), binding the first
   * changed tile as `TriggeringTile`. Filtered by `when.terrain` and `when.scope`. A paint that
   * sets a tile to the terrain it already was does NOT fire — see the dispatch in engine.ts.
   */
  | 'OnTerrainPainted';

/**
 * Whose event a scoped trigger listens to, relative to the rule's own controller.
 * `self` means the rule's own unit is the one the event happened to.
 */
export type TriggerScope = 'self' | 'friendly' | 'enemy' | 'any';

export type CountSpec =
  // TODO(open): terrain has no owner + global counts explode (sim-1 gap #6);
  // working ruling: count matching terrain in the unit's surrounding 8.
  | { c: 'TerrainTilesAround'; terrain: Terrain }
  | { c: 'TypeInOwnGraveyard'; type: TypeName };

export type Effect =
  | { e: 'PaintTerrain'; terrain: Terrain }
  /** Lets the target units enter and pass through Wall tiles for the duration. */
  | { e: 'GrantWallPass'; duration: Duration }
  | { e: 'AuraAtk'; amount: number }                            // Passive-only flat aura
  | { e: 'AuraAtkPerCount'; amount: number; count: CountSpec }  // Passive-only scaling aura
  /** Passive-only flat DEF aura — the twin of AuraAtk, read by effectiveDef. */
  | { e: 'AuraDef'; amount: number }
  | { e: 'Damage'; amount: number }   // TODO(open): vs units ruled "destroy if amount >= effective ATK"; vs leader hits LP
  | { e: 'Destroy' }
  | { e: 'SummonToken'; tokenId: string; count: number }
  | { e: 'Push'; tiles: number }      // away from the effect's origin; blocked movement stops at last empty tile
  | { e: 'Pull'; tiles: number }      // toward the effect's origin
  | { e: 'ApplyStatus'; status: StatusEffectKind; amount: number; duration: Duration }
  | { e: 'Transform'; atk: number; addKeywords?: Keyword[] }    // Ascension; TODO(open): permanent per POC ruling
  | { e: 'RaiseFromGraveyard'; type: TypeName }                 // graveyard -> summon-zone tile, sick
  | { e: 'Draw'; n: number }
  /**
   * Fetch a card out of your own deck, then reshuffle. The consistency lever YGO archetypes are
   * built on — with `Draw` being purely random, an archetype currently has no way to assemble a
   * plan.
   *
   * `mode: 'random'` is a **dig**: it takes a uniformly random match, so it smooths draws without
   * assembling combos. `mode: 'choose'` is a true **tutor** — the deliberate, individually-designed
   * card. It was rejected at load until the 2026-08-08 card-choice pass gave an Action a way to
   * name a card (`Action.chosenCards`); both modes still share `searchMatches` for the filter, and
   * differ only in which match is taken. A 'choose' with no card named degrades to the dig, so a
   * trigger-fired tutor with no player behind it still does something.
   */
  | { e: 'Search'; filter: SearchFilter; mode: 'random' | 'choose' }
  /**
   * Permanent stat growth, on two independent tracks so a card can grow a piercer's offence or a
   * wall's armour without touching the other.
   *
   * Distinct from the two things that already exist and are NOT growth: `AtkMod`/`DefMod`
   * statuses expire, and `Transform` overwrites rather than accumulates. Negative removes.
   */
  | { e: 'AddCounter'; track: 'atk' | 'def'; amount: number }
  /** Give a unit a keyword for a duration. Generalises the one-off `GrantWallPass`. */
  | { e: 'GrantKeyword'; keyword: Keyword; duration: Duration }
  | { e: 'GainSP'; n: number }                                  // overflow-capable, expires at end of turn
  | { e: 'GrantMove'; tiles: number }                           // this turn
  | { e: 'FuseAdjacentFriendly' };                              // Assemble: fuse two adjacent friendly materials

/**
 * What a `Search` will accept. Matches a CARD DEF sitting in the deck, not a `Unit` in play —
 * which is why it cannot reuse the `Condition` predicates, since those all read a live unit.
 *
 * Every field is optional and they AND together; an empty filter matches anything.
 */
export interface SearchFilter {
  kind?: 'unit' | 'spell' | 'trap';
  type?: TypeName;
  keyword?: Keyword;
  /** Inclusive ceiling on a unit card's level. Ignored by spells and traps, which have none. */
  maxLevel?: number;
}

export type TargetSpec =
  | { t: 'Self' }
  | { t: 'ThisTile' }
  | { t: 'DestinationTile' }        // OnKill: the tile advanced onto
  | { t: 'TilesMovedThrough' }      // OnMove; TODO(open): for a 1-tile move = destination (sim-1 ruling)
  | { t: 'TriggeringUnit' }         // mines / zone traps
  /** The tile the trigger was about — currently the painted tile on `OnTerrainPainted`. The
   *  tile-side twin of `TriggeringUnit`. */
  | { t: 'TriggeringTile' }
  /** Whoever is standing on `TriggeringTile`, if anyone. What lets a paint payoff touch the
   *  board rather than only buffing its own caster. */
  | { t: 'UnitOnTriggeringTile' }
  | { t: 'Attacker' }               // traps keying "enemy attacks a friendly"
  | { t: 'ChosenUnit' }             // bound via Action.targets[0]
  | { t: 'ChosenEnemy' }
  /**
   * The friendly mirror of `ChosenEnemy`. Needed the moment a deck wants to SPEND its own body —
   * sacrifice outlets, self-targeted removal — because no `Condition` can see ownership
   * (`targetConditionHolds` passes only the subject and the caster), so `ChosenUnit` + a predicate
   * cannot express "one of mine".
   */
  | { t: 'ChosenFriendly' }
  | { t: 'AdjacentEnemies' }        // all orthogonally adjacent enemies (e.g. Pyre Warden)
  | { t: 'AdjacentEmptyTiles' }     // token placement; TODO(open): overflow = place as many as fit
  | { t: 'EmptyTileNear' }          // token placement adjacent to source, first fit
  | { t: 'FriendlyOfTypes'; types: TypeName[] }
  /** All friendly units orthogonally adjacent to the source. Also legal as a LEADER aura target,
   *  where it makes the leader's position itself the passive. */
  | { t: 'AdjacentFriendlies' }
  /** Enemy counterpart of FriendlyOfTypes — type targeting was friendly-only until 2026-08-05. */
  | { t: 'EnemiesOfTypes'; types: TypeName[] }
  /**
   * Every enemy unit on the board, leaders included.
   *
   * Added 2026-08-16 because "all enemies" was genuinely unwritable: the only untyped enemy targets
   * were `AdjacentEnemies` (a 4-tile shape) and `ChosenEnemy` (one unit), so a board-wide effect had
   * to be spelled `EnemiesOfTypes` with all thirteen types listed — which works, but renders as an
   * unreadable card and silently breaks the moment a fourteenth type is added.
   *
   * ⚠ INCLUDES THE ENEMY LEADER, like `EnemiesOfTypes` does. That is load-bearing rather than
   * incidental: a leader is a unit on the board, `Destroy` already refuses to kill one, and the
   * denial statuses already fizzle against one via `applyStatus`. So the dangerous cases are
   * handled at the chokepoints rather than by making this target quietly skip leaders — a rule that
   * would then be invisible to whoever writes the next card.
   */
  | { t: 'AllEnemies' }
  /** Every unit standing on this terrain, BOTH sides. The kill-zone shape. */
  | { t: 'AllUnitsOnTerrain'; terrain: Terrain }
  /** The 8 tiles surrounding the controller's leader — the summon zone, as a target. */
  | { t: 'TilesAroundLeader' }
  | { t: 'FriendlyOfTypesOnTerrain'; types: TypeName[]; terrain: Terrain } // leader passives (own-tile predicate)
  | { t: 'Line3' }                  // 3 chosen tiles (validated contiguous straight line)
  | { t: 'Area2x2' }                // chosen tile = top-left corner
  | { t: 'Area3x3' };               // chosen tile = center

export type Condition =
  // TODO(open): conditions read EFFECTIVE ATK per the derived-stats architecture (sim-1 gap #8).
  | { k: 'EffAtkAtMost'; amount: number }
  | { k: 'DefenderUnmovedThisTurn' }   // combat-context (Kaelen punish passive)
  /**
   * True while NOTHING enemy stands orthogonally adjacent to the unit. Written for ranged
   * archetypes, whose whole thesis is "deadly at distance, feeble once something closes" — this
   * states that as a rule rather than faking it with a stat line.
   */
  | { k: 'NoAdjacentEnemy' }
  /**
   * Combat-context, attacker-side: true while the unit being attacked carries a `Marked` status.
   * Same shape and call site as DefenderUnmovedThisTurn.
   */
  | { k: 'DefenderIsMarked' }
  // --- 2026-08-05 vocabulary expansion --------------------------------------------------------
  /** Mirror of `EffAtkAtMost`, which only reads downward. */
  | { k: 'EffAtkAtLeast'; amount: number }
  /**
   * Duelyst's Zeal: within `tiles` of its OWN leader, by Chebyshev distance — the same 8-tile
   * shape as the summon zone (and as DotR's 3×3 Support Range). Ties unit power to leader
   * exposure, which is the vault's whole leader risk loop stated as a card rule.
   */
  | { k: 'NearLeader'; tiles: number }
  /** Standing on its own type's favored terrain, per the locked type-vs-terrain chart. */
  | { k: 'OnFavoredTerrain' }
  /**
   * Duelyst's Infiltrate: in the opponent's half. The board is 7 rows with leaders at (4,1)/(4,7)
   * and BOTH springs on row 4, so the split is forced — rows 1–3 belong to player 0, rows 5–7 to
   * player 1, and **row 4 is neutral ground belonging to neither**.
   */
  | { k: 'InEnemyHalf' }
  /** Any friendly unit (leader included) stands on a spring tile. */
  | { k: 'HoldsSpring' }
  /** The controller's LEADER personally stands on a spring tile — the risk-loop variant. */
  | { k: 'LeaderOnSpring' }
  /** The controller's LP is below half of `RULES.startingLife`. Comeback gating. */
  | { k: 'LeaderBelowHalfPool' }
  /** At least `count` units of `type` in the controller's graveyard. */
  | { k: 'GraveyardCountAtLeast'; type: TypeName; count: number }
  /** Subject is one of these monster types. */
  | { k: 'IsType'; types: TypeName[] }
  /** Subject's printed level is at least `amount` — the cleanest power gate, since level IS SP cost. */
  | { k: 'LevelAtLeast'; amount: number }
  /** Subject currently has this keyword (reads through grants and suppression via `hasKeyword`). */
  | { k: 'HasKeyword'; keyword: Keyword }
  /**
   * Subject is braced — in defense stance right now.
   *
   * Stance was previously readable only as an `Action` a player takes, never as something a card
   * could ask about, so a deck whose identity IS the brace/swing decision was unwritable. Leaders
   * can never take a defense stance, so this is always false for one.
   */
  | { k: 'InDefenseStance' }
  /**
   * Subject is a token rather than a real card.
   *
   * `Unit.isToken` has always existed but nothing could READ it, so "sacrifice a token" was
   * unwritable — and level does not substitute, because tokens are `level: 0` while
   * `LevelAtLeast` only reads upward. Needed by any deck that treats its chaff as a resource.
   */
  | { k: 'IsToken' };

/**
 * Qualifiers that gate WHEN a trigger fires — as opposed to `Rule.condition`, which gates what a
 * resolved rule applies TO. Every field is read by a specific subset of triggers and is a silent
 * no-op elsewhere, so `validateCardRules` / `validateLeader` reject stating one where it cannot
 * be read.
 *
 * Grouped rather than spread across `Rule` so there is one obvious home for future qualifiers —
 * and so `Rule.scope` stops colliding by name with `SpellCardDef.scope`, which means something
 * entirely different ('global' | 'located').
 */
export interface TriggerWhen {
  /**
   * Whose event this listens to, for the scoped triggers (`OnCapture`, `OnAllyDeath`,
   * `OnTrapTriggered`, `OnTerrainPainted`).
   *
   * Defaults are per-trigger and chosen to preserve pre-2026-08-04 behaviour exactly — see
   * `scopeMatches` in engine.ts. Notably `OnCapture` defaulted differently for units (`self`)
   * and leaders (`friendly`), an asymmetry that was hardcoded and flagged TODO(open); the
   * default now reproduces it, and `scope` lets content state which it wants.
   */
  scope?: TriggerScope;
  /** `OnTerrainPainted` only: fire only when the tile became this terrain. */
  terrain?: Terrain;
  /**
   * A gate on the TRIGGERING unit, evaluated **once per event** before the rule fires.
   *
   * Distinct from `Rule.condition`, which is a per-TARGET filter run inside the effect loop.
   * "When the opponent summons a Dragon, buff my Warriors" cannot be a target filter, because the
   * targets are the Warriors and the predicate is about the Dragon.
   *
   * Reuses the `Condition` union, so the generic unit predicates (`IsType`, `LevelAtLeast`,
   * `HasKeyword`, `EffAtkAtLeast`, …) serve as both target filters and trigger gates.
   */
  triggerUnit?: Condition;
}

export interface Rule {
  trigger: Trigger;
  effect: Effect;
  target: TargetSpec;
  condition?: Condition;
  /** Trigger-firing qualifiers. See {@link TriggerWhen}. */
  when?: TriggerWhen;
}

// ---------------------------------------------------------------------------
// Card definitions (content is data, not code)
// ---------------------------------------------------------------------------

export interface UnitCardDef {
  kind: 'unit';
  id: string;
  name: string;
  type: TypeName;
  level: number; // SP cost unless `sp` overrides it
  /** SP summon cost override for top-end units (2026-07 economy experiment). Defaults to level. */
  sp?: number;
  atk: number;
  /** Defensive stat: what an attack is resolved against while this unit is in defense stance.
   *  Optional only for tokens and the pre-two-stat sim fixtures — every registered deck card
   *  prints its own. When absent the engine falls back to round(atk/2). */
  def?: number;
  /** Deck Cost: deckbuild power budget (1 filler … 5 game-warping). Leaders/tokens carry none. */
  dc: number;
  keywords: Keyword[];
  /**
   * EXACT firing distance for a `Ranged` unit, in orthogonal tiles. Defaults to 1.
   *
   * Exact, not "up to": a range-2 shooter hits things exactly 2 tiles away and CANNOT hit an
   * adjacent enemy. That dead zone is the point — closing the gap is what melee does to an
   * archer. A shooter caught in its own dead zone falls back to an ordinary melee attack (move
   * onto the enemy), paying the usual exposure cost like anyone else.
   *
   * Ignored without the `Ranged` keyword. Default 1 keeps every card authored before this
   * existed behaving exactly as before.
   */
  range?: number;
  rules: Rule[];
  /** Present only on fusion-pool cards: the two material card ids. */
  fusion?: { materials: [string, string] };
}

export interface SpellEffectLine { effect: Effect; target: TargetSpec; condition?: Condition }

export interface SpellCardDef {
  kind: 'spell';
  id: string;
  name: string;
  /** Deck Cost: deckbuild power budget (spells additionally cost `sp` at activation). */
  dc: number;
  /** SP paid when the spell activates (cast from hand or flipped from set; lost if negated).
   *  Default 0. Mines never pay it — they detonate off enemy contact, not an activation. */
  sp?: number;
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
  /** Deck Cost: the power budget. Since 2026-08-09 a trap also costs `sp` to set. */
  dc: number;
  /**
   * SP paid when the trap is SET face-down (2026-08-09), not when it fires — a trap springs on the
   * OPPONENT's turn, when its owner's SP pool is 0, so activation is not a payable moment.
   * Default 0.
   *
   * Traps used to be free ("DC is their entire price"), which made setting one a strictly
   * additive play: the whole non-unit cap could be filled on turns that also spent every point of
   * SP on bodies. Pricing the set makes a trap compete with a summon for the same turn, which is
   * what the SP economy is for. The DC surcharge that a few CC traps carried *because* they were
   * free came back off in the same pass — a trap now prices like the equivalent spell.
   */
  sp?: number;
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
  /** See UnitCardDef.range. Defaults to 1. */
  range?: number;
}

export interface AbilityDef {
  id: string;
  name: string;
  cost: number;
  /** Located abilities must target tiles within the leader's own reach (Chebyshev <= 1); global fire from anywhere. */
  located: boolean;
  effects: SpellEffectLine[];
}

export interface LeaderDef {
  id: string;
  name: string;
  type: TypeName;
  atk: number;
  /**
   * Exact firing distance, as on a unit card (see UnitCardDef.range). Defaults to 1.
   *
   * A ranged leader is identity-defining (Combat Resolution calls it "a strong, identity-defining
   * archetype perk") and does NOT break the vault's leader risk loop: an exact range means the
   * leader must hold a sweet spot rather than sit safe, and anything that closes inside the band
   * turns its attack off entirely.
   */
  range?: number;
  /** Passive auras plus leader triggers (Briar OnMove paint, Oskar OnCapture draw). */
  rules: Rule[];
  ability: AbilityDef;
}

// ---------------------------------------------------------------------------
// Board & game state
// ---------------------------------------------------------------------------

export type Occupant = { kind: 'unit'; id: string } | { kind: 'set'; id: string };

/**
 * A Sigil: marked ground that applies a timed status to any unit that ENTERS the tile.
 *
 * Deliberately NOT a terrain. Like `spring`, a sigil is an orthogonal marker riding on top of
 * whatever terrain the tile already has — so a sigil on Forest and a sigil on Mountain are both
 * legal and mean different things, and the tile keeps its ordinary type-vs-terrain ±10. The
 * counterplay is repainting: any successful `PaintTerrain` on the tile wipes the sigil.
 *
 * On ENTRY only, never while standing. That is what keeps a movement-denial sigil from
 * soft-locking its victim: a while-standing stun would mean the unit cannot move, therefore
 * cannot leave, therefore is stunned forever. See the vault's Crowd Control & Status Effects.
 */
export interface SigilSpec {
  status: StatusEffectKind;
  /** 0 for Stunned; the modifier amount for AtkMod/DefMod. */
  amount: number;
  /** Duration in the affected unit's OWN turns. 0 makes the sigil inert. */
  turns: number;
}

export interface Tile {
  terrain: Terrain;
  spring: boolean;
  springActive: boolean;
  /** Round at which a captured spring relights. TODO(open): vault says "synchronized"; sim-1 ruled per-spring 3 turns after its own capture. */
  springRelightRound?: number;
  occupant?: Occupant;
  /** Marked ground; fires on entry, cleared by painting. See {@link SigilSpec}. */
  sigil?: SigilSpec;
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
  /** Defensive stat, used against attacks while `stance === 'defense'`. Resolved at creation
   *  from the card's `def` (fallback = round(atk/2)). Leaders carry 0 — they never defend. */
  baseDef: number;
  level: number;
  pos: Coord;
  isToken: boolean;
  isLeader: boolean;
  /** Attack (default) or defense position — the ONLY thing that decides whether an attack
   *  resolves against DEF. A revealed face-down unit keeps whatever stance it was set in
   *  (see SetCard.stance); how it was revealed does not change it. */
  stance: 'attack' | 'defense';
  /**
   * Turns of summoning sickness still to serve; > 0 blocks attacking, fusing, ranged attacks
   * and stance changes. Decremented at the start of the owner's turn. A count rather than a
   * flag so `RULES.summoningSickTurns` can shorten it to 0 (units act the turn they arrive)
   * or stretch it past one turn. Use `isSick(u)` to read it.
   */
  sickTurns: number;
  hasActed: boolean;      // has moved / attacked / fused this turn
  /** Did this unit move during its OWN most recent turn? Cleared at the start of its owner's
   *  turn only, so an enemy reads it as "parked" — that is what punish-passives key on. */
  movedThisTurn: boolean;
  keywords: Keyword[];
  /** Resolved exact firing distance (see UnitCardDef.range). 1 unless the card says otherwise. */
  range: number;
  statuses: TimedStatus[];
  /**
   * PERMANENT stat growth, two independent tracks. Unlike `AtkMod`/`DefMod` statuses these never
   * expire, and unlike `Transform` they accumulate rather than overwrite — which is what makes
   * "gets stronger every turn it survives" expressible. Counted in COUNTERS; each is worth
   * `COUNTER_STEP` of the stat.
   */
  atkCounters: number;
  defCounters: number;
  extraMove: number;      // granted movement, this turn
}

export interface SetCard {
  id: string;
  owner: PlayerId;
  cardId: string;
  kind: 'spell' | 'trap' | 'unit'; // face-down units share the same back — the universal bluff
  pos: Coord;
  hasActed: boolean;
  /** Owner's turnCount when set — a unit flipped on the same turn stays summoning-sick. */
  setTurnCount: number;
  /**
   * Stance a face-down UNIT is holding, chosen when it is set and carried through whichever
   * way it is revealed. Meaningless on a set spell or trap, which store 'attack'.
   *
   * ⚠ 2026-08-16 RULE CHANGE. Face-down used to MEAN defense position: a set unit revealed by
   * an attack was forced into 'defense' and fought on its DEF, while the same card flip-summoned
   * by its owner came up in 'attack'. Same card, different stat, decided by how it happened to be
   * revealed. Being hidden and being braced are now orthogonal — DEF applies when a unit is in
   * defense position, face-down or face-up, and nowhere else.
   *
   * Not shown to the opponent: the back stays identical whatever the stance, so the universal
   * bluff is intact and attacking a face-down card is still a genuine gamble.
   */
  stance: 'attack' | 'defense';
}

export interface PlayerState {
  leaderLife: number;
  sp: number;
  hand: string[];       // card def ids (duplicates allowed)
  deck: string[];
  graveyard: string[];
  fusionPool: string[]; // fusion-pool card def ids
  turnCount: number;    // own turns taken so far
  /** Missed draws from an empty deck; each deals 10 × fatigue LP (2026-07-15 ruling). */
  fatigue: number;
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
  /**
   * Set when a draw pushed a hand past the 7-card cap: the incoming card entered
   * (last in hand) and the owner must burn one of the OTHERS to the void before
   * any other action. remainingDraws = draws still queued behind the choice.
   */
  pendingBurn?: { player: PlayerId; remainingDraws: number };
  winner?: PlayerId;
  nextId: number;
  /**
   * Seed for randomness that has to happen mid-resolution (`Search` reshuffling the deck).
   *
   * Every other shuffle in the project is done by the CALLER before `initGame` — the GUI with
   * `Math.random`, the harness and tests with `mulberry32(seed)` — but an effect resolving inside
   * `applyAction` has no caller to ask. Advanced only by `nextRandom`, so while nothing consumes
   * randomness this never moves and every existing game is byte-identical.
   */
  rngSeed: number;
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
  /** `stance` applies to face-down UNITS only and defaults to 'attack'; see SetCard.stance. */
  | { t: 'SetCard'; card: string; tile: Coord; stance?: 'attack' | 'defense' }
  | { t: 'MoveSet'; set: string; to: Coord }
  /**
   * `targets` names TILES; `chosenCards` names CARDS in a zone (`RaiseFromGraveyard` picks which
   * body comes back, `Search` mode 'choose' picks which card is fetched). The two are independent
   * axes of the same activation — a chosen Raise supplies one of each — which is why they are
   * separate fields rather than one polymorphic list.
   *
   * Card IDENTITY, not zone index: copies of a card are interchangeable, so an id dedupes the
   * bots' action space naturally (`legalActions` already dedupes hand cards the same way), and an
   * index would emit one redundant action per duplicate copy. The engine resolves an id to the
   * last matching entry in the zone.
   *
   * ⚠ OPTIONAL, and absent means the pre-2026-08-08 behaviour — `RaiseFromGraveyard` falls back to
   * "most recent match". Every sim suite, every trigger-fired raise, and Duneforged's Raise the
   * Fallen depend on that fallback, so this field is purely additive.
   */
  | { t: 'FlipCard'; set: string; targets?: Coord[]; chosenCards?: string[] }
  | { t: 'CastSpell'; card: string; targets?: Coord[]; chosenCards?: string[] }
  | { t: 'ActivateAbility'; targets?: Coord[]; chosenCards?: string[] }
  /** Switch a face-up unit's attack/defense position. Once per turn, consumes the unit's
   *  action; illegal the turn it was summoned or after it has acted. */
  | { t: 'SetStance'; unit: string; stance: 'attack' | 'defense' }
  /** Resolve a pending hand-cap overflow: burn hand[index] to the void (never the incoming card). */
  | { t: 'BurnCard'; index: number }
  | { t: 'EndTurn' };

export interface CombatCtx {
  role: 'attacker' | 'defender';
  battleTile: Coord;   // the defended tile — terrain resolves here for BOTH combatants
  opponentId: string;
}
