// Piercer — a DEFENSE_EXPERIMENT probe deck. Aggressive high-ATK/low-DEF bodies with the
// Piercing keyword, so the harness can measure whether piercing keeps the Anvil deck's walls
// honest — and which piercing model does it without invalidating anvils. NOT registered in DECKS.
//
// 2026-07-31 build-out gave the deck things to DO (draw, traps, answers to a wall it cannot
// out-stat). 2026-08-02 CARD PASS gives its cards something to SAY: nine of twelve bodies were
// vanilla statlines, and "Vanguard, the Breaker" led the army by painting grass.
//   * Vanguard now breaks armor instead of landscaping. Sunder (2 SP, located) strips 20 DEF for
//     two turns — the lever that lets the NON-piercing half of the deck crack a wall, which is
//     the deck's stated pack/flank plan. It needed the engine to grow a `DefMod` status (the twin
//     of AtkMod); see effectiveDef in stats.ts. Located, so the Breaker has to come forward to
//     use it — with 40 ATK, the highest leader stat in the pool, that is a real but survivable ask.
//   * His passive is a flat +5 ATK banner over WARRIORS specifically: the half of the deck that
//     has to get through a wall the hard way. The Fiends and Machines are the piercers; they
//     already have their answer printed on them. It is also the only leader passive in the pool
//     that ignores terrain — the deliberate contrast with Bastion, who is entirely about ground.
//     (The `DefenderUnmovedThisTurn` punish condition would have been the perfect thematic fit —
//     walls never move — but it is inert in real play; see the TODO in stats.ts.)
//   * Bodies: the deck's motion is now printed rather than implied. War Hound gains a tile of
//     movement every turn, Pike Charger arrives already charging, Berserker grows +10 ATK with
//     every kill, Reaver refuels the hand off its kills, and Skirmisher — previously a strictly
//     worse War Hound — is now the spring runner that funds the curve.
//   * Warcry Chant left the list (it stays in the pool for Mixed): Sunder does the same job from
//     the leader, repeatably, on the DEF side where walls actually live.
// Spike Runner / Iron Lance / Bone Drill / Void Breaker stay vanilla ON PURPOSE — Piercing is the
// card, and the rubric already charges them a DC for it.

import type { CardDef, LeaderDef } from '../../types';
import { unitDc as dc, dup, type DeckDef } from './deckDef';

const VANGUARD: LeaderDef = {
  id: 'vanguard', name: 'Vanguard, the Breaker', type: 'Warrior', atk: 40,
  rules: [
    // The banner. Kaelen's magnitude (+5) and unconditional, because this deck has no terrain
    // plan to condition it on — it pressures from turn one and never sets up.
    {
      trigger: 'Passive',
      effect: { e: 'AuraAtk', amount: 5 },
      target: { t: 'FriendlyOfTypes', types: ['Warrior'] },
    },
  ],
  // Priced against Oskar's Wither (3 SP located, −10 ATK for a turn). Sunder is cheaper and
  // bigger because it only does anything at all while the defense flag is on — against a unit in
  // attack stance, DEF is never read and the spend is wasted.
  ability: {
    id: 'sunder', name: 'Sunder', cost: 2, located: true,
    effects: [{
      effect: { e: 'ApplyStatus', status: 'DefMod', amount: -20, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'ChosenEnemy' },
    }],
  },
};

const CARDS: Record<string, CardDef> = {
  // Piercers: the wall-breakers. High ATK, thin DEF, Piercing keyword (+1 DC premium).
  // Spread across levels 2–4 so the deck can answer a wall on any turn, not just its best draws.
  // All four are deliberately vanilla: the keyword IS the card text.
  spikeRunner: { kind: 'unit', id: 'spikeRunner', name: 'Spike Runner', type: 'Warrior', level: 2, atk: 30, def: 10, dc: dc(30, 10, true), keywords: ['Piercing'], rules: [] },
  ironLance: { kind: 'unit', id: 'ironLance', name: 'Iron Lance', type: 'Warrior', level: 3, atk: 40, def: 15, dc: dc(40, 15, true), keywords: ['Piercing'], rules: [] },
  boneDrill: { kind: 'unit', id: 'boneDrill', name: 'Bone Drill', type: 'Machine', level: 3, atk: 40, def: 20, dc: dc(40, 20, true), keywords: ['Piercing'], rules: [] },
  voidBreaker: { kind: 'unit', id: 'voidBreaker', name: 'Void Breaker', type: 'Fiend', level: 4, atk: 55, def: 20, dc: dc(55, 20, true), keywords: ['Piercing'], rules: [] },

  // Plain aggro bodies: pressure that must go THROUGH a wall the hard way (no piercing).
  rushBlade: {
    // The deck's one deliberate blank: a 1-SP body with no text is what tempo costs.
    kind: 'unit', id: 'rushBlade', name: 'Rush Blade', type: 'Warrior', level: 1, atk: 20, def: 10,
    dc: dc(20, 10), keywords: [], rules: [],
  },
  skirmisher: {
    // Was a strictly worse War Hound. Now it is the spring runner: +3 SP from the capture plus
    // this, and a turn-2 Skirmisher pays for a turn-3 Void Breaker. The aggro mirror of Anvil's
    // Pebble Scout, which draws off the same objective instead.
    kind: 'unit', id: 'skirmisher', name: 'Skirmisher', type: 'Warrior', level: 2, atk: 25, def: 15,
    dc: dc(25, 15) + 1, // +1: OnCapture SP
    keywords: [],
    rules: [{ trigger: 'OnCapture', effect: { e: 'GainSP', n: 2 }, target: { t: 'Self' } }],
  },
  warhound: {
    // Permanent +1 movement: extraMove is cleared in the start phase BEFORE StartOfTurn rules
    // fire, so this re-grants every turn rather than stacking. Reach is what an aggro deck buys
    // with its card slots — a hound that threatens two tiles forces the wall to be built early.
    kind: 'unit', id: 'warhound', name: 'War Hound', type: 'Beast', level: 2, atk: 30, def: 15,
    dc: dc(30, 15) + 1, // +1: StartOfTurn movement
    keywords: [],
    rules: [{ trigger: 'StartOfTurn', effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'Self' } }],
  },
  pikeCharger: {
    // Arrives charging (Thermal Rider's shape): summoning sickness is off in the current ruleset,
    // so this body threatens two tiles the turn it lands.
    kind: 'unit', id: 'pikeCharger', name: 'Pike Charger', type: 'Warrior', level: 3, atk: 35, def: 20,
    dc: dc(35, 20) + 1, // +1: OnSummon movement
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'Self' } }],
  },
  houndmaster: {
    // Pool-only: Mixed runs it, Piercer does not. A vanilla 35/15 is a strictly worse War Hound
    // now that the hound moves, and this deck has no slot for a redundant body.
    kind: 'unit', id: 'houndmaster', name: 'Houndmaster', type: 'Beast', level: 3, atk: 35, def: 15,
    dc: dc(35, 15), keywords: [], rules: [],
  },
  berserker: {
    // The snowball. A permanent AtkMod per kill is the one growth curve this deck can have —
    // it has no ramp and no card advantage engine, so its late game has to come off the board.
    kind: 'unit', id: 'berserker', name: 'Berserker', type: 'Fiend', level: 3, atk: 45, def: 20,
    dc: dc(45, 20) + 1, // +1: OnKill permanent buff
    keywords: [],
    rules: [{
      trigger: 'OnKill',
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 10, duration: { kind: 'permanent' } },
      target: { t: 'Self' },
    }],
  },
  reaver: {
    // Combat as refuel — plunder. The top-end body that keeps a spent hand going, which is the
    // failure mode aggro actually dies to.
    kind: 'unit', id: 'reaver', name: 'Reaver', type: 'Fiend', level: 4, atk: 50, def: 25,
    dc: dc(50, 25) + 1, // +1: OnKill draw
    keywords: [],
    rules: [{ trigger: 'OnKill', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },

  // --- Pack bodies. Frenzy (+5 per adjacent ally, max +20) and flanking (+5 per ally beside the
  // defender, max +10) stack on the SAME formation, which is the deck's non-piercing way past a
  // wall: three 35s standing together break a 55 DEF that none of them beats alone. Both are
  // vanilla by design — the keyword is the whole card, and the formation is the play.
  bladeDancer: { kind: 'unit', id: 'bladeDancer', name: 'Blade Dancer', type: 'Warrior', level: 2, atk: 25, def: 10, dc: dc(25, 10), keywords: ['Frenzy'], rules: [] },
  banneret: { kind: 'unit', id: 'banneret', name: 'Banneret of the Breach', type: 'Warrior', level: 3, atk: 35, def: 20, dc: dc(35, 20), keywords: ['Frenzy'], rules: [] },

  // --- Support: push a body over the line it just failed to break, or move the line.
  warSpoils: {
    // Aggro's refuel. Same rate as Royal Nectar / Stokefire (dc 2, sp 1); 1 SP so it can ride
    // along with a summon on the same turn instead of costing the deck its tempo.
    kind: 'spell', id: 'warSpoils', name: 'War Spoils', dc: 2, sp: 1, scope: 'global',
    effects: [
      { effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' } },
      { effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
    ],
  },
  warcryChant: {
    // Pool-only since the 2026-08-02 pass: Sunder does this job from the leader, repeatably, and
    // on the axis that matters against a wall. Mixed still runs it.
    kind: 'spell', id: 'warcryChant', name: 'Warcry Chant', dc: 2, sp: 2, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 15, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'ChosenUnit' },
    }],
  },
  breakerAnthem: {
    // The army-wide version, at Swarm Call's rate (dc 3, sp 3, +10, expires end of turn). Four
    // types = "everything you have", because unlike Swarm Call this deck is not mono-type.
    // The alpha-strike button: it turns a board that is 10 short of every wall into a break.
    kind: 'spell', id: 'breakerAnthem', name: "Breaker's Anthem", dc: 3, sp: 3, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 10, duration: { kind: 'endOfTurn' } },
      target: { t: 'FriendlyOfTypes', types: ['Warrior', 'Fiend', 'Beast', 'Machine'] },
    }],
  },
  grapnelYank: {
    // Displacement instead of removal: a wall is only a wall on the tile it was chosen for.
    // Priced at Siren's Call's rate (dc 2, sp 2, Pull 2). A 1-of because Anvil's cheapest walls
    // are Anchored — this answers the big ones, not the whole line.
    kind: 'spell', id: 'grapnelYank', name: 'Grapnel Yank', dc: 2, sp: 2, scope: 'global',
    effects: [{ effect: { e: 'Pull', tiles: 2 }, target: { t: 'ChosenEnemy' } }],
  },
  overrun: {
    kind: 'spell', id: 'overrun', name: 'Overrun', dc: 2, sp: 2, scope: 'global',
    effects: [{ effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'ChosenUnit' } }],
  },
  ambushRun: {
    // Pin whatever walks into the zone so the piercers pick which fight happens next turn.
    // Stun, not damage — damage at any castable size is a wall-deleter (Damage kills on
    // effective ATK), and this deck is the control arm for whether walls survive, not the proof
    // that they cannot.
    // DC 3 / SP 3 — see snareVine (2026-08-03 stun repricing, rebated 2026-08-09 when setting a
    // trap started costing SP).
    kind: 'trap', id: 'ambushRun', name: 'Ambush Run', dc: 3, sp: 3, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{
      effect: { e: 'ApplyStatus', status: 'Stunned', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'TriggeringUnit' },
    }],
  },
  silencingCharge: {
    // 2026-08-02: the deck had no interaction with Anvil's two non-body cards — Siege Volley, its
    // only reach, and Quarry Levy, its only refuel. Both are spells, and a turtle that cannot
    // draw is a turtle on a fatigue clock. Scale Ward's shape (dc 3, negate, replaces itself).
    kind: 'trap', id: 'silencingCharge', name: 'Silencing Charge', dc: 3, sp: 2, interrupt: 'negate',
    trigger: { t: 'enemyActivatesSpell' },
    effects: [{ effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
};

export const PIERCER_DECK: DeckDef = {
  id: 'piercer', name: 'Piercer (Aggro probe)', leader: VANGUARD, cards: CARDS,
  list: [
    // Wall-breakers (10) — the probe's subject. Iron Lance and Spike Runner at 3 because the
    // curve wants a piercer on turns 2–3; Void Breaker at 2 (5 SP is a whole turn's income).
    ...dup('spikeRunner', 3), ...dup('ironLance', 3), ...dup('boneDrill', 2), ...dup('voidBreaker', 2),
    // Pack (6) — the Frenzy/flank lane that cracks a wall without the keyword, and the half of
    // the deck Vanguard's banner is pointed at.
    ...dup('bladeDancer', 3), ...dup('banneret', 3),
    // Motion and grind (14) — pressure that has to beat a wall on raw numbers, so it buys reach
    // (Hound, Charger), a growth curve (Berserker), and a refuel (Reaver) instead of more stats.
    ...dup('warhound', 3), ...dup('berserker', 3), ...dup('rushBlade', 3),
    ...dup('pikeCharger', 2), ...dup('reaver', 2), ...dup('skirmisher', 1),
    // Support (10). Total DC lands well under the cap, which is the aggro archetype paying for
    // itself the way Hivebrood does: cheap cards, and the leftover budget IS the deck's speed.
    ...dup('warSpoils', 2), ...dup('breakerAnthem', 2), ...dup('ambushRun', 2),
    ...dup('silencingCharge', 2), ...dup('grapnelYank', 1), ...dup('overrun', 1),
  ],
  fusionPool: [],
};
