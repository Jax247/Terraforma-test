// The Red Mark — Sable, the Oathbroken. Warrior / Grassland.
//
// FIRST BLUEPRINT DECK of the 2026-08 deck overhaul. See the vault's Deck Design Blueprint: a deck
// should own a MECHANICAL AXIS, not a stat spread. This one owns BOARD STRUCTURE.
//
// The fiction: an elite marksman company that defected. They kept the drill, the stakes and the red
// fletching; they answer to no crown. The mark is both the brand of their disgrace and the last
// thing a target sees.
//
// THE FOUR VERBS
//   rank       a front line of Anchored bodies that will not be dragged out of place
//   screen     that line exists to keep enemies OUT OF THE ARCHERS' DEAD ZONE
//   loose      exact-range shooting from the second rank
//   fall back  push a unit one tile to restore the range band, and re-arm a gun
//
// WHY THE FORMATION IS THE MECHANIC, not flavour: a range-2 shooter cannot hit an adjacent enemy.
// So the front rank is not a wall in front of the archers — it IS the archers' range band, made
// solid. Lose it and every bow in the deck switches off.
//
//     . A A A .    A = archers (range 2), the payoff
//     . F F F .    F = front rank, Anchored
//     . e e e .    enemies cannot reach A without eating F
//
// THE COST, stated as a rule rather than a vibe: this deck never clumps, so it forgoes FLANKING
// entirely (+5 per adjacent ally at the defender, the game's main go-wide payoff). It trades a
// whole combat bonus for a board shape.
//
// THE WEAKNESS, likewise: displacement scatters the ranks, and area damage punishes tight
// formations. Both are already in the card pool — Tidecaller's pushes and Skyfire's Meteor read as
// direct answers to this deck without either having been designed against it.
//
// NAMED ELITES vs ANONYMOUS RANKS: an elite squad is individuals; a levy is not. So the named
// veterans sit at 1-2 copies and the rank-and-file at 3, which makes the deckbuilding copy limit
// and the fiction push the same direction. The range DC premium (`rangeDc`, +1 per tile beyond 1)
// enforces it independently — the range-3 elite is simply too expensive to run three of.

import type { CardDef, LeaderDef } from '../../types';
import { dup, rangeDc, unitDc, type DeckDef } from './deckDef';

/** The shared stat rubric, so this deck's DEF is billed exactly like everyone else's. */
const body = (atk: number, def: number): number => unitDc(atk, def);
/** A shooter's price: its body, plus the steep premium reach carries. */
const bow = (atk: number, def: number, range: number): number => unitDc(atk, def) + rangeDc(range);

export const SABLE: LeaderDef = {
  id: 'sable',
  name: 'Sable, the Oathbroken',
  type: 'Warrior',
  atk: 20,
  // Range 2 — the leader shoots, and cannot shoot anything that closes on it. Low ATK keeps it on
  // the glass-cannon pole: reach buys a firing band to hold, never safety (see The Leader).
  range: 2,
  rules: [
    // "Kept Discipline" — the drill outlived the oath. States the deck's whole thesis as a rule:
    // deadly at distance, feeble the moment something is in your face.
    {
      trigger: 'Passive',
      effect: { e: 'AuraAtk', amount: 10 },
      target: { t: 'FriendlyOfTypes', types: ['Warrior'] },
      condition: { k: 'NoAdjacentEnemy' },
    },
  ],
  // The leader marks; the company kills. Global and cheap so it can be used every turn — this is
  // the deck's name printed as an ability, and the enabler its payoff cards read.
  ability: {
    id: 'redMarkAbility', name: 'Red Mark', cost: 2, located: false,
    effects: [{
      effect: { e: 'ApplyStatus', status: 'Marked', amount: 0, duration: { kind: 'permanent' } },
      target: { t: 'ChosenEnemy' },
    }],
  },
};

export const REDMARK_CARDS: Record<string, CardDef> = {
  // --- THE LINE: front rank. Anchored, because a front rank that can be dragged out of position
  // is not a front rank — it is a gap in the archers' range band. ---
  desertersPavise: {
    // ATK 20 -> 25 (2026-08-03): the field's level-2 bodies average 20.3 and this one screens for
    // the whole deck. Free in DC — the rubric's ATK tiers are coarse below 30.
    //
    // ⚠ GAINED `Guard` 2026-08-09, AND THIS IS THE FIX THE DECK HAS NEEDED SINCE IT WAS BUILT. The
    // `screen` verb above was INERT: `Anchored` means "cannot be DRAGGED out of place", not "cannot
    // be WALKED PAST", so for six months the front line screened nothing — an enemy simply stepped
    // around it into the archers' dead zone and every bow in the deck switched off. Guard was
    // re-spec'd from interception to a pin on 2026-08-09 and is exactly the missing sentence.
    kind: 'unit', id: 'desertersPavise', name: "Deserter's Pavise", type: 'Warrior',
    level: 2, atk: 25, def: 25, dc: body(25, 25) + 2, // +1 Anchored, +1 Guard — together, the screen
    keywords: ['Anchored', 'Guard'], rules: [],
  },
  stakeHand: {
    // The push is defensive, not aggressive: it shoves an intruder back OUT to range 2, which is
    // the deck's core interaction expressed on a cheap body.
    kind: 'unit', id: 'stakeHand', name: 'Stake-Hand', type: 'Warrior',
    level: 2, atk: 20, def: 20, dc: body(20, 20) + 1, // +1: OnSummon displacement (ATK 15 -> 20, field-normal)
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'Push', tiles: 1 }, target: { t: 'AdjacentEnemies' } }],
  },
  arrowRunner: {
    // Cheap body, and not filler: a formation needs someone to plug the gap when a pavise falls,
    // or the archers' band opens. The verb it serves is `rank`.
    //
    // ATK 10 -> 15 (2026-08-09), FREE: the rubric's ATK tiers are coarse below 30, so this costs
    // nothing and lifts the card off the floor. It was cut 3 -> 1 for being "the weakest body in
    // any registered deck", and it comes back to 2 only because the Guard pass needed the slots —
    // deliberately not to 3, because the 2026-08-03 diagnosis (too little ATK, not too few bodies)
    // still stands.
    kind: 'unit', id: 'arrowRunner', name: 'Arrow-Runner', type: 'Warrior',
    level: 1, atk: 15, def: 10, dc: body(15, 10),
    keywords: [], rules: [],
  },
  serjeantKell: {
    // NAMED (2 copies). The last serjeant of the old company; the anthem is the drill he kept.
    kind: 'unit', id: 'serjeantKell', name: 'Serjeant Kell', type: 'Warrior',
    level: 3, atk: 25, def: 25, dc: body(25, 25) + 1 + 1, // +1 Anchored, +1 anthem
    keywords: ['Anchored'],
    rules: [{ trigger: 'Passive', effect: { e: 'AuraAtk', amount: 5 }, target: { t: 'FriendlyOfTypes', types: ['Warrior'] } }],
  },

  ironhedgePavise: {
    // Added 2026-08-03. Measured effective ATK in play: this deck's ARCHERS fight at 42.9 (the
    // field's bodies average 41.2, so the back rank was never the problem) while its FRONT RANK
    // fought at 31.1 — ten short of everything it is supposed to block. That is a failure chain,
    // not a stat gap: the screen dies, the archers get engaged, and engaged archers lose both the
    // leader's +10 AND their guns at once.
    //
    // The cause is a design tension worth naming: `Kept Discipline` rewards being UNENGAGED, but
    // the front rank's whole job is to BE engaged — so the deck's own aura excluded the half of it
    // that does the fighting. The answer is a front-rank body heavy enough not to need the aura,
    // rather than inflating every card in the deck. It also fills the deck's empty level-5 slot.
    //
    // Also gained `Guard` (2026-08-09): it is the heavy half of the same line, and a screen that
    // only its cheapest body enforces is not a screen.
    kind: 'unit', id: 'ironhedgePavise', name: 'Ironhedge Pavise', type: 'Warrior',
    level: 5, sp: 6, atk: 45, def: 50, dc: body(45, 50) + 2, // +1 Anchored, +1 Guard
    keywords: ['Anchored', 'Guard'], rules: [],
  },

  // --- THE FLETCH: second rank. Everything here is priced for reach, not for stats. ---
  vergeSkirmisher: {
    // Range 1 on purpose: the deck needs an answer to whatever gets past the line, and a shooter
    // with no dead zone is the only bow that can take that fight.
    kind: 'unit', id: 'vergeSkirmisher', name: 'Verge Skirmisher', type: 'Warrior',
    level: 2, atk: 15, def: 5, dc: bow(15, 5, 1),
    keywords: ['Ranged'], range: 1, rules: [],
  },
  redFletchBowman: {
    kind: 'unit', id: 'redFletchBowman', name: 'Red Fletch Bowman', type: 'Warrior',
    level: 3, atk: 25, def: 10, dc: bow(25, 10, 2),
    keywords: ['Ranged'], range: 2, rules: [],
  },
  quietMarksman: {
    // Carries the leader's thesis on a card, so the deck still reads correctly if the leader dies
    // to something exotic — and so the "unengaged" bonus is visible on a body you play early.
    kind: 'unit', id: 'quietMarksman', name: 'Quiet Marksman', type: 'Warrior',
    level: 3, atk: 25, def: 10, dc: bow(25, 10, 2) + 1, // +1: conditional self-buff
    keywords: ['Ranged'], range: 2,
    rules: [{
      trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'Self' },
      condition: { k: 'NoAdjacentEnemy' },
    }],
  },
  markedWardenTarr: {
    // NAMED (2 copies). The payoff for the leader's ability, and the card that makes the deck's
    // name mechanically true: what Sable marks, Tarr kills.
    kind: 'unit', id: 'markedWardenTarr', name: 'Marked-Warden Tarr', type: 'Warrior',
    level: 4, atk: 35, def: 15, dc: bow(35, 15, 2) + 2, // +2: Marked payoff and card draw
    keywords: ['Ranged'], range: 2,
    rules: [
      {
        trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'Self' },
        condition: { k: 'DefenderIsMarked' },
      },
      { trigger: 'OnKill', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
    ],
  },
  ordathKingsbane: {
    // NAMED (1 copy). Added 2026-08-03 after the first A/B: the deck placed last at every bot tier
    // and `npm run diagnose -- redmark` found it was the ONLY deck in the game with no level-5+
    // body at all — top ATK 35 against a field average of 52. In a format where overflow pays out
    // 254 of 290 LP per game in ATK margin, a deck with no top end cannot close a game, however
    // well its formation holds. She is the answer to the enemy's bombs, and she shoots them from
    // outside their reach.
    kind: 'unit', id: 'ordathKingsbane', name: 'Ordath, Kingsbane', type: 'Warrior',
    level: 6, sp: 8, atk: 50, def: 20, dc: bow(50, 20, 2) + 1, // +1: the Marked payoff
    keywords: ['Ranged'], range: 2,
    rules: [{
      trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'Self' },
      condition: { k: 'DefenderIsMarked' },
    }],
  },
  vessaLongShot: {
    // NAMED (1 copy). The only range 3 in the game: she owns a band nothing else can contest, and
    // the DC premium means the deck can afford exactly one of her.
    kind: 'unit', id: 'vessaLongShot', name: 'Vessa, the Long Shot', type: 'Warrior',
    level: 4, sp: 5, atk: 30, def: 10, dc: bow(30, 10, 3),
    keywords: ['Ranged'], range: 3, rules: [],
  },

  // --- DRILL COMMANDS. Written as orders, because that is what survived the defection. ---
  fallBack: {
    // THE SIGNATURE CARD. ChosenUnit, not ChosenEnemy: it shoves an intruder back out to range 2,
    // or pulls one of your own out of contact so its bow comes back online. One tile, either way.
    kind: 'spell', id: 'fallBack', name: '"Fall Back!"', dc: 2, sp: 1, scope: 'global',
    effects: [{ effect: { e: 'Push', tiles: 1 }, target: { t: 'ChosenUnit' } }],
  },
  closeRanks: {
    kind: 'spell', id: 'closeRanks', name: '"Close Ranks!"', dc: 2, sp: 1, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 10, duration: { kind: 'endOfTurn' } },
      target: { t: 'FriendlyOfTypes', types: ['Warrior'] },
    }],
  },
  bodkinVolley: {
    // A volley is a LINE, not a blob — the shape of the effect matches the shape of the army.
    //
    // ⚠ BRIEFLY RE-CUT (2026-08-09) into a `GrantKeyword Piercing` command — the card is named for
    // the armour-piercing arrowhead, `GrantKeyword` had zero uses anywhere, and the deck's verbs are
    // orders rather than statlines, so it looked like the right home for Red Mark's Piercing.
    // MEASURED AND REVERTED: **0.06 tramples per game**, against 1.19 of its own kills still being
    // blanked by a brace. Near-vacuous.
    //
    // The cause is the recurring EVAL GATE, and it is worth stating plainly: `evaluate()` prices
    // effective ATK, effective DEF and statuses. It has no notion of "this attack would trample a
    // brace", so a Piercing GRANT is invisible to the bot — it casts it at random and never builds
    // the turn around it. Piercing on a printed STATLINE works (Dragonspire's Magma Wyrm) because
    // the keyword rides a body the evaluator can already see. A grant needs an eval term first.
    //
    // ⚠ 15 -> 20 DAMAGE (2026-08-16). At 15 this was the single worst card measured anywhere in the
    // pool: `npm run impact` saw it SET 146 times and **resolved ZERO times in 729 games**, under
    // both the greedy and the search policy. 15 damage kills a body whose effective ATK is 15 or
    // less, which is 2.2% of the live board — the bot was correct never to fire it.
    //
    // It goes to 20, NOT to the 30 that DAMAGE_FLOOR sets, and the distinction is the whole point of
    // that rule: 30 is the SINGLE-TARGET floor, because area is the other way to beat the threshold.
    // `meteor` is the proof — 20 damage over a 2x2 measured 0.77 kills per cast, the best of any
    // damage card in the game. Line3 is that same tier at one tile smaller, which is what the
    // slightly lower SP already pays for. Multiply the targets or raise the number, never both.
    kind: 'spell', id: 'bodkinVolley', name: 'Bodkin Volley', dc: 3, sp: 2, scope: 'located',
    effects: [{ effect: { e: 'Damage', amount: 20 }, target: { t: 'Line3' } }],
  },
  cutGround: {
    kind: 'spell', id: 'cutGround', name: 'Cut Ground', dc: 2, sp: 1, scope: 'located',
    effects: [{ effect: { e: 'PaintTerrain', terrain: 'Grassland' }, target: { t: 'Line3' } }],
  },
  takePayment: {
    kind: 'spell', id: 'takePayment', name: 'Take Payment', dc: 3, sp: 2, scope: 'global',
    effects: [{ effect: { e: 'Draw', n: 2 }, target: { t: 'Self' } }],
  },

  // --- FIELDWORKS. Historically, archers planted stakes so nothing could reach them. Here that is
  // literally the deck's thesis, so the traps defend the range band rather than deal damage. ---
  stakeline: {
    kind: 'trap', id: 'stakeline', name: 'Stakeline', dc: 3, sp: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{
      effect: { e: 'ApplyStatus', status: 'Snared', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'TriggeringUnit' },
    }],
  },
  caltropScreen: {
    kind: 'trap', id: 'caltropScreen', name: 'Caltrop Screen', dc: 3, sp: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{ effect: { e: 'Push', tiles: 2 }, target: { t: 'TriggeringUnit' } }],
  },

  // --- FUSION: the company's command, reassembled. ---
  theRedMarshal: {
    // ⚠ The ONE fusion that was mis-statted rather than mis-fed. At 45 ATK it was weaker than the
    // deck's own Ironhedge Pavise (45) and Ordath (50), and far below the 70-85 every other fusion
    // prints — cheapening its materials alone could not save it, because they would have had to
    // total under 25. So it gets both halves: 45 -> 60 ATK, and two 3-of bowmen as materials.
    kind: 'unit', id: 'theRedMarshal', name: 'The Red Marshal', type: 'Warrior',
    level: 5, atk: 60, def: 35, dc: bow(60, 35, 2) + 1, // level 5 = 2 Verge Skirmisher + 3 Red Fletch
    keywords: ['Ranged', 'Anchored'], range: 2,
    rules: [{ trigger: 'Passive', effect: { e: 'AuraAtk', amount: 5 }, target: { t: 'FriendlyOfTypes', types: ['Warrior'] } }],
    fusion: { materials: ['vergeSkirmisher', 'redFletchBowman'] },
  },
};

export const REDMARK_DECK: DeckDef = {
  id: 'redmark',
  name: 'The Red Mark',
  leader: SABLE,
  cards: REDMARK_CARDS,
  list: [
    // The line — anonymous ranks at 3, the named serjeant at 2.
    // arrowRunner cut 3 -> 1: at 10 ATK it was the weakest body in any registered deck, and the
    // 2026-08-03 diagnosis was that this deck's problem is too little ATK, not too few bodies.
    ...dup('desertersPavise', 3), ...dup('stakeHand', 3), ...dup('arrowRunner', 2),
    ...dup('serjeantKell', 2), ...dup('ironhedgePavise', 2),
    // The fletch — the range-3 elite is a 1-of purely because reach is priced to force that.
    // quietMarksman went back to 3 once reach was repriced — the third copy was only ever cut
    // because the +2/tile premium had eaten the budget.
    ...dup('vergeSkirmisher', 3), ...dup('redFletchBowman', 3), ...dup('quietMarksman', 3),
    ...dup('markedWardenTarr', 1), ...dup('vessaLongShot', 1), ...dup('ordathKingsbane', 1),
    // Commands.
    ...dup('fallBack', 3), ...dup('closeRanks', 3), ...dup('bodkinVolley', 2),
    ...dup('cutGround', 2), ...dup('takePayment', 2),
    // Fieldworks.
    ...dup('stakeline', 3), ...dup('caltropScreen', 1),
  ],
  fusionPool: ['theRedMarshal'],
};
