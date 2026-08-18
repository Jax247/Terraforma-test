// Anvil — a DEFENSE_EXPERIMENT probe deck. High-DEF bodies that want to sit in defense
// stance and soak, plus a couple of high-ATK/high-DEF "true tanks" that resist even a
// piercer. Deliberately low ATK on the pure walls so the piercing A/B has a clear target.
// NOT registered in DECKS — loaded only by the `defense` / `defense-piercing` harness runs.
//
// Deck-legal since 2026-07-29: ≤3 copies of everything and under the DC cap. That dilution IS
// the DC rubric working as designed — you still cannot field forty high-DEF walls; the deck has
// to spend slots elsewhere to afford the ones that matter.
//
// 2026-08-02 CARD PASS. The 2026-07-31 build fixed what the deck could not DO (no draw, no reach,
// one trap); this pass fixes what its cards SAY. Eleven of thirteen bodies were vanilla statlines,
// and Bastion's "Entrench" was a verbatim copy of the deck's own Entrench Order spell — the leader
// contributed nothing an ordinary card could not. What changed:
//   * Bastion is now a warden on the DEF axis, which needed the engine to grow one: `AuraDef`
//     (passive DEF aura) and the `DefMod` timed status, the twins of AuraAtk/AtkMod. See
//     effectiveDef in stats.ts. Passive = friendly Terra/Machine ON MOUNTAIN get +10 DEF, so the
//     deck's terraform finally has a leader-level payoff; active = Aegis, a repeatable +20 DEF
//     shield that costs Bastion his safety (located → he must stand by the line he shields).
//   * Entrench Order goes 1 → 3 now that it feeds the passive instead of duplicating it.
//   * Text went on the cheap bodies, because that is where the DC rubric can afford it — the
//     scout draws off springs, the acolyte replaces itself when it dies holding, the quarry hand
//     pays part of its own summon. Anvilbearer traded a DEF tier (55 → 45) to buy its death
//     rattle, which is the trade the rubric is meant to force.
//   * The deck's real hole was that HOLDING never threatened anything: reflect only fires if the
//     opponent chooses to attack, so a patient opponent could simply decline. Sentry Golem's
//     start-of-turn burn now taxes standing next to the line — pointed squarely at Piercer's
//     Frenzy/flank stacks, which have to bunch up to break a wall.
//   * Stone Wall and Slag Plate are Anchored: a wall does not get dragged out of position, which
//     is the deliberate counterplay to Piercer's Grapnel Yank.
// Iron Bulwark, Granite Rampart and Fortress Titan stay vanilla ON PURPOSE. At 60/75/70 DEF the
// statline IS the card, and the rubric prices a printed rule on top of it out of the budget.
// The deck spends to 110 of 110, like Gravemarch.

import type { CardDef, LeaderDef } from '../../types';
import { unitDc as dc, dup, type DeckDef } from './deckDef';

const BASTION: LeaderDef = {
  id: 'bastion', name: 'Bastion, the Warden', type: 'Terra', atk: 30,
  rules: [
    // The aegis. Same shape as Briar/Oskar/Vharos (type on favored terrain) but on the axis this
    // archetype actually plays — and conditional on the deck's own Mountain plan, so it is a
    // payoff the opponent can see coming and play around rather than a flat buff.
    {
      trigger: 'Passive',
      effect: { e: 'AuraDef', amount: 10 },
      target: { t: 'FriendlyOfTypesOnTerrain', types: ['Terra', 'Machine'], terrain: 'Mountain' },
    },
  ],
  // Located, so shielding the front line walks the leader INTO reach of it. 2 SP is Neris's
  // Undertow rate: cheap and repeatable, which is what a warden's active should be.
  ability: {
    id: 'aegis', name: 'Aegis', cost: 2, located: true,
    effects: [{
      effect: { e: 'ApplyStatus', status: 'DefMod', amount: 20, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'ChosenUnit' },
    }],
  },
};

const CARDS: Record<string, CardDef> = {
  // Pure walls: DEF >> ATK. These are the units meant to hold a defense stance. DC is priced
  // by unitDc — armour above the round(atk/2) line is expensive, so a whole deck of these busts the cap.
  stoneWall: {
    // Anchored (+1): a wall that can be dragged off its tile is not a wall. This is the direct
    // answer to Piercer's Grapnel Yank, and the reason that card is a 1-of over there.
    kind: 'unit', id: 'stoneWall', name: 'Stone Wall', type: 'Terra', level: 2, atk: 10, def: 45,
    dc: dc(10, 45) + 1, keywords: ['Anchored'], rules: [],
  },
  anvilbearer: {
    // Traded 55 → 45 DEF (one whole rubric tier) to pay for the death rattle. The anvil that
    // breaks takes the hammer with it: 20 damage destroys anything whose effective ATK it meets,
    // which is most of Piercer's chaff and none of its real piercers.
    kind: 'unit', id: 'anvilbearer', name: 'Anvilbearer', type: 'Machine', level: 2, atk: 20, def: 45,
    dc: dc(20, 45) + 1, // +1: OnDeath AoE
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'Damage', amount: 20 }, target: { t: 'AdjacentEnemies' } }],
  },
  ironBulwark: {
    // Deliberate vanilla: 60 DEF for 3 DC is the card. Printing text here costs a 4th DC and the
    // deck cannot afford four of those.
    kind: 'unit', id: 'ironBulwark', name: 'Iron Bulwark', type: 'Terra', level: 3, atk: 20, def: 60,
    dc: dc(20, 60), keywords: [], rules: [],
  },
  graniteRampart: {
    kind: 'unit', id: 'graniteRampart', name: 'Granite Rampart', type: 'Machine', level: 4, atk: 25, def: 75,
    dc: dc(25, 75), keywords: [], rules: [],
  },
  // Bruiser + true tanks: enough ATK to matter, so the 'atk' piercing model can't free-crack them.
  sentryGolem: {
    // The answer to "the opponent simply declines the trade". Reflect is reactive — it only pays
    // when the enemy attacks — so the deck needed something that taxes merely STANDING next to
    // the line. Aimed at Piercer's Frenzy/flank formations, which must bunch up to break a wall.
    kind: 'unit', id: 'sentryGolem', name: 'Sentry Golem', type: 'Machine', level: 3, atk: 30, def: 40,
    dc: dc(30, 40) + 1, // +1: StartOfTurn AoE
    keywords: [],
    rules: [{ trigger: 'StartOfTurn', effect: { e: 'Damage', amount: 10 }, target: { t: 'AdjacentEnemies' } }],
  },
  boulderBrute: {
    // Arrives like a boulder: the shove buys the line a tile of breathing room and breaks up a
    // flank formation on the spot (flanking reads allies BESIDE the defender).
    kind: 'unit', id: 'boulderBrute', name: 'Boulder Brute', type: 'Terra', level: 4, atk: 40, def: 50,
    dc: dc(40, 50) + 1, // +1: OnSummon displacement
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'Push', tiles: 1 }, target: { t: 'AdjacentEnemies' } }],
  },
  fortressTitan: {
    // The apex, and the deck's second deliberate vanilla: 55/70 for 6 DC is already a sixth of
    // the budget on one card.
    kind: 'unit', id: 'fortressTitan', name: 'Fortress Titan', type: 'Terra', level: 5, atk: 55, def: 70,
    dc: dc(55, 70), keywords: [], rules: [],
  },

  // --- Cheap chaff: bodies to hold a tile while the real walls are still in hand. Low DEF on
  // purpose, so they never read as more walls at a discount — and this is where the deck's
  // printed text lives, because at 1 base DC a rule is affordable here and nowhere else.
  pebbleScout: {
    // A scout is for taking ground, not holding it: the springs are the only board objective a
    // turtle deck would otherwise never contest.
    kind: 'unit', id: 'pebbleScout', name: 'Pebble Scout', type: 'Terra', level: 1, atk: 15, def: 20,
    dc: dc(15, 20) + 1, // +1: OnCapture draw
    keywords: [],
    rules: [{ trigger: 'OnCapture', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
  bulwarkAcolyte: {
    // Chaff that replaces itself when it dies holding — the attrition floor under a deck whose
    // plan is to lose bodies slowly. Priced at Marrow Hound's rate (dc 2).
    kind: 'unit', id: 'bulwarkAcolyte', name: 'Bulwark Acolyte', type: 'Terra', level: 1, atk: 10, def: 15,
    dc: dc(10, 15) + 1, // +1: OnDeath draw
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
  slagPlate: {
    kind: 'unit', id: 'slagPlate', name: 'Slag Plate', type: 'Machine', level: 1, atk: 5, def: 15,
    dc: dc(5, 15) + 1, // +1: Anchored
    keywords: ['Anchored'], rules: [],
  },
  quarryHand: {
    // Pays a third of its own summon back. The SP curve caps at 8 and this deck's walls cost 4–6,
    // so a body that refunds SP is a body that lets a wall come down a turn earlier.
    kind: 'unit', id: 'quarryHand', name: 'Quarry Hand', type: 'Terra', level: 2, atk: 20, def: 20,
    dc: dc(20, 20) + 1, // +1: OnSummon SP
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' } }],
  },

  // --- Terraforming body. Mountain is favored by BOTH of this deck's types, and effectiveDef
  // prices terrain the same way effectiveAtk does — so a self-paint is worth +10/+10 on the
  // spot, +10 more DEF under Bastion's aegis, and it leaves the tile improved for whatever wall
  // stands there next.
  cairnwright: {
    kind: 'unit', id: 'cairnwright', name: 'Cairnwright', type: 'Terra', level: 2, atk: 20, def: 35,
    dc: dc(20, 35) + 1, // +1: OnSummon terraform
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'PaintTerrain', terrain: 'Mountain' }, target: { t: 'ThisTile' } }],
  },
  // --- The deck's only offense that does not require walking a wall into a fight: Ranged
  // resolves without entering the defended tile, so the ballista chips from the second rank
  // while the line in front of it holds. Strikeback still applies — it is a siege engine, not
  // a free hit — hence the real DEF for the turns it has to survive on its own.
  rampartBallista: {
    kind: 'unit', id: 'rampartBallista', name: 'Rampart Ballista', type: 'Machine', level: 4, atk: 35, def: 45,
    dc: dc(35, 45) + 1, // +1: Ranged
    keywords: ['Ranged'], rules: [],
  },

  // --- Support: hold ground rather than take it, plus the economy and the reach the first
  // build was missing entirely.
  quarryLevy: {
    // The fatigue answer. Priced against Royal Nectar / Stokefire (dc 2, sp 1) — the standard
    // "one card, one SP" engine piece every registered deck runs and Anvil somehow did not.
    kind: 'spell', id: 'quarryLevy', name: 'Quarry Levy', dc: 2, sp: 1, scope: 'global',
    effects: [
      { effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' } },
      { effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
    ],
  },
  siegeVolley: {
    // Reach. Damage may name the enemy LEADER, which is the only way this deck deals LP without
    // being attacked first. Priced at Dragonfire's rate (dc 3, sp 4) — 4 SP is half a turn's
    // income at the cap, so it closes a game slowly and never doubles up.
    kind: 'spell', id: 'siegeVolley', name: 'Siege Volley', dc: 3, sp: 4, scope: 'global',
    effects: [{ effect: { e: 'Damage', amount: 25 }, target: { t: 'ChosenEnemy' } }],
  },
  entrenchOrder: {
    // No longer a copy of the leader ability: since 2026-08-02 Mountain is what switches Bastion's
    // aegis on, so this is the deck's way of turning a tile into +10 ATK / +20 DEF for a wall.
    kind: 'spell', id: 'entrenchOrder', name: 'Entrench Order', dc: 1, sp: 1, scope: 'located',
    effects: [{ effect: { e: 'PaintTerrain', terrain: 'Mountain' }, target: { t: 'Line3' } }],
  },
  pinDown: {
    // DC 3 / SP 3 (2026-08-03 stun repricing): the vault's cost curve for the union status.
    // A cast spell keeps paying SP every time, so it sits a point under the trap rate.
    kind: 'spell', id: 'pinDown', name: 'Pin Down', dc: 3, sp: 3, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'Stunned', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'ChosenEnemy' },
    }],
  },
  bulwarkRepulse: {
    // The piercer answer, and the reason it has to be `negate`: a respond-push would shove the
    // attacker away AFTER its attack already resolved. Mirrors Repelling Tide (dc 3).
    kind: 'trap', id: 'bulwarkRepulse', name: 'Bulwark Repulse', dc: 3, sp: 2, interrupt: 'negate',
    trigger: { t: 'enemyAttacksFriendly' },
    effects: [{ effect: { e: 'Push', tiles: 2 }, target: { t: 'Attacker' } }],
  },
  collapsingTunnel: {
    kind: 'trap', id: 'collapsingTunnel', name: 'Collapsing Tunnel', dc: 2, sp: 1, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{ effect: { e: 'Damage', amount: 20 }, target: { t: 'TriggeringUnit' } }],
  },
};

export const ANVIL_DECK: DeckDef = {
  id: 'anvil', name: 'Anvil (Defense probe)', leader: BASTION, cards: CARDS,
  list: [
    // Walls and tanks (15) — the probe's actual subject. Copies scale with how much a body
    // wants to be drawn EARLY: cheap walls at 3, the 4- and 5-drops at 1–2, because the SP curve
    // (4 / +3 / cap 8) means a hand of Fortress Titans is a hand of blanks on turns 1–3.
    ...dup('stoneWall', 2), ...dup('anvilbearer', 2), ...dup('ironBulwark', 1),
    ...dup('sentryGolem', 1), ...dup('rampartBallista', 2),
    ...dup('boulderBrute', 1), ...dup('graniteRampart', 1), ...dup('fortressTitan', 1),
    // Early bodies (12) — where the deck's printed text lives, since 1-DC bodies are the only
    // ones the rubric lets it write on. Cairnwright is worth 3: the tile it paints outlives it.
    ...dup('cairnwright', 3), ...dup('pebbleScout', 3), ...dup('quarryHand', 3),
    ...dup('bulwarkAcolyte', 3), ...dup('slagPlate', 3),
    // Support (13): economy 3, terraform 3, reach 2, traps 3, positional 2.
    ...dup('quarryLevy', 3), ...dup('entrenchOrder', 3), ...dup('siegeVolley', 2),
    // Stun repricing (2026-08-03) pushed this deck 110 -> 112. It sat exactly at the cap by
    // design, so paying for the premium cost two trims: pinDown 2 -> 1 and sentryGolem 2 -> 1,
    // refilled with the cheapest support that had copy headroom. Wall count is untouched.
    //
    // 2026-08-04, the relative DC rubric: armour is now priced on its EXCESS over round(atk/2),
    // which is a straight tax on exactly this deck — 122/110 on the first recount. Paid the way
    // the rubric intends, by thinning the wall STACK rather than the walls: stoneWall 3->2,
    // anvilbearer 3->2, ironBulwark 2->1, with the freed slots going to chaff that gave up the
    // armour it never used (Acolyte 25->15, Slag Plate 30->15, Quarry Hand 25->20, each now 1 DC
    // cheaper). Anvil still opens on a wall; it just cannot open on a wall EVERY game.
    ...dup('bulwarkRepulse', 2), ...dup('collapsingTunnel', 3), ...dup('pinDown', 1),
  ],
  fusionPool: [],
};
