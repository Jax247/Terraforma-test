// Gravemarch — Ossuary Vessik, the Grave-Chandler. Undead / Insect. REBUILT 2026-08-08 (overhaul #4).
//
// ---------------------------------------------------------------------------
// Axis: RECURSION — the graveyard is a resource you SPEND and REFILL.
// Verbs: feed · bury · raise · swell.
// ---------------------------------------------------------------------------
//
// TWO TRIBES, TWO JOBS. This is the deck's whole shape, and the reason it stays two-typed where
// Skyfire had to unify:
//
//   INSECT  cheap real bodies that die eagerly and pay on the way out — the `feed`.
//           They enter the graveyard and are NEVER raised. They are spent.
//   UNDEAD  bodies worth returning, priced to be raised again and again — the `raise`.
//
// TWO PILES, TWO PAYOFFS — the thing only this deck can do. `TypeInOwnGraveyard` takes a type, so
// the split tribe is a mechanical asset rather than the dilution it looks like:
//   · `TypeInOwnGraveyard('Undead')` is the RAISE POOL. The `swell` scalers read it, so they
//     measure "how much army have I banked".
//   · `TypeInOwnGraveyard('Insect')` is SPENT CHAFF, gone for good. A separate payoff reads it, so
//     the fodder is never wasted even though it can never come back.
//
// ⚠ WHY THERE ARE NO HUSK TOKENS ANY MORE. The old build spawned Husks off Duneshambler,
// Gravewaker and Swarm Mother. Tokens VANISH and never enter the graveyard (locked vault rule), so
// token generation is off-thesis for a deck whose entire currency is the pile — and it was the
// overlap with Hivebrood. Replacing tokens with real Insect bodies sharpens the contrast to one
// line, which is blueprint rule 1 satisfied rather than hand-waved:
//
//     HIVEBROOD eats TOKENS      -> gone forever, converted to permanent counters. It COMPOUNDS.
//     GRAVEMARCH eats REAL CARDS -> they land in the grave, get counted, and if Undead they return.
//                                   It RECURS.
//
// Visible on the board: a Hivebrood board is fewer, angrier bodies; a Gravemarch board looks
// ordinary next to a graveyard counter that will not stop climbing.
//
// WHY EVERY PAYOFF IS `OnDeath` AND NEVER `OnSummon`. Raises deliberately skip OnSummon (engine.ts,
// so recursion decks cannot double-dip), which means a raised body arrives as a bare statline. That
// inverts into the deck's core trick: **a body whose value is on OnDeath pays every time it dies.**
// Die, raise, die again. Marrow Hound (OnDeath: draw) was always the prototype; now the deck is
// built out of them.
//
// WHY THE OLD BUILD DID NOT WORK, measured rather than guessed. `npm run diagnose -- gravemarch`
// and a bespoke probe over 32 games found ATK/DC 6.55 against a field of 7.54 — worst in the pool —
// and that Raise was unavailable because the GRAVEYARD WAS EMPTY on 73.7% of turns. Not the summon
// ring (3.2%), not the unit cap (1.9%). The deck called itself a recursion deck and never filled
// its own pile. Everything here follows from that one number.
//
// Cut for the same reason: `raiseTheFallen` x3 (9 DC, bound-legal 4.2% of turns, cast 0.03/game —
// a strictly worse copy of the leader's ability that ALSO has to be drawn), and one of the two
// fusion cards (fusion fires 0.00/game across all 72 ordered deck matchups — dead game-wide, so one
// is the most any deck should carry).
//
// STATED WEAKNESSES (rules, not vibes):
//   · THE VOID ANSWERS IT. Banishment is the designed counter to a graveyard engine, and the pile
//     is PUBLIC — the opponent sees exactly what is being banked before it comes back.
//   · IT IS SLOW TO START. With an empty grave the deck has no engine at all, which is precisely
//     when Skyfire and Dragonspire are getting their damage in.
//   · THE UNIT CAP BOUNDS THE PAYOFF. A raise needs a free slot and a free summon-zone tile, so the
//     deck can flood the board or recur, never both at once.
//
// ⚠ WHY THERE IS NO DELIBERATE SACRIFICE OUTLET, though `ChosenFriendly` was added for one. The
// first build printed "Cart the Dead" — destroy a friendly, draw, gain SP. It was cast **0.00 times
// per game**: the evaluator prices a lost body at roughly unitAtk x ATK + unitLevel x level (a
// 25-ATK 2-drop is ~53 points), and no realistic card payoff outweighs that, so a bot never
// sacrifices. Rather than ship 9 DC of a card that never fires — the exact defect this rebuild
// exists to remove — the `bury` verb is carried by COMBAT: the Insects trade themselves in, which
// the bot does 9x per game unprompted. `ChosenFriendly` stays because it is a general primitive and
// because it fixes a real bug in Hivebrood's Feed the Hive (see that file).

import type { CardDef, LeaderDef } from '../../types';
import { GRAVEMARCH_CARDS } from '../poc';
import { armour, dup, priceSpell, priceUnit, unitDc, type DeckDef } from './deckDef';

/** The shared stat rubric, so this deck's DEF is billed exactly like everyone else's. */
const body = (atk: number, def: number): number => unitDc(atk, def);

/**
 * ⚠ FROZEN SHARED BLOCK — ten defs that are NOT part of the rebuilt deck and must not change.
 *
 * `duneforged.ts` imports this record and fields every one of them; it is composed ENTIRELY of
 * other decks' cards, which is exactly why it is last in the overhaul. Repricing or retyping
 * anything here would silently rewrite a deck this pass is not about. (`scorchMine` and `OSKAR`
 * live in poc.ts, which is untouchable for a further reason: it is the default P2 fixture for
 * roughly ten test files.)
 *
 * Same carve-out, same reasoning, as `venomSpitter` in hivebrood.ts. The rebuilt deck's own bodies
 * all take NEW ids, and the two lists share nothing.
 *
 * ⚠ "FROZEN" MEANS THE EXISTING DEFS DO NOT MOVE — it does not mean the record is closed. This IS
 * Duneforged's card registry, so a card written FOR Duneforged has to be added here or the deck
 * cannot field it (`deckCost` reads `deck.cards[id]?.dc ?? 0`, so a missing def costs 0 DC and the
 * deck silently under-prices instead of failing). `theDebtCalled` was added 2026-08-16 for exactly
 * that reason. Adding is safe; editing anything above is not.
 */
export const GRAVEMARCH_EXTRA_CARDS: Record<string, CardDef> = {
  raiseTheFallen: priceSpell(GRAVEMARCH_CARDS.raiseTheFallen!, 3),
  graveTyrant: armour(priceUnit(GRAVEMARCH_CARDS.graveTyrant!, 8), 30),
  carrionSwarm: armour(GRAVEMARCH_CARDS.carrionSwarm!, 5),
  duneshambler: armour(GRAVEMARCH_CARDS.duneshambler!, 15),
  sandRevenant: armour(GRAVEMARCH_CARDS.sandRevenant!, 20),
  dreadColossus: armour(GRAVEMARCH_CARDS.dreadColossus!, 40),
  marrowHound: {
    kind: 'unit', id: 'marrowHound', name: 'Marrow Hound', type: 'Undead', level: 2, atk: 20, def: 10, dc: 2,
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
  plagueBearer: {
    kind: 'unit', id: 'plagueBearer', name: 'Plague Bearer', type: 'Insect', level: 3, atk: 25, def: 15, dc: 2,
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'Damage', amount: 10 }, target: { t: 'AdjacentEnemies' } }],
  },
  bonewroughtGolem: {
    kind: 'unit', id: 'bonewroughtGolem', name: 'Bonewrought Golem', type: 'Undead', level: 5, sp: 7, atk: 45, def: 35, dc: 1,
    keywords: [], rules: [],
  },
  corpseTithe: {
    kind: 'spell', id: 'corpseTithe', name: 'Corpse Tithe', dc: 3, sp: 1, scope: 'global',
    effects: [
      { effect: { e: 'GainSP', n: 2 }, target: { t: 'Self' } },
      { effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
    ],
  },
  suddenInterment: {
    // 20 -> 30 damage, DC 2 -> 3 / SP 1 -> 2 (2026-08-16, DAMAGE_FLOOR). Defined here but fielded
    // only by Duneforged, so the cost lands on that deck's budget, not Gravemarch's.
    kind: 'trap', id: 'suddenInterment', name: 'Sudden Interment', dc: 2, sp: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{ effect: { e: 'Damage', amount: 30 }, target: { t: 'TriggeringUnit' } }],
  },
  plagueTitan: {
    // ⚠ The one frozen-block card this fusion pass touches. Its RECIPE already paid for itself
    // (70 ATK from 40) — only the level was wrong, and level moves neither DC nor card text, so
    // Duneforged's composition and budget are unchanged. It just stops being scored as a token.
    kind: 'unit', id: 'plagueTitan', name: 'Plague Titan', type: 'Insect',
    level: 5, atk: 70, def: 25, dc: 3, // level 5 = 2 Carrion Swarm + 3 Plague Bearer
    keywords: ['Frenzy'], rules: [],
    fusion: { materials: ['carrionSwarm', 'plagueBearer'] },
  },
  theDebtCalled: {
    /**
     * "THE DEBT CALLED" — the pile finally weighs something on its own.
     *
     * NEW 2026-08-16, and the first card in the game to use `GraveyardCountAtLeast`. The condition
     * has existed since the 2026-08-05 expansion and had zero users, which is odd in a pool that
     * contains an entire recursion archetype: this deck's graveyard was a RESOURCE (Call the Roll
     * fetches from it, Gather raises out of it) but never a THRESHOLD. Nothing said "once enough of
     * you have died, something changes" — the yard could only be spent, never counted.
     *
     * That distinction is the deck's own stated axis. Its header draws the line against Gravemarch's
     * neighbour precisely: "Gravemarch RECURS, this deck COMPOUNDS". Spending is recursion. A card
     * that gets better the longer the game goes, without consuming anything, is the other half —
     * and it is the half this deck was missing, because every one of its payoffs emptied the yard
     * it depends on.
     *
     * ⚠ CASTER-SIDE, LIKE ALL THE COUNTING CONDITIONS. `conditionHolds` reads
     * `GraveyardCountAtLeast` off `ctx.owner`, not the subject, so this gates the whole card on YOUR
     * pile rather than filtering targets — and it has to ride `ApplyStatus`, one of the six effects
     * `execLine` actually consults a condition on.
     *
     * ⚠ THE THRESHOLD WAS 6 AND THAT WAS UNREACHABLE — the card resolved **0 times in 648 games**.
     * The number was reasoned from the deck list ("eleven Undead bodies, and it trades constantly")
     * rather than measured, which is the exact mistake wildgrowth.ts warns about in capitals:
     * conditions need their uptime measured, not assumed. Measured, over 72 games each:
     *
     *                              peak Undead in the pile      games ever reaching 6
     *     duneforged (fields it)   mean 1.1  median 1  max 4            0%
     *     gravemarch (the actual
     *       recursion deck)        mean 2.1  median 2  max 6            1%
     *
     * A 14-round game simply does not bury six of one type. ⚠ `GraveyardCountAtLeast` is therefore
     * a NEAR-DEAD CONDITION above about 2 anywhere in this pool — do not design another card around
     * a big number here without re-measuring first.
     *
     * THE FIX IS STRUCTURAL, NOT A SMALLER NUMBER. A single gated line makes the whole card a blank
     * until the gate opens, and a one-ply bot correctly never casts a blank — so the card was
     * unmeasurable as well as bad. It is now TWO lines: the first always resolves, the second is the
     * threshold payoff at a count the deck actually reaches (2, in 28% of its games). The card is
     * never a dead draw, it is simply better later, and because the floor always does something the
     * bot casts it and the probe can see it.
     *
     * The two `AtkMod` statuses STACK — `effectiveAtk` sums every AtkMod a unit carries — so the
     * online version is -10 with the back half lingering two turns.
     *
     * ⚠ DEFINED HERE, FIELDED ONLY BY DUNEFORGED — the same arrangement as `suddenInterment` above.
     * Gravemarch is the natural home for Undead-counting text but is currently the STRONGEST deck
     * in the pool (75.3% on arena), and Duneforged is second-worst (39.7% arena, 27.5% gauntlet)
     * while running eleven Undead bodies and 17 DC of unspent budget. The card goes where the
     * grind actually needs help. ⚠ Adding it to Gravemarch's own list is a balance change, not a
     * bookkeeping one — do not do it casually.
     */
    kind: 'spell', id: 'theDebtCalled', name: 'The Debt Called', dc: 3, sp: 2, scope: 'global',
    effects: [
      // The floor: always resolves, so the card is never a dead draw.
      {
        effect: { e: 'ApplyStatus', status: 'AtkMod', amount: -5, duration: { kind: 'endOfTurn' } },
        target: { t: 'AllEnemies' },
      },
      // The payoff: the pile speaks. Stacks with the line above, and lingers.
      {
        effect: { e: 'ApplyStatus', status: 'AtkMod', amount: -5, duration: { kind: 'turns', turnsLeft: 2 } },
        target: { t: 'AllEnemies' },
        condition: { k: 'GraveyardCountAtLeast', type: 'Undead', count: 2 },
      },
    ],
  },
};

/**
 * Ossuary Vessik, the Grave-Chandler — a NEW leader, not a reforged Oskar.
 *
 * ⚠ The new id is load-bearing, not flavour: Duneforged's leader is poc.ts's `OSKAR` (`id: 'oskar'`),
 * and `storage.ts` resolves leaders by id across `DECKS`, so two registered decks sharing 'oskar'
 * would be ambiguous. Skyfire could safely keep `'kaelen'` because nothing else claimed it.
 *
 * The passive is the deck thesis on the leader: the army you have BURIED makes the army you have
 * left hit harder, so spending a body is never pure cost. It reads the Undead pile — the same pile
 * the ability draws from — which is what ties the two halves of the card together.
 *
 * `Gather the Dead` is the engine, and it is the one thing the old build already did right: Oskar's
 * Raise fired 1.97x/game where the SPELL version fired 0.03x. It now CHOOSES which body returns,
 * thanks to the 2026-08-08 card-choice pass.
 *
 * ⚠ 6 SP, NOT Oskar's 5 — the vault's Open Threads has carried "Raise (5 SP) may be too cheap
 * (dodges card cost + affordable -> Undead too resilient; 6 is the lever)" since Simulation 5, and
 * this is the first build where that lever was actually needed. At 5 the rebuilt deck measured
 * 83.6% and beat Ironhold 40-0.
 */
export const VESSIK: LeaderDef = {
  id: 'vessik', name: 'Ossuary Vessik, the Grave-Chandler', type: 'Undead', atk: 25,
  rules: [
    {
      trigger: 'Passive',
      effect: { e: 'AuraAtkPerCount', amount: 1, count: { c: 'TypeInOwnGraveyard', type: 'Undead' } },
      target: { t: 'FriendlyOfTypes', types: ['Undead', 'Insect'] },
    },
  ],
  ability: {
    id: 'gatherTheDead', name: 'Gather the Dead', cost: 6, located: true,
    effects: [{ effect: { e: 'RaiseFromGraveyard', type: 'Undead' }, target: { t: 'ChosenUnit' } }],
  },
};

export const GRAVEMARCH_DECK_CARDS: Record<string, CardDef> = {
  // --- THE FEED. Insects: cheap, eager to die, and they pay on the way out. None of them is ever
  // coming back, which is the point — they are the fuel, not the engine. ---

  chitinChorister: {
    // The cheapest trade in the deck, and it draws when it dies. A body whose whole job is to be
    // exchanged should replace itself, or the deck's "keep trading" plan runs out of cards.
    kind: 'unit', id: 'chitinChorister', name: 'Chitin Chorister', type: 'Insect',
    level: 1, atk: 15, def: 10, dc: body(15, 10) + 1, // +1: OnDeath draw
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
  rotmawSwarm: {
    // Frenzy on chaff: the fodder wants to arrive in a clump, which is also how it trades fastest.
    kind: 'unit', id: 'rotmawSwarm', name: 'Rotmaw Swarm', type: 'Insect',
    level: 2, atk: 20, def: 10, dc: body(20, 10) + 1, // +1: Frenzy
    keywords: ['Frenzy'], rules: [],
  },
  gravelingBrood: {
    // Dies into a real SP refund rather than a token. That single word — real, not token — is the
    // whole difference between this deck and Hivebrood, and it is printed here on the cheapest slot.
    kind: 'unit', id: 'gravelingBrood', name: 'Graveling Brood', type: 'Insect',
    level: 2, atk: 20, def: 10, dc: body(20, 10) + 1, // +1: OnDeath ramp
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' } }],
  },
  charnelHost: {
    // THE SECOND PILE, made to pay. Insects can never be raised, so without this the chaff would be
    // spent for nothing but tempo; here every corpse in the vermin pile is standing ATK.
    kind: 'unit', id: 'charnelHost', name: 'Charnel Host', type: 'Insect',
    level: 4, atk: 30, def: 15, dc: body(30, 15) + 1, // +1: the Insect-pile scaler
    keywords: [],
    rules: [{
      trigger: 'Passive',
      effect: { e: 'AuraAtkPerCount', amount: 2, count: { c: 'TypeInOwnGraveyard', type: 'Insect' } },
      target: { t: 'Self' },
    }],
  },

  // --- THE MARCH. Undead: every one of these is a raise target, so every one is priced to come
  // back. Their value is on DEATH, because a raise skips OnSummon entirely. ---

  bonewrightThrall: {
    // The workhorse raise target, and DELIBERATELY BLANK. Two rebuild rounds proved the deck did
    // not need a rider here: at OnDeath-draw it measured 81.1%, and swapping that for OnDeath-SP
    // pushed it to 83.6% — the refund-on-death engine was the problem, not the card economy. Being
    // a cheap body the leader can Gather back is the whole card.
    kind: 'unit', id: 'bonewrightThrall', name: 'Bonewright Thrall', type: 'Undead',
    level: 2, atk: 20, def: 10, dc: body(20, 10),
    keywords: [], rules: [],
  },
  cryptStalker: {
    // OnKill rather than OnDeath, so the deck has a body that wants to WIN a fight as well as ones
    // that want to lose one — otherwise "trade everything" degenerates into never attacking well.
    kind: 'unit', id: 'cryptStalker', name: 'Crypt Stalker', type: 'Undead',
    level: 3, atk: 30, def: 15, dc: body(30, 15) + 1, // +1: OnKill draw
    keywords: [],
    rules: [{ trigger: 'OnKill', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
  ossuaryWarden: {
    // The main `swell` scaler on a body. At a deep pile this is the deck's biggest attacker, which
    // is the payoff the whole engine is building toward.
    kind: 'unit', id: 'ossuaryWarden', name: 'Ossuary Warden', type: 'Undead',
    level: 4, atk: 30, def: 15, dc: body(30, 15) + 1, // +1: the Undead-pile scaler
    keywords: [],
    rules: [{
      trigger: 'Passive',
      effect: { e: 'AuraAtkPerCount', amount: 2, count: { c: 'TypeInOwnGraveyard', type: 'Undead' } },
      target: { t: 'Self' },
    }],
  },
  gravecallerNyss: {
    // NAMED (2 copies). A lightning rod that profits from being one: `OnDefend` fires when she is
    // ATTACKED, before the exchange resolves, so swinging at her costs a card whether she lives or
    // dies — and if she dies she is a Gather target, which is the deck's whole shape in miniature.
    //
    // ⚠ Her first draft read "she buries the body next to her". That card cannot exist: there is no
    // mill/discard effect in the vocabulary, and `RaiseFromGraveyard` on a TRIGGER would throw
    // outright (`engine.ts` fails on a missing destination tile even under `lenient`), so nothing
    // may print a triggered raise until that is fixed.
    kind: 'unit', id: 'gravecallerNyss', name: 'Gravecaller Nyss', type: 'Undead',
    level: 4, atk: 35, def: 20, dc: body(35, 20) + 2, // +2: repeatable draw off being attacked
    keywords: [],
    rules: [{ trigger: 'OnDefend', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
  sepulchreColossus: {
    // The top end, and deliberately a plain statline: it is the thing you Gather back, so its text
    // would be skipped anyway. Cheap in DC precisely because it wears no armour above the line.
    kind: 'unit', id: 'sepulchreColossus', name: 'Sepulchre Colossus', type: 'Undead',
    level: 5, sp: 7, atk: 45, def: 25, dc: body(45, 25),
    keywords: [], rules: [],
  },
  thePaleShepherd: {
    // NAMED (1 copy). The old leader, demoted to a card — Vessik keeps his flock now. Its OnDeath
    // is the deck's best single line: it dies, and the pile it leaves behind is deeper for it.
    kind: 'unit', id: 'thePaleShepherd', name: 'The Pale Shepherd', type: 'Undead',
    level: 6, sp: 8, atk: 55, def: 25, dc: body(55, 25) + 1, // +1: OnDeath draw 2
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'Draw', n: 2 }, target: { t: 'Self' } }],
  },

  // --- THE SPADE. Spells that put your OWN cards in the ground, and pull them back out. ---

  callTheRoll: {
    // FIRST USER OF `Search` MODE 'choose' ANYWHERE IN THE GAME — the tutor unblocked by the
    // 2026-08-08 card-choice pass. It attacks the empty-graveyard problem from the other end: the
    // pile only fills if the right bodies reach the board to die in the first place.
    //
    // ⚠ THE `Draw 1` IS NOT FILLER, it is what makes the card CASTABLE. A pure tutor is eval-neutral
    // BY CONSTRUCTION — it trades a known card for another known card, so the evaluator scores it at
    // zero and then subtracts the SP. First measured build cast this 0.00 times per game. Pairing an
    // eval-blind effect with an eval-visible one on the same card is the same trick Skyfire's Ember
    // Wake and Divebomb use, and it is the standing rule for this codebase.
    kind: 'spell', id: 'callTheRoll', name: 'Call the Roll', dc: 4, sp: 2, scope: 'global',
    effects: [
      { effect: { e: 'Search', filter: { kind: 'unit', type: 'Undead' }, mode: 'choose' }, target: { t: 'Self' } },
      { effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
    ],
  },
  witherCurse: {
    kind: 'spell', id: 'witherCurse', name: 'Wither Curse', dc: 2, sp: 2, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: -10, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'ChosenEnemy' },
    }],
  },
  deathlessAscension: {
    kind: 'spell', id: 'deathlessAscension', name: 'Deathless Ascension', dc: 4, sp: 4, scope: 'located', ascension: true,
    effects: [{ effect: { e: 'Transform', atk: 65, addKeywords: ['Frenzy'] }, target: { t: 'ChosenUnit' } }],
  },

  // --- FIELDWORKS ---

  graspOfTheDead: {
    kind: 'trap', id: 'graspOfTheDead', name: 'Grasp of the Dead', dc: 2, sp: 1, interrupt: 'respond',
    trigger: { t: 'enemyAttacksFriendly' },
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: -20, duration: { kind: 'endOfTurn' } },
      target: { t: 'Attacker' },
    }],
  },
  boneOrchard: {
    // A zone trap that KILLS rather than chips, because a corpse on either side is a corpse — and
    // the bodies it takes down are the bodies the pile counts.
    // ⚠ It was not doing that job: at 20 damage it measured 2 kills in 32 hits, so the card that
    // exists to FEED the graveyard was filling it 6% of the time. 20 -> 30, DC 2 -> 3 / SP 1 -> 2
    // (2026-08-16, DAMAGE_FLOOR).
    kind: 'trap', id: 'boneOrchard', name: 'Bone Orchard', dc: 2, sp: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{ effect: { e: 'Damage', amount: 30 }, target: { t: 'TriggeringUnit' } }],
  },

  // --- FUSION. One, not two: fusion fires 0.00/game across every deck, so a second copy of a dead
  // mechanic was 3 DC of nothing. ---

  charnelLeviathan: {
    // Re-pointed off Sepulchre Colossus (45 ATK) onto the Thrall (20): 70 from 50 is a gain, 70 from
    // 75 was a downgrade. It also stops the recipe from competing with Gather the Dead for the
    // deck's best raise target. Level = the materials' levels summed — see wildgrowth.ts.
    kind: 'unit', id: 'charnelLeviathan', name: 'Charnel Leviathan', type: 'Undead',
    level: 5, atk: 70, def: 30, dc: body(70, 30) + 1, // +1: OnDeath draw 2; level 5 = 2 Thrall + 3 Stalker
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'Draw', n: 2 }, target: { t: 'Self' } }],
    fusion: { materials: ['bonewrightThrall', 'cryptStalker'] },
  },
};

export const GRAVEMARCH_DECK: DeckDef = {
  id: 'gravemarch',
  name: 'Gravemarch',
  leader: VESSIK,
  cards: { ...GRAVEMARCH_EXTRA_CARDS, ...GRAVEMARCH_DECK_CARDS },
  list: [
    // The feed — Insects, spent and never returned.
    ...dup('chitinChorister', 2), ...dup('rotmawSwarm', 2), ...dup('gravelingBrood', 3),
    ...dup('charnelHost', 3),
    // The march — Undead, every one a Gather target.
    ...dup('bonewrightThrall', 3), ...dup('cryptStalker', 3), ...dup('ossuaryWarden', 3),
    ...dup('gravecallerNyss', 2), ...dup('sepulchreColossus', 3), ...dup('thePaleShepherd', 1),
    // The spade.
    ...dup('callTheRoll', 3), ...dup('witherCurse', 3), ...dup('deathlessAscension', 3),
    // Fieldworks.
    ...dup('graspOfTheDead', 3), ...dup('boneOrchard', 3),
  ],
  fusionPool: ['charnelLeviathan'],
};
