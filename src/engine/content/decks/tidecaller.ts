// Tidecaller — Neris, the Undertow. Aqua. REBUILT 2026-08-08 (deck overhaul #5).
//
// ---------------------------------------------------------------------------
// Axis: THE UNDERTOW — displacement into a prepared kill zone.
// Verbs: seed · drag · spring · drown.
// ---------------------------------------------------------------------------
//
// The old deck said "paint Sea, drag enemies onto it". Measured, that combo was not merely weak, it
// was IMPOSSIBLE — and the half that worked belonged to another deck:
//
//   · ATK per DC 5.55 against a field of 7.67 — the worst rate in the pool, on 20 bodies vs 25,
//     with 48% of the budget (52 DC over 20 cards) spent on spells and traps.
//   · Enemies stood on Sea 13.0% of the time while Sea covered 16.7% of the board — BELOW CHANCE.
//     Displacement direction is pure geometry (`Push` away from the origin, `Pull` toward it), never
//     a chosen destination, so a shove can never be aimed at a tile. And a bot will not walk onto
//     terrain that weakens it.
//   · Its own Aqua stood on Sea 65.3% of the time for +10 — which is paint-terrain-and-stand-on-it,
//     i.e. WILDGROWTH'S AXIS, a blueprint rule 1 collision.
//   · The displacement spells barely cast at all: undertow 0.28, Siren's Call 0.22, Maelstrom 0.09
//     per game, across seven card slots and 16 DC.
//
// THE ENGINE WAS ALREADY IN THE RULES AND NO CARD WAS BUILT FOR IT. `displaceUnit` fires traps:
// "a zone trap does not care HOW a unit arrived on its tile — shoving an enemy into a trap zone
// springs it exactly as walking in would." Measured on the old deck: 7.63 displacements per game,
// 2.94 traps fired per game, and **displacement that sprang a trap: 0.03 per game.** The two halves
// never met.
//
// ⚠ TWO DISCOVERIES SHAPE THIS DECK, AND THE SECOND OVERRULES THE FIRST.
//
// (1) IT MUST PULL, NEVER PUSH. `legalActions` offers `SetCard` only on the LEADER'S OWN 8-RING, and
// a set card crawls one tile per turn, so your minefield is always around your own leader — a push
// sends enemies away from it, a pull brings them toward it. The old build's most-used effect was
// Neris's `Push 1 -> Area3x3` at 2.91 casts per game, shoving enemies out of the very trap field she
// was standing in. Flipping that sign is the rebuild.
//
// (2) ⚠ BUT YOUR OWN PULLS CAN NEVER SPRING YOUR OWN TRAPS. `fireTraps` opens with
// `const defenderSide = s.active === 0 ? 1 : 0` — only the NON-ACTIVE player's traps are ever armed,
// which is the vault's locked "traps are reactive, opponent-action-only". So the obvious fantasy —
// cast a drag, haul someone into your minefield, watch it go off — is not merely weak, it is
// unreachable. Every trap in this deck fires on the OPPONENT'S turn or not at all.
//
// WHICH MAKES THE DECK REACTIVE, AND THAT IS A BETTER FICTION ANYWAY: you do not drag them in. They
// come to the water, and the water takes them deeper. The engine is a CHAIN, and it is verified:
//
//     enemy steps into the zone on THEIR turn
//       -> Drowned Grasp fires
//       -> Undercurrent fires and PULLS them a tile deeper
//       -> that displacement is itself an entry, so the next trap along fires too
//
// `Undercurrent` was a push before this pass, which threw intruders back OUT of the zone — the
// deck's own plan in reverse. As a pull it is the chain link, and `repellingTide` does the same job
// off an attack: shove the attacker, and the shove can set off something else.
//
// The proactive drags (Siren's Call, the leader's Undertow, the OnSummon haulers) therefore do NOT
// spring traps. They are SETUP: they park an enemy inside the zone so that the moment it moves on
// its own turn, the minefield answers — and they pull bodies off springs and out of formations on
// the way.
//
// ⚠ MINES CANNOT PARTICIPATE EITHER, so the payoff layer is ZONE traps only. A unit is never
// displaced onto an occupied tile and a set card occupies its own, so nothing can ever be shoved
// onto a mine. The old `whirlpoolMine` was structurally incapable of joining the plan and is gone.
//
// STATED WEAKNESSES (rules, not vibes):
//   · THE ENGINE BRINGS THE ENEMY TO YOUR DOORSTEP. Every pull ends nearer your own leader, and the
//     leader IS the life pool. This deck's combo is what puts it in danger — the risk loop the game
//     is built on, printed as a deck plan. `repellingTide` is in here as the panic button.
//   · `Anchored` IS A HARD COUNTER AND IT IS EVERYWHERE — Red Mark's front rank, Dragonspire's eggs,
//     this deck's own Brineguard. `displaceUnit` returns early on it and the drag simply fails.
//   · FIVE FACE-DOWN CARDS IS THE WHOLE MINEFIELD (`RULES.nonUnitCap`), and traps move one tile per
//     turn, so the kill zone is small, slow and static. You cannot take it with you.

import type { CardDef, LeaderDef } from '../../types';
import { dup, unitDc, type DeckDef } from './deckDef';

/** The shared stat rubric, so this deck's DEF is billed exactly like everyone else's. */
const body = (atk: number, def: number): number => unitDc(atk, def);

/**
 * Neris, the Undertow.
 *
 * ⚠ Her ability is the rebuild in one line: the same `Area3x3` shape as the old Maelstrom with the
 * sign flipped, turning 2.91 casts per game from anti-synergy into the engine. It drags FRIENDLIES
 * too — `Area3x3` resolves both sides — which is a real cost and deliberately not hidden.
 *
 * The passive replaces the old "+10 to Aqua on Sea", which was Wildgrowth's card. `NearLeader 2` is
 * exactly the reach of a zone trap set in her own ring, so the aura marks out the kill zone: the
 * deck fights where its traps are, and nowhere else.
 *
 * She keeps painting Sea as she walks. That is not a terrain engine any more — it is what makes the
 * ground the victims land on hostile, since Sea is the weak terrain of Dragon, Avian, Machine and
 * Inferno alike.
 */
export const NERIS_UNDERTOW: LeaderDef = {
  id: 'neris', name: 'Neris, the Undertow', type: 'Aqua', atk: 25,
  rules: [
    {
      trigger: 'Passive',
      effect: { e: 'AuraAtk', amount: 10 },
      target: { t: 'FriendlyOfTypes', types: ['Aqua'] },
      condition: { k: 'NearLeader', tiles: 2 },
    },
    { trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Sea' }, target: { t: 'TilesMovedThrough' } },
  ],
  ability: {
    id: 'undertowAbility', name: 'Undertow', cost: 6, located: true,
    effects: [{ effect: { e: 'Pull', tiles: 1 }, target: { t: 'Area3x3' } }],
  },
};

export const TIDECALLER_CARDS: Record<string, CardDef> = {
  // --- THE SHALLOWS. Cheap Aqua that make water and hold the ring. ---

  waveSkimmer: {
    kind: 'unit', id: 'waveSkimmer', name: 'Wave Skimmer', type: 'Aqua',
    level: 2, atk: 20, def: 10, dc: body(20, 10) + 1, // +1: the trail paint
    keywords: [],
    rules: [{ trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Sea' }, target: { t: 'TilesMovedThrough' } }],
  },
  pearlDiver: {
    kind: 'unit', id: 'pearlDiver', name: 'Pearl Diver', type: 'Aqua',
    level: 2, atk: 20, def: 10, dc: body(20, 10) + 1, // +1: OnCapture draw
    keywords: [],
    rules: [{ trigger: 'OnCapture', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
  tidePriest: {
    // Deliberately blank, and honestly priced at its floor this time — it is a fusion material and
    // a body, and the deck already has more text than it can afford.
    kind: 'unit', id: 'tidePriest', name: 'Tide Priest', type: 'Aqua',
    level: 3, atk: 25, def: 15, dc: body(25, 15),
    keywords: [], rules: [],
  },
  brineguardSentinel: {
    // THE ANCHOR. A deck about moving people should own exactly one thing that cannot be moved, and
    // it is the fixed point the drags orbit — the wall you pull them against.
    kind: 'unit', id: 'brineguardSentinel', name: 'Brineguard Sentinel', type: 'Aqua',
    // DEF 45 -> 40: the armour tier boundary sits at an excess of 30 over round(atk/2), so 45 cost
    // a second premium point per copy and 40 buys the same wall for less. The cap forced the cut.
    level: 3, atk: 30, def: 40, dc: body(30, 40) + 1, // +1: Anchored
    keywords: ['Anchored'], rules: [],
  },

  // --- THE DRAG. Every one of these brings something closer. ---

  mistcaller: {
    // FIRST USER OF `OnTrapTriggered` ANYWHERE IN THE GAME. The trigger has existed unused since the
    // 2026-08-04 vocabulary pass; a deck whose engine is springing its own traps is what it was for.
    // Scoped `friendly` so the opponent's traps pay nothing.
    kind: 'unit', id: 'mistcaller', name: 'Mistcaller', type: 'Aqua',
    level: 3, atk: 25, def: 15, dc: body(25, 15) + 1, // +1: the trap payoff
    keywords: [],
    rules: [{
      trigger: 'OnTrapTriggered',
      when: { scope: 'friendly' },
      effect: { e: 'Draw', n: 1 },
      target: { t: 'Self' },
    }],
  },
  riptideNaga: {
    kind: 'unit', id: 'riptideNaga', name: 'Riptide Naga', type: 'Aqua',
    level: 4, atk: 35, def: 20, dc: body(35, 20) + 1, // +1: OnSummon drag
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'Pull', tiles: 1 }, target: { t: 'ChosenEnemy' } }],
  },
  dragnetHarpooner: {
    // The workhorse drag, and the reason the deck can start the combo without a spell: it arrives
    // and hauls someone two tiles in, which on a seeded board is usually into a zone.
    kind: 'unit', id: 'dragnetHarpooner', name: 'Dragnet Harpooner', type: 'Aqua',
    level: 4, atk: 35, def: 20, dc: body(35, 20) + 1, // +1: OnSummon drag 2
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'Pull', tiles: 2 }, target: { t: 'ChosenEnemy' } }],
  },
  drownedColossus: {
    // Replaces Abyssal Tyrant, whose "+5 per Sea tile around it" was a stand-on-terrain scaler —
    // Wildgrowth's card. A lean 45/25 is only 2 DC because it wears no armour above the line.
    kind: 'unit', id: 'drownedColossus', name: 'Drowned Colossus', type: 'Aqua',
    level: 5, sp: 6, atk: 40, def: 25, dc: body(40, 25),
    keywords: [], rules: [],
  },
  krakenAvatar: {
    kind: 'unit', id: 'krakenAvatar', name: 'Kraken Avatar', type: 'Aqua',
    level: 6, sp: 8, atk: 50, def: 30, dc: body(50, 30) + 1, // +1: OnSummon drag 2
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'Pull', tiles: 2 }, target: { t: 'ChosenEnemy' } }],
  },

  // --- THE CALL. What the deck spends its turns on. ---

  sirensCall: {
    // THE SIGNATURE CARD. Two tiles toward you: out of a formation, off a spring, and into the zone.
    kind: 'spell', id: 'sirensCall', name: "Siren's Call", dc: 2, sp: 2, scope: 'global',
    effects: [{ effect: { e: 'Pull', tiles: 2 }, target: { t: 'ChosenEnemy' } }],
  },
  risingTide: {
    // Support now, not an engine: it makes the ground the victims land on hostile. Sea is the weak
    // terrain of Dragon, Avian, Machine and Inferno.
    kind: 'spell', id: 'risingTide', name: 'Rising Tide', dc: 2, sp: 1, scope: 'located',
    effects: [{ effect: { e: 'PaintTerrain', terrain: 'Sea' }, target: { t: 'Line3' } }],
  },
  scryTheDepths: {
    kind: 'spell', id: 'scryTheDepths', name: 'Scry the Depths', dc: 3, sp: 2, scope: 'global',
    effects: [{ effect: { e: 'Draw', n: 2 }, target: { t: 'Self' } }],
  },
  theTideTurns: {
    /**
     * "THE TIDE TURNS" — the water itself closes, everywhere at once.
     *
     * NEW 2026-08-16, and the first card in the game to use `AllUnitsOnTerrain`. That target has
     * existed since the vocabulary expansion, is documented in types.ts as "the kill-zone shape",
     * and had **zero users** — which is a strange gap in a game whose signature mechanic is
     * painting the ground. Every other terrain card in the pool BUILDS terrain; nothing had ever
     * cashed it in.
     *
     * This deck is where it belongs, because this deck already makes the Sea. Neris paints it as
     * she walks, Wave Skimmer paints it as it walks, and Rising Tide lays three tiles at a time —
     * the board fills with water over the course of a game and, until now, that water only meant
     * the chart's -10 to Dragon, Avian, Machine and Inferno. Now it is a fuse.
     *
     * ⚠ IT SNARES BOTH SIDES, INCLUDING YOUR OWN AQUA, AND THAT IS DELIBERATE. Neris's own ability
     * already drags friendlies (`Area3x3` resolves both sides — "a real cost and deliberately not
     * hidden"), and `AllUnitsOnTerrain` carries the same rule for the same reason: a painter who
     * stands in their own hazard should suffer it. It makes the card a timing decision rather than
     * a free button — you fire it when the water is THEIRS, which for an Aqua deck standing on its
     * own favored terrain is a genuinely hard ask.
     *
     * Snare rather than damage, for the reason Kelp Snare gives: a Snared body cannot walk out of
     * the minefield, and everything else in the deck is still dragging it deeper. It also dodges
     * the DAMAGE_FLOOR problem entirely — a status does not care how big the body is, which is why
     * it is the reliable half of this deck's kill zone.
     */
    kind: 'spell', id: 'theTideTurns', name: 'The Tide Turns', dc: 3, sp: 3, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'Snared', amount: 0, duration: { kind: 'turns', turnsLeft: 1 } },
      target: { t: 'AllUnitsOnTerrain', terrain: 'Sea' },
    }],
  },

  // --- THE KILL ZONE. All ZONE traps: a mine cannot be reached by a shove. ---

  undercurrent: {
    // Was a push, which threw intruders back OUT of the zone — the deck's own plan in reverse. Now
    // it drags them a tile DEEPER, and because that is itself a displacement it can spring the next
    // trap along. The undertow, on one card.
    kind: 'trap', id: 'undercurrent', name: 'Undercurrent', dc: 2, sp: 1, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{ effect: { e: 'Pull', tiles: 1 }, target: { t: 'TriggeringUnit' } }],
  },
  drownedGrasp: {
    // 20 -> 30 damage, DC 2 -> 3 / SP 1 -> 2 (2026-08-16, DAMAGE_FLOOR). The most-fired trap in the
    // pool and still only 5 kills in 63 hits — the undertow drags them in, and then nothing happened.
    kind: 'trap', id: 'drownedGrasp', name: 'Drowned Grasp', dc: 2, sp: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{ effect: { e: 'Damage', amount: 30 }, target: { t: 'TriggeringUnit' } }],
  },
  kelpSnare: {
    // Holds them IN the kill zone, which is worth more here than damage: a Snared body cannot walk
    // out of the minefield, and everything else in the deck is still dragging it deeper.
    kind: 'trap', id: 'kelpSnare', name: 'Kelp Snare', dc: 3, sp: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{
      effect: { e: 'ApplyStatus', status: 'Snared', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'TriggeringUnit' },
    }],
  },
  repellingTide: {
    // The panic button, and the honest answer to this deck's stated weakness: it spends the game
    // hauling enemies toward its own leader, so it needs one card that shoves back.
    // Must be `negate` — a respond-push would not stop the combat resolving.
    kind: 'trap', id: 'repellingTide', name: 'Repelling Tide', dc: 3, sp: 2, interrupt: 'negate',
    trigger: { t: 'enemyAttacksFriendly' },
    effects: [{ effect: { e: 'Push', tiles: 2 }, target: { t: 'Attacker' } }],
  },

  // --- FUSION. Both re-pointed by the 2026-08-08 fusion pass; see `fusion.test.ts` for the rubric. ---

  leviathan: {
    kind: 'unit', id: 'leviathan', name: 'Leviathan', type: 'Aqua',
    level: 5, atk: 70, def: 35, dc: body(70, 35), // level 5 = 2 Wave Skimmer + 3 Tide Priest
    keywords: [], rules: [],
    fusion: { materials: ['waveSkimmer', 'tidePriest'] },
  },
  deepmawHorror: {
    kind: 'unit', id: 'deepmawHorror', name: 'Deepmaw Horror', type: 'Aqua',
    level: 5, atk: 75, def: 60, dc: body(75, 60) + 1, // level 5 = 2 Pearl Diver + 3 Mistcaller; +1 Anchored
    keywords: ['Anchored'], rules: [],
    fusion: { materials: ['pearlDiver', 'mistcaller'] },
  },
};

export const TIDECALLER_DECK: DeckDef = {
  id: 'tidecaller',
  name: 'Tidecaller',
  leader: NERIS_UNDERTOW,
  cards: TIDECALLER_CARDS,
  list: [
    // The shallows.
    ...dup('waveSkimmer', 3), ...dup('pearlDiver', 3), ...dup('tidePriest', 2),
    ...dup('brineguardSentinel', 2),
    // The drag.
    ...dup('mistcaller', 2), ...dup('riptideNaga', 3), ...dup('dragnetHarpooner', 3),
    ...dup('drownedColossus', 2), ...dup('krakenAvatar', 2),
    // The call.
    ...dup('sirensCall', 3), ...dup('risingTide', 2), ...dup('scryTheDepths', 2),
    // The payoff for all that water. 2 copies, not 3 — it is a timing card and drawing two is
    // already redundant, and the third slot would have to come out of the kill zone.
    //
    // ⚠ REPRICED 2026-08-16, AFTER MEASURING. The first version paid for it with one Scry the
    // Depths and one Undercurrent, and the ladder said that was a bad trade: **-4.5pp on arena and
    // -4.7pp on gauntlet**, consistent on both boards and well outside the ±1.5pp noise floor. The
    // Tide Turns snares 2.25 bodies per cast, which does not cover a Draw 2 plus a trap. Both
    // copies are back.
    //
    // It is paid for instead by the two slots the measurements actually condemn:
    //   · one Drowned Grasp — a 30-damage single-target trap, and `DAMAGE_FLOOR` measured that
    //     whole tier killing only 12% of what it hits. Three other traps remain, so the kill zone
    //     still fields ten face-down cards against a five-card cap.
    //   · one Tide Priest — the deck's own comment calls it "deliberately blank... a fusion
    //     material and a body". Two copies keep the Leviathan recipe legal.
    ...dup('theTideTurns', 2),
    ...dup('undercurrent', 3), ...dup('drownedGrasp', 2), ...dup('kelpSnare', 2),
    ...dup('repellingTide', 2),
  ],
  fusionPool: ['leviathan', 'deepmawHorror'],
};

/**
 * ⚠ Kept only so `duneforged.ts`-style importers and the deck registry keep resolving the old
 * export name. Nothing outside this file reads it any more — Duneforged imports nothing from
 * Tidecaller, which made this the first rework with no frozen-block obligations at all.
 */
export const TIDECALLER_EXTRA_CARDS = TIDECALLER_CARDS;
