// Skyfire — Kaelen, the Ashwing. Avian / Mountain. REBUILT 2026-08-08 (deck overhaul, deck #3).
//
// ---------------------------------------------------------------------------
// Axis: MOBILITY — the movement rule itself.
// Verbs: raise · run · arrive · strike.
// ---------------------------------------------------------------------------
//
// Everyone else moves one tile. This deck BUILDS GROUND IT MOVES TWO ON, and every card is about
// arriving. `RULES.favoredTerrainMove` (adopted 2026-08-06) gives a unit +1 move while it stands on
// its own favored terrain; until now nothing in the game was built on it — Ironhold's header names
// it only as a drawback. It was an unclaimed axis sitting in the ruleset.
//
// The fiction: volcanic firebirds whose fire fuses ground into rock. They raise the crags they fly
// best over. The type is Avian throughout; the fire is in what the cards DO.
//
// THE ENGINE, and why it self-sustains. `interpolatePath` is origin-exclusive and
// DESTINATION-INCLUSIVE, so a body with `OnMove -> PaintTerrain Mountain -> TilesMovedThrough`
// paints the tile it lands on:
//
//     turn 1   on Normal, move 1  ->  destination becomes Mountain
//     turn 2   on Mountain, move 2 -> paints both, ends on Mountain
//     turn 3+  permanently a 2-mover, dragging a ridge behind it
//
// No UNIT in the game does this — only three leaders do (Briar, Neris, Vharos), which is exactly
// why it goes on bodies here. Repainting a tile that is already Mountain does not re-fire
// Terrainfall, so the engine cannot farm its own trigger.
//
// ⚠ WHY THE MOBILITY IS ON RULES AND TERRAIN, NEVER ON SPELLS. `extraMoveTile` is 0 in
// `DEFAULT_WEIGHTS` and only 3 under Expert — the instrumented note in evaluate.ts reads
// "GrantMove 1 … −6.0 — extraMove is scored nowhere". The bots value a mobility spell at LITERALLY
// NOTHING, which is the same gate that made the CC work unmeasurable. Both channels this deck uses
// are already priced instead: extra reach from favored terrain enters through the legal-move
// generator, so the bot uses it with no weight at all; and Mountain gives Avian +10, which
// `effectiveAtk` prices and `unitAtk` weights, so the bot stands on its own road for the STAT
// reason and gets the movement free. Where a card does grant movement, it is either riding on a
// summon the bot already wants (`windriderScout`, `updraftHerald`) or paired with an eval-VISIBLE
// effect on the same card (`emberWake`, Divebomb) so the bot will actually play it.
//
// WHAT THIS REBUILD IS NOT. Unlike Red Mark and Hivebrood this was never a stat problem —
// `npm run diagnose -- skyfire` measured mean ATK 32.6 against a field of 29.7 and ATK/DC 7.21
// against 7.42. It was a TEXT problem, and two defects in particular:
//
//   · SPLIT TERRAIN. Avian favors Mountain, Inferno favors Desert, so the deck's own Scorched
//     Earth built a road half its army could not use. Fixed by unifying on Avian.
//   · DEAD REACH. Five cards carried `Ranged` at range 1, where `canRetaliate` returns true from
//     adjacency — near-identical to melee. Measured 0.50 ranged attacks per game, with "had a legal
//     shot" (33.9%) exactly equal to "was engaged" (33.9%): the same set. `Ranged` is now stripped
//     from the deck entirely, which is DC-neutral since `rangeDc(1)` is 0.
//
// Stripping reach also closes the kite-stall question that vetoed "Windrunners": rules.ts records
// that `favoredTerrainMove` produced faster CONTACT, not better kiting — a finding that only holds
// for a melee deck. This one has no reach at all.
//
// ⚠ BLUEPRINT RULE 1 — the collision that needed checking is DRAGONSPIRE, which also raises
// Mountain. It raises it UNDER ITSELF WHERE IT STANDS — a camp, for the +10 ATK on a go-tall horde —
// and does so from its LEADER's OnMove. Skyfire raises it AHEAD OF ITSELF, as a road, from its
// BODIES, and cashes the terrain in as reach rather than as stats. Against the others: Wildgrowth
// paints to make bodies bigger (a place to stand), this paints to make them faster (a road to run);
// Tidecaller moves the ENEMY, this moves ITSELF; Red Mark is the static Anchored mirror-image.
//
// STATED WEAKNESSES (rules, not vibes — and every counter already exists, none designed as one):
//   · THE ROAD IS PUBLIC, and it feeds the strongest deck. Dragon and Machine favor Mountain too,
//     so Dragonspire runs on anything this deck raises.
//   · SEA IS AVIAN'S WEAK TERRAIN AND TIDECALLER PAINTS SEA — one spell erases the road and applies
//     −10 on the same tile.
//   · MOVEMENT DENIAL SWITCHES THE DECK OFF. Red Mark fields three Stakeline (Snared) and Caltrop
//     Screen; `Anchored` bodies cannot be shifted at all.
//   · NO REACH — the axis's cost. Anything that shoots from 2 answers this deck without being
//     touched.

import type { CardDef, LeaderDef } from '../../types';
import { SKYFIRE_CARDS } from '../simDecks';
import { armour, dup, priceSpell, unitDc, type DeckDef } from './deckDef';

/** The shared stat rubric, so this deck's DEF is billed exactly like everyone else's. */
const body = (atk: number, def: number): number => unitDc(atk, def);

/**
 * ⚠ FROZEN SHARED BLOCK — these seven defs are NOT part of the reworked deck and must not change.
 *
 * `duneforged.ts` imports this record and fields six of them (`cinderImp`, `magmaWhelp`,
 * `ashenFirebrand`, `scorchedEarth`, `stokefire`, `backdraft`) as its Desert package. Duneforged's
 * whole premise is that Undead, Insect and INFERNO all favour Desert, so retyping these to Avian
 * or repointing Scorched Earth to Mountain would silently rewrite a deck this pass is not about —
 * and Duneforged is deliberately last in the overhaul precisely because it defines no cards of its
 * own. `tailwind` and `windriderScout` are here for the same reason from the other direction:
 * `archetypes.test.ts` uses them as its `GrantMove` fixtures.
 *
 * Same carve-out, same reasoning, as `venomSpitter` in hivebrood.ts.
 *
 * They stay in `SKYFIRE_DECK.cards` (so `DECK_CARDS` still resolves them) while appearing in the
 * deck's `list` only where the rebuilt deck genuinely wants them — `meteor` and `windriderScout`.
 */
export const SKYFIRE_EXTRA_CARDS: Record<string, CardDef> = {
  meteor: priceSpell(SKYFIRE_CARDS.meteor!, 3),
  cinderImp: armour(SKYFIRE_CARDS.cinderImp!, 10),
  emberhawk: armour(SKYFIRE_CARDS.emberhawk!, 10),
  blazingRoc: armour(SKYFIRE_CARDS.blazingRoc!, 15),
  pyreWarden: armour(SKYFIRE_CARDS.pyreWarden!, 35),
  magmaWhelp: {
    kind: 'unit', id: 'magmaWhelp', name: 'Magma Whelp', type: 'Inferno', level: 2, atk: 20, def: 15, dc: 2,
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'Damage', amount: 10 }, target: { t: 'AdjacentEnemies' } }],
  },
  ashenFirebrand: {
    kind: 'unit', id: 'ashenFirebrand', name: 'Ashen Firebrand', type: 'Inferno', level: 4, atk: 35, def: 20, dc: 3,
    keywords: [],
    rules: [{ trigger: 'StartOfTurn', effect: { e: 'Damage', amount: 10 }, target: { t: 'AdjacentEnemies' } }],
  },
  stokefire: {
    kind: 'spell', id: 'stokefire', name: 'Stokefire', dc: 2, sp: 1, scope: 'global',
    effects: [
      { effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' } },
      { effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
    ],
  },
  scorchedEarth: {
    kind: 'spell', id: 'scorchedEarth', name: 'Scorched Earth', dc: 2, sp: 1, scope: 'located',
    effects: [{ effect: { e: 'PaintTerrain', terrain: 'Desert' }, target: { t: 'Line3' } }],
  },
  backdraft: {
    // 20 -> 30 damage, DC 2 -> 3 / SP 1 -> 2 (2026-08-16, DAMAGE_FLOOR). Defined here but fielded
    // only by Duneforged (see the list comment below), so the cost lands on that deck's budget.
    kind: 'trap', id: 'backdraft', name: 'Backdraft', dc: 2, sp: 2, interrupt: 'respond',
    trigger: { t: 'enemyAttacksFriendly' },
    effects: [{ effect: { e: 'Damage', amount: 30 }, target: { t: 'Attacker' } }],
  },
  tailwind: {
    kind: 'spell', id: 'tailwind', name: 'Tailwind', dc: 2, sp: 2, scope: 'global',
    effects: [{ effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'FriendlyOfTypes', types: ['Avian', 'Inferno'] } }],
  },
  windriderScout: {
    // ATK 20 -> 25, free under the rubric (the tiers are coarse below 30, and DEF stays under the
    // round(atk/2) line). The one legacy body the rebuilt deck still fields: a 2-drop that arrives
    // already moving is the deck's thesis on its cheapest card.
    kind: 'unit', id: 'windriderScout', name: 'Windrider Scout', type: 'Avian', level: 2, atk: 25, def: 10,
    dc: body(25, 10) + 1, // +1: OnSummon self-dash
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'Self' } }],
  },
};

/**
 * Kaelen, the Ashwing. The punish-passive is the deck's thesis printed on the leader: a mobile army
 * exists to catch a static one, and this pays +5 for hitting exactly that.
 *
 * ⚠ That passive spent most of the project INERT — `movedThisTurn` was cleared for every unit at
 * the start of each turn, so an enemy defender always read "unmoved" and the bonus always applied.
 * Fixed 2026-08-04 by scoping the clear to the active player, which is what finally made the
 * condition mean what its name claims: the defender is PARKED, it did not move on its own turn.
 *
 * Divebomb pairs the eval-blind half (`GrantMove`) with an eval-VISIBLE one (`AtkMod`) on the same
 * activation. Without the pairing a one-ply bot scores the ability at −6 and never fires it, so the
 * leader's whole active slot would be dead outside Expert.
 */
export const KAELEN_ASHWING: LeaderDef = {
  id: 'kaelen', name: 'Kaelen, the Ashwing', type: 'Avian', atk: 25,
  rules: [
    {
      trigger: 'Passive',
      effect: { e: 'AuraAtk', amount: 5 },
      target: { t: 'FriendlyOfTypes', types: ['Avian'] },
      condition: { k: 'DefenderUnmovedThisTurn' },
    },
  ],
  ability: {
    id: 'divebomb', name: 'Divebomb', cost: 3, located: true,
    effects: [
      { effect: { e: 'GrantMove', tiles: 2 }, target: { t: 'ChosenUnit' } },
      {
        effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 10, duration: { kind: 'endOfTurn' } },
        target: { t: 'ChosenUnit' },
      },
    ],
  },
};

export const SKYFIRE_DECK_CARDS: Record<string, CardDef> = {
  // --- THE FLOCK. Anonymous ranks at 3; the ridge-makers are what the deck is. ---

  scoriaHawk: {
    // THE ENGINE, printed as cheaply as it can be. Scoria is the rock a lava flow leaves behind:
    // this bird IS the road, and because the paint lands on its destination tile it is a 2-mover
    // from its second turn onward without any help.
    kind: 'unit', id: 'scoriaHawk', name: 'Scoria Hawk', type: 'Avian',
    level: 2, atk: 25, def: 10, dc: body(25, 10) + 1, // +1: the trail paint
    keywords: [],
    rules: [{ trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Mountain' }, target: { t: 'TilesMovedThrough' } }],
  },
  updraftHerald: {
    // Mobility for the whole flock on a body the bot summons for its stats anyway — which is the
    // only way a GrantMove effect reaches the board at Normal and Hard.
    kind: 'unit', id: 'updraftHerald', name: 'Updraft Herald', type: 'Avian',
    level: 3, atk: 25, def: 10, dc: body(25, 10) + 1, // +1: OnSummon team dash
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'FriendlyOfTypes', types: ['Avian'] } }],
  },
  ashfallStriker: {
    // The verb `arrive`, as a rule: it burns whatever it lands beside. `AdjacentEnemies` resolves
    // from the mover's position AFTER the step, so a 2-tile charge sets fire to the far end of the
    // board. Damage 10 destroys only what it out-muscles (>= effective ATK), so this is a chaff
    // sweeper, not removal — it clears the screen the deck has to run through.
    kind: 'unit', id: 'ashfallStriker', name: 'Ashfall Striker', type: 'Avian',
    level: 4, atk: 40, def: 15, dc: body(40, 15) + 1, // +1: OnMove burn
    keywords: [],
    rules: [{ trigger: 'OnMove', effect: { e: 'Damage', amount: 10 }, target: { t: 'AdjacentEnemies' } }],
  },
  crucibleHarrier: {
    // FIRST USER OF TERRAINFALL anywhere in the game. `OnTerrainPainted` was added 2026-08-05 and
    // no card had ever read it. The rock this deck makes comes up molten, and the heat off it lifts
    // the flock — so raising ground is not only a road, it is a swing.
    //
    // Self-targeted deliberately. `UnitOnTriggeringTile` is side-AGNOSTIC, and the deck's own trail
    // bodies stand on the tile they just painted, so any damage aimed there would burn the engine
    // down. The buff form has the same trigger and no friendly fire.
    kind: 'unit', id: 'crucibleHarrier', name: 'Crucible Harrier', type: 'Avian',
    level: 4, atk: 40, def: 20, dc: body(40, 20) + 1, // +1: the Terrainfall payoff
    keywords: [],
    rules: [{
      trigger: 'OnTerrainPainted',
      when: { terrain: 'Mountain', scope: 'friendly' },
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 10, duration: { kind: 'endOfTurn' } },
      target: { t: 'Self' },
    }],
  },
  basaltRoc: {
    // The heavy road-layer. A Scoria Hawk scratches a line; this drags a ridge, and it is big
    // enough to survive standing at the far end of one.
    kind: 'unit', id: 'basaltRoc', name: 'Basalt Roc', type: 'Avian',
    level: 4, atk: 45, def: 20, dc: body(45, 20) + 1, // +1: the trail paint
    keywords: [],
    rules: [{ trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Mountain' }, target: { t: 'TilesMovedThrough' } }],
  },

  // --- NAMED. An elite is individuals; a flock is not. ---

  ashridgeTyrant: {
    // NAMED (3 copies — the tyrants are a brood, not a singular). It fights best on ground it made:
    // +10 from the self-aura on top of the chart's +10 for Mountain, so a Tyrant that reached its
    // own ridge swings at 65. That stacking is the payoff the whole road is building toward.
    kind: 'unit', id: 'ashridgeTyrant', name: 'Ashridge Tyrant', type: 'Avian',
    level: 5, sp: 7, atk: 45, def: 25, dc: body(45, 25) + 1, // +1: the conditional self-aura
    keywords: [],
    rules: [{
      trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'Self' },
      condition: { k: 'OnFavoredTerrain' },
    }],
  },
  veskaFirstwing: {
    // NAMED (2 copies). The top end, and the deck's longest road: at 55 ATK she outreaches the
    // field average of 52 while still sitting under Dragonspire's ceiling, and every tile she
    // crosses stays Mountain for everything behind her.
    kind: 'unit', id: 'veskaFirstwing', name: 'Veska, the Firstwing', type: 'Avian',
    level: 6, sp: 8, atk: 55, def: 25, dc: body(55, 25) + 1, // +1: the trail paint
    keywords: [],
    rules: [{ trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Mountain' }, target: { t: 'TilesMovedThrough' } }],
  },

  // --- THE FLIGHT. Written as the road and the run. ---

  emberWake: {
    // THE SIGNATURE CARD: the road and the run on one activation. Dragonspire's Raise the Spires
    // paints the same terrain for the same price and stops there — this hands the reach over in
    // the same breath, which is the whole difference between a camp and a road.
    //
    // The pairing is also what makes it castable: the paint is eval-visible (Mountain is +10 to
    // every Avian standing on it) so the bot plays the card, and the GrantMove it cannot see rides
    // along for free.
    kind: 'spell', id: 'emberWake', name: 'Ember Wake', dc: 3, sp: 2, scope: 'located',
    effects: [
      { effect: { e: 'PaintTerrain', terrain: 'Mountain' }, target: { t: 'Line3' } },
      { effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'FriendlyOfTypes', types: ['Avian'] } },
    ],
  },
  crestTheRidge: {
    // The anthem. It was gated on `OnFavoredTerrain` — only birds standing on their own Mountain —
    // and priced cheap because "the condition is real".
    //
    // ⚠ THE CONDITION WAS TOO REAL. `npm run impact` measured units-buffed-per-cast across every
    // anthem in the pool: Swarm Call 8.4, Rally the Ranks 5.9, Close Ranks 4.7, and this at **1.8**.
    // A mass buff that reaches under two bodies is a single-target pump wearing an anthem's text,
    // and the deck was paying a card and an SP for it. Same failure as Briar's conditional passives
    // (see the header of wildgrowth.ts): ⚠ conditions need their uptime measured, not assumed.
    //
    // The gate is gone. DC stays at 2: the +10 and the duration are untouched, and the discount was
    // for a condition that was not delivering the discount's worth of drawback.
    kind: 'spell', id: 'crestTheRidge', name: 'Crest the Ridge', dc: 2, sp: 1, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 10, duration: { kind: 'endOfTurn' } },
      target: { t: 'FriendlyOfTypes', types: ['Avian'] },
    }],
  },
  emberTithe: {
    // The standard economy piece. Deliberately the cheap version rather than Dragonspire's 2-SP
    // ramp: this deck wants tempo, not a bigger turn six, and the 3 DC that bought the second
    // point of SP is worth more as an Upthrust.
    kind: 'spell', id: 'emberTithe', name: 'Ember Tithe', dc: 2, sp: 1, scope: 'global',
    effects: [
      { effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' } },
      { effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
    ],
  },

  // --- FIELDWORKS. A deck with no reach still needs an answer to a line it cannot out-trade. ---

  upthrust: {
    // A trap that BUILDS ROAD. Nothing else in the game does that: the ground bucks under whoever
    // walks into the zone and then STAYS up, so a sprung trap leaves the flock a tile it moves two
    // from. The paint targets the trap's own tile (`ThisTile` binds the set card's position), which
    // is what makes it a piece of deliberate groundwork rather than a damage roll.
    // 20 -> 30 damage, DC 3 -> 4 / SP 2 -> 3 (2026-08-16, DAMAGE_FLOOR). The paint half was working
    // (7 fires, 7 Mountain tiles laid); the damage half took 0 kills in 7 hits, so the deck was
    // paying a zone trap's price for a road-building rider and nothing else.
    kind: 'trap', id: 'upthrust', name: 'Upthrust', dc: 3, sp: 3, interrupt: 'respond', // +1 over a plain zone trap: the paint
    trigger: { t: 'zone' },
    effects: [
      { effect: { e: 'Damage', amount: 30 }, target: { t: 'TriggeringUnit' } },
      { effect: { e: 'PaintTerrain', terrain: 'Mountain' }, target: { t: 'ThisTile' } },
    ],
  },
  flareMine: {
    // 20 -> 30 damage, DC 2 -> 3 / SP 1 -> 2 (2026-08-16). This card and Duneforged's `scorchMine`
    // ARE the DAMAGE_FLOOR precedent — the same mine at two tiers, already priced one apart. It is
    // now the same card, which is the point: the 20 tier was not a cheaper option, it was a blank.
    kind: 'spell', id: 'flareMine', name: 'Flare Mine', dc: 2, sp: 2, scope: 'located',
    effects: [{ effect: { e: 'Damage', amount: 30 }, target: { t: 'TriggeringUnit' } }],
  },
  updraftCounter: {
    kind: 'trap', id: 'updraftCounter', name: 'Updraft Counter', dc: 3, sp: 2, interrupt: 'negate',
    trigger: { t: 'enemyActivatesSpell' },
    effects: [{ effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },

  // --- FUSION: the ridge itself, on the wing. ---

  ashridgePhoenix: {
    // Was the WORST recipe in the game: it ate the deck's two best 45-ATK bodies (90 ATK) to make
    // 70. Now two 25-ATK 2-drops, which is both a gain and far likelier to assemble — and a phoenix
    // rising out of the flock's smallest birds reads better than one eating its own elites.
    kind: 'unit', id: 'ashridgePhoenix', name: 'Ashridge Phoenix', type: 'Avian',
    level: 4, atk: 70, def: 30, dc: body(70, 30) + 1, // +1: the trail paint; level 4 = 2 Scoria + 2 Scout
    keywords: [],
    rules: [{ trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Mountain' }, target: { t: 'TilesMovedThrough' } }],
    fusion: { materials: ['scoriaHawk', 'windriderScout'] },
  },
};

export const SKYFIRE_DECK: DeckDef = {
  id: 'skyfire',
  name: 'Skyfire',
  leader: KAELEN_ASHWING,
  cards: { ...SKYFIRE_EXTRA_CARDS, ...SKYFIRE_DECK_CARDS },
  list: [
    // The flock.
    ...dup('windriderScout', 3), ...dup('scoriaHawk', 3), ...dup('updraftHerald', 2),
    ...dup('ashfallStriker', 3), ...dup('crucibleHarrier', 3), ...dup('basaltRoc', 3),
    // Named.
    ...dup('ashridgeTyrant', 3), ...dup('veskaFirstwing', 2),
    // The flight.
    ...dup('emberWake', 3), ...dup('crestTheRidge', 2), ...dup('emberTithe', 3),
    ...dup('meteor', 2),
    // Fieldworks. Backdraft is deliberately NOT re-fielded — it is frozen for Duneforged, so a
    // card this deck could never tune again is a card it should not be building on.
    ...dup('flareMine', 3), ...dup('upthrust', 3), ...dup('updraftCounter', 2),
  ],
  fusionPool: ['ashridgePhoenix'],
};
