// Dragonspire — Vharos, the Spirekeeper. Dragon / Mountain. REBUILT 2026-08-09 (deck overhaul #7).
//
// ---------------------------------------------------------------------------
// Axis: OVERKILL — the ATK margin IS the damage.
// Verbs: hold · pin · overrun · spill.
// ---------------------------------------------------------------------------
//
//     Dragonspire pins you in place and then fields something far too big for you.
//
// ⚠ WHAT THIS DECK WAS: a CEILING PROBE, and it said so — "this deck exists to stress-test how the
// game copes with stronger units/effects", built around the first level-7 main-deck unit, the first
// DC-5 card and an 85-ATK fusion. At 78.9% and 1st of 9 the measurement came back: the game does
// not cope. That was a successful experiment, and it is over. This is the deck that replaces it.
//
// THE ENGINE WAS ALREADY OVERFLOW, AND NOTHING SAID SO. Measured against the field:
//
//     overflow LP dealt / game       131.2      gravemarch 89.8 · tidecaller 104.4 · ironhold 52.6
//     per kill                        23.9      18.9 · 16.9 · 15.3
//     biggest single hit                75      of a 180 LP pool
//
// It deals 179.6 LP a game and 73% of that is overflow. `overflow = aTot - dEff` is a pure
// ATK-margin rule, so "my body is much bigger than yours" IS the clock. The old header described
// the SETUP ("ramp SP with eggs and tithes") and never named the PAYOFF.
//
// ⚠ AND THE RAMP HALF WAS A FICTION. SP does not accumulate — the turn-start line is
// `ps.sp = spMax(ps.turnCount)`, a REFRESH — so the allowance is 4, then 7, then 8 forever from
// turn 3, and **51.7% of all SP granted across the meta is thrown away unspent**. Ember Egg's
// OnDeath +2 SP and Drakonic Tithe's +2 SP paid into a pile that was already half wasted and could
// not be carried forward; the Tithe was cast 0.31 times a game. Both are CUT.
//
// ⚠ CORRECTION, 2026-08-09: the first draft of this comment said "SP is not a resource" and cited
// banked SP of 7.7-7.8 at turn start. That number was near-tautological — sampling SP immediately
// after the refresh just measures `spMax` back. SP genuinely DOES ration what you do within a turn
// (26.9% of turns end at zero, 49.6% end holding something unaffordable). What it does not do is
// gate the top end across turns, or let you SAVE. That is the narrower, true reason ramp fails.
//
// ⚠ THE LEVER IS "RAISE MINE", NOT "LOWER THEIRS" — and that boundary is deliberate. The obvious
// way to widen an ATK margin is to debuff the defender, and under overflow every point removed is a
// point of face damage. That is a real and strong design... and it is BLIGHTSHOT's, parked in the
// blueprint queue as "stat degradation; converts debuffs into a clock via combat overflow". Two
// decks cannot own one axis (blueprint rule 1). So Dragonspire and Blightshot share the payoff rule
// and split the lever: Dragonspire is CONCENTRATION (few bodies, far above curve), Blightshot is
// DEGRADATION. Keep it that way when Blightshot gets built.
//
// THE PLAY PATTERN, which the deck did not have before: PIN, THEN OVERRUN. The 2026-08-09 Guard
// re-spec turned the keyword into a pin — enemies beside a Guard may not walk away, only shuffle
// along it or swing at it. That is the missing half of an overkill deck: a body that is bigger than
// yours only cashes in if you cannot decline the fight. So the deck splits by cost —
//
//     the cheap half HOLDS   (Cinder Whelp, Ashwarden Drake, Roost Warden — all Guard)
//     the dear half OVERRUNS (Craghide, Magma Wyrm, Sky Sovereign)
//
// — and the signature line is: pin a body with a 2 SP whelp, walk the apex over, and take a
// quarter of their life pool off the exchange.
//
// ⚠ CALIBRATE THAT CLAIM, because the measurement is well short of the fiction. With NINE Guard
// bodies the deck holds **1.13 enemy unit-turns per game** at greedy and **1.38 at Expert** — so
// depth does not rescue it, and pin-then-overrun is a texture rather than the play pattern. The
// reason is structural: a pin only costs the victim something if it WANTED to leave, and two bots
// marching at each other rarely do. Guard reads as a real rule in a human's hands (you cannot
// disengage) in a way the bots cannot currently express, so this one is PARKED ON HUMAN PLAYTEST.
// Do not raise `pinnedAtk` to force the number up — that tunes the bot to like a mechanic rather
// than making the mechanic good.
//
// ⚠ AND THE FUSION IS STILL DEAD: 0.00 per game at BOTH tiers even after re-pointing its materials
// onto two cheap bodies the deck actually keeps out. Third attempt, third null. It is left in as a
// 3 DC trophy rather than fixed a fourth time; if it matters, cut it.
//
// PIERCING, at last — though under-dosed. One card fires **0.16 tramples per game** while 1.59 of
// the deck's own kills are still blanked by a brace, so it answers roughly a tenth of the problem.
// One body in forty is a statement of intent, not a solution; the next pass should widen it.
// ⚠ Measured across all 72 ordered matchups, 35.4% of every kill in the game
// produces ZERO LP: the defender braced, and defense stance deletes overflow outright. Piercing is
// the only thing that tramples a wall, the DC rubric prices it, the combat table names it — and
// Piercing tramples meta-wide were 0, because all four Piercing cards in the repo live in
// `piercer.ts`, a probe deck. Magma Wyrm carries it here: the deck whose whole output is overflow
// is the right home for the keyword that stops overflow being switched off.
//
// STATED WEAKNESSES (rules, not vibes):
//   · Overflow pays only when you kill something SMALLER. A mirror-size board gives you nothing.
//   · It is SYMMETRIC. Swing into something bigger and the margin comes off YOUR pool — the apex
//     is a liability the moment it is mis-swung.
//   · FEW BODIES. It fields the fewest on board of any deck measured (2.27), so every removal spell
//     is a blowout, and flanking (+5/ally, max +10) lets three cheap bodies out-punch one dear one.
//   · Its own chaff FEEDS the enemy clock: a 20-ATK whelp dying to a 50-ATK body is 30 LP off your
//     own pool. The cheap half is priced in DEF and Guard precisely because it must not be free food.
//
// RESULT: **78.9% -> 69.7%**, 1st to joint-2nd of 9. Overflow LP 131.2 -> 109.8/game; the dead
// leader active went 0.03 -> 3.41 casts/game and is now the deck's most-used effect.
//
// THE NERF BUDGET. Target was ~70% (still top-3), from 78.9%. Vharos's passive was the +20 terrain
// DOUBLE-DIP — Dragon is favored on Mountain, so his "+10 to Dragons on Mountain" stacked with the
// chart's own +10 — and removing it outright measured 78.9% -> 65.6% (-13.3pp), which is the budget
// that pays for Guard, Piercing and a live fusion. It is now a flat +5 gated on `LevelAtLeast 5`:
// smaller, terrain-free, and it states the axis. (⚠ Oskar/Duneforged still double-dips — see the
// vault's Open Threads. The ruling is unmade and must land on both leaders at once.)
//
// `LevelAtLeast` had ZERO uses anywhere in the game before this deck. It is the literal go-tall
// condition and it was sitting unmined.

import type { CardDef, LeaderDef } from '../../types';
import { dup, unitDc, type DeckDef } from './deckDef';

const body = (atk: number, def: number, piercing = false): number => unitDc(atk, def, piercing);

/** Deliberately HIGH leader ATK — the stat-leader pole: Vharos personally eats chump attackers. */
export const VHAROS: LeaderDef = {
  id: 'vharos', name: 'Vharos, the Spirekeeper', type: 'Dragon', atk: 30,
  rules: [
    // ⚠ WAS THE +20 DOUBLE-DIP: `AuraAtk +10 -> FriendlyOfTypesOnTerrain Dragon/Mountain`, which
    // stacked with the terrain chart's own +10 for Dragon-on-Mountain. Now flat, terrain-free, and
    // gated on the deck's own axis — the Spirekeeper's regard falls only on the great.
    {
      trigger: 'Passive',
      effect: { e: 'AuraAtk', amount: 5 },
      target: { t: 'FriendlyOfTypes', types: ['Dragon'] },
      condition: { k: 'LevelAtLeast', amount: 5 },
    },
    { trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Mountain' }, target: { t: 'TilesMovedThrough' } },
  ],
  /**
   * ⚠ REPLACES `Cataclysm Breath` (7 SP, Damage 20 in a 3x3), which fired **0.03 times per game at
   * greedy and 0.00 at Expert**. At 7 SP against an 8 cap it consumed a whole turn's income, so the
   * bot never found a board worth it — a leader active that never activates.
   *
   * This is the deck's own verb instead: widen the margin on the swing you were already making.
   * +20 ATK on a body that kills something smaller is +20 LP off their pool, directly. Priced at 5
   * so it fits beside a cheap summon but not beside an apex.
   */
  ability: {
    id: 'spirekeepersFury', name: "Spirekeeper's Fury", cost: 5, located: true,
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 20, duration: { kind: 'endOfTurn' } },
      target: { t: 'ChosenFriendly' },
    }],
  },
};

export const DRAGONSPIRE_CARDS: Record<string, CardDef> = {
  // --- THE CHEAP HALF: it HOLDS. Every body here carries Guard, so the deck's low curve buys
  // board control rather than chaff — which matters twice over, because under overflow a cheap
  // body that simply dies is a gift to the opponent's clock. ---

  cinderWhelp: {
    // Replaces Ember Egg, whose OnDeath +2 SP paid into an account that is full every turn. Same
    // job (a turn-one body) with a reason to exist: 20 DEF and a pin. It is the combo piece —
    // 2 SP holds something still, and the apex arrives next turn.
    kind: 'unit', id: 'cinderWhelp', name: 'Cinder Whelp', type: 'Dragon',
    level: 2, atk: 20, def: 20, dc: body(20, 20) + 1, // +1: Guard
    keywords: ['Guard'], rules: [],
  },
  cragWyrmling: {
    // The one genuinely plain body, and a fusion material. Kept vanilla on purpose: not every card
    // in a deck should speak.
    kind: 'unit', id: 'cragWyrmling', name: 'Crag Wyrmling', type: 'Dragon',
    level: 2, atk: 20, def: 10, dc: body(20, 10),
    keywords: [], rules: [],
  },
  ashwardenDrake: {
    // Replaces Drakonic Tithe (0.31 casts/game, a cantrip that netted the evaluator ~zero). The
    // mid-curve pinner: this is the body that actually sets up the signature line, because it can
    // hold something worth killing.
    kind: 'unit', id: 'ashwardenDrake', name: 'Ashwarden Drake', type: 'Dragon',
    level: 3, atk: 30, def: 20, dc: body(30, 20) + 1, // +1: Guard
    keywords: ['Guard'], rules: [],
  },
  roostWarden: {
    // Anchored AND Guard: it cannot be dragged off its tile, and you cannot walk around it. The two
    // keywords are the same sentence from opposite sides, which is why this body is the anchor of
    // the holding half.
    kind: 'unit', id: 'roostWarden', name: 'Roost Warden', type: 'Terra',
    level: 3, atk: 30, def: 25, dc: body(30, 25) + 2, // +1 Anchored, +1 Guard
    keywords: ['Anchored', 'Guard'], rules: [],
  },
  thermalRider: {
    // The one mobility card, and it is here for the combo: something has to CLOSE on the body the
    // whelps pinned. Avian rather than Dragon, so it also rides Mountain for the movement bonus.
    kind: 'unit', id: 'thermalRider', name: 'Thermal Rider', type: 'Avian',
    level: 2, atk: 20, def: 10, dc: body(20, 10) + 1, // +1: OnSummon GrantMove
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'Self' } }],
  },

  // --- THE DEAR HALF: it OVERRUNS. These are the bodies the margin comes from. ---

  stormDrake: {
    kind: 'unit', id: 'stormDrake', name: 'Storm Drake', type: 'Dragon',
    level: 4, atk: 35, def: 15, dc: body(35, 15) + 1, // +1: OnSummon burn
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'Damage', amount: 10 }, target: { t: 'AdjacentEnemies' } }],
  },
  craghideDragon: {
    kind: 'unit', id: 'craghideDragon', name: 'Craghide Dragon', type: 'Dragon',
    level: 5, sp: 7, atk: 45, def: 25, dc: body(45, 25),
    keywords: [], rules: [],
  },
  magmaWyrm: {
    // ⚠ THE PIERCING CARD, and the first in any registered deck. Across all 72 ordered matchups
    // 35.4% of kills produce zero LP because the defender braced — this is the deck's answer to
    // having its entire output switched off by a stance. Its old StartOfTurn adjacent burn is gone:
    // Piercing IS the text now, and one line per card is the rule.
    //
    // ⚠ 50 -> 45 ATK: the deck came in at 112 against the 110 cap and the keyword is what it is
    // paying for. Dropping under the rubric's 50-ATK tier is worth 3 DC across the playset, which
    // is exactly the cut needed — the cap forcing a real choice, which is the point of having one.
    kind: 'unit', id: 'magmaWyrm', name: 'Magma Wyrm', type: 'Dragon',
    level: 6, sp: 8, atk: 45, def: 20, dc: body(45, 20, true),
    keywords: ['Piercing'], rules: [],
  },
  skySovereign: {
    // The top of the curve. Ranged at range 1 — which is deliberately NOT dead text here the way
    // it was in Skyfire, because `retaliation requires reach` means a melee body it shoots still
    // answers it; what Ranged buys is the option to strike without moving into contact.
    kind: 'unit', id: 'skySovereign', name: 'Sky Sovereign', type: 'Dragon',
    level: 7, sp: 8, atk: 60, def: 20, dc: body(60, 20) + 1, // +1: Ranged
    keywords: ['Ranged'], rules: [],
  },

  // --- SUPPORT. Four cards, and every one of them serves the margin. ---

  wyrmsHoard: {
    /**
     * ⚠ THE RAMP THAT ACTUALLY WORKS. Drakonic Tithe gave +2 SP and drew a card, and it was cast
     * 0.31 times a game because SP is not a resource here — it refills to `spMax` every turn and
     * sits at 7.7-7.8 of 8 for every deck in the game. What Dragonspire is genuinely starved of is
     * CARDS: it fields the fewest bodies on board of any deck, and with SP free the only thing
     * gating an apex is having drawn one. So the SP half is gone and the draw half is the card.
     *
     * It also replaces Raise the Spires (Mountain, Line3), which lost most of its point when
     * Vharos's passive stopped being terrain-shaped — Mountain is now just the chart's +10 and a
     * movement tile, and he paints it on the move anyway.
     */
    kind: 'spell', id: 'wyrmsHoard', name: "Wyrm's Hoard", dc: 2, sp: 1, scope: 'global',
    effects: [{ effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
  dragonfire: {
    // The deck's most-cast card by a distance (1.69/game). Removal that clears a flanker off the
    // apex, which is the deck's actual failure mode.
    kind: 'spell', id: 'dragonfire', name: 'Dragonfire', dc: 3, sp: 4, scope: 'global',
    effects: [{ effect: { e: 'Damage', amount: 25 }, target: { t: 'ChosenEnemy' } }],
  },
  elderAwakening: {
    kind: 'spell', id: 'elderAwakening', name: 'Elder Awakening', dc: 4, sp: 5, scope: 'located', ascension: true,
    effects: [{ effect: { e: 'Transform', atk: 65, addKeywords: ['Ranged'] }, target: { t: 'ChosenUnit' } }],
  },
  scorchingScales: {
    // Kept over Scale Ward: punishing an attacker is on-axis for a deck whose bodies want to be
    // attacked into, and it is the only protection the few-bodies half gets.
    // 20 -> 30 damage, DC 2 -> 3 / SP 1 -> 2 (2026-08-16, DAMAGE_FLOOR). The punish only lands if
    // it kills, and 20 killed the attacker once in 5 hits.
    kind: 'trap', id: 'scorchingScales', name: 'Scorching Scales', dc: 2, sp: 2, interrupt: 'respond',
    trigger: { t: 'enemyAttacksFriendly' },
    effects: [{ effect: { e: 'Damage', amount: 30 }, target: { t: 'Attacker' } }],
  },
  scaleWard: {
    kind: 'trap', id: 'scaleWard', name: 'Scale Ward', dc: 3, sp: 2, interrupt: 'negate',
    trigger: { t: 'enemyActivatesSpell' },
    effects: [{ effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },

  cataclysmDragon: {
    // ⚠ WAS THE DEAD TROPHY. At 85 ATK it was "the biggest body in the game" and it fused **0.00
    // times per game at BOTH greedy and Expert** — and Expert is where fusion was proven to work
    // (0.58/game game-wide after the 2026-08-08 action-inheritance fix), so this was not the old
    // fusion bug. Its materials were Crag Wyrmling + Storm Drake, two cards that rarely stand
    // adjacent in a deck fielding 2.3 bodies.
    //
    // Re-pointed onto two CHEAP bodies the deck actually keeps on the board, and cut 85 -> 70
    // because this pass is a nerf and the ceiling probe is finished. Level 5 = 2 (Wyrmling) +
    // 3 (Ashwarden); 70 clears the materials+15 floor `fusion.test.ts` enforces (20+30+15 = 65).
    //
    // ⚠ It eats a GUARD body, and that is the tension worth having: the fusion costs you a pin to
    // buy an apex, which is the deck's two halves trading against each other.
    kind: 'unit', id: 'cataclysmDragon', name: 'Cataclysm Dragon', type: 'Dragon',
    level: 5, atk: 70, def: 30, dc: body(70, 30),
    keywords: [], rules: [],
    fusion: { materials: ['cragWyrmling', 'ashwardenDrake'] },
  },
};

export const DRAGONSPIRE_DECK: DeckDef = {
  id: 'dragonspire',
  name: 'Dragonspire',
  leader: VHAROS,
  cards: DRAGONSPIRE_CARDS,
  list: [
    // The holding half — nine Guard bodies, which is what makes the pin a subsystem and not a
    // single card the opponent can play around.
    ...dup('cinderWhelp', 3), ...dup('ashwardenDrake', 3), ...dup('roostWarden', 3),
    ...dup('cragWyrmling', 3), ...dup('thermalRider', 3),
    // The overrunning half.
    ...dup('stormDrake', 3), ...dup('craghideDragon', 3), ...dup('magmaWyrm', 3),
    ...dup('skySovereign', 2),
    // Support.
    ...dup('wyrmsHoard', 3), ...dup('dragonfire', 3), ...dup('elderAwakening', 2),
    ...dup('scorchingScales', 3), ...dup('scaleWard', 3),
  ],
  fusionPool: ['cataclysmDragon'],
};
