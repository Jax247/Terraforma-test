import { defaultDef } from '../../engine';
import type { CardDef, LeaderDef, SpellCardDef, UnitCardDef } from '../../types';

/** A registered, playable test deck: leader + 40-card list + fusion side zone. */
export interface DeckDef {
  id: string;
  name: string;
  leader: LeaderDef;
  /** Every def the deck references (main list + fusion pool), keyed by id. */
  cards: Record<string, CardDef>;
  /** Main-deck card ids, duplicates inlined (40–50, ≤3 copies each). */
  list: string[];
  /** Fusion-pool card ids — separate side zone, never drawn, not in the 40. */
  fusionPool: string[];
}

export const dup = (id: string, n: number): string[] => Array.from({ length: n }, () => id);

/**
 * THE unit DC rubric: base 1 + ATK tier + DEF premium + Piercing + range.
 *
 *   ATK:  ≥50 → +2,  ≥30 → +1
 *   DEF:  charged on the EXCESS over `defaultDef(atk)` — see below
 *   Piercing → +1
 *   Range:  +1 per tile beyond 1 (see `rangeDc`)
 *
 * DEF IS PRICED RELATIVE, NOT ABSOLUTE (2026-08-04, when two-stat combat became a core rule and
 * every deck started printing DEF). The engine has always given a card with no printed DEF a
 * fallback of round(atk/2), so that much armour is the body you already had and costs nothing —
 * which is what lets 60-odd existing cards print an honest DEF without a single deck's cost
 * moving. You pay only for armour ABOVE that line:
 *
 *   excess = def − round(atk/2):   ≥45 → +3,  ≥30 → +2,  ≥15 → +1
 *
 * Deliberately ASYMMETRIC: a glass cannon gets no rebate for printing DEF below the line. Paying
 * people to dump DEF would just fund wider aggro decks, and the drawback is already priced by
 * the board — a low-DEF body simply cannot hold a tile.
 *
 * The premium is what keeps a fortress deck unbuildable: a wall's excess is most of its statline,
 * so stacking 40 of them busts the 110 cap long before it reaches the board (asserted directly in
 * defenseMode.test.ts). Anvil is legal only because the pricing forced it to spend a third of its
 * slots on chaff.
 *
 * Piercing is in the formula because it is the one keyword the combat table itself names. Every
 * OTHER keyword or printed rule is priced by an explicit `dc(atk, def) + n` at the call site with
 * a comment naming what the premium buys — keeping this a stat rubric rather than a card-text
 * valuation engine.
 *
 * ⚠ GUARD IS DELIBERATELY *NOT* IN THE RUBRIC (2026-08-09). It is arguably the same class as
 * Piercing — a rule the engine names rather than card text — but it is named by the MOVEMENT rule,
 * not the combat table, and more importantly nobody yet knows what a pin is worth. Call-site
 * pricing at **+1** keeps it variable per card while the `guard` A/B finds out; promote it into the
 * formula once the number is known, not before.
 */
/**
 * Deckbuild premium for firing distance. **+1 per tile beyond 1** (was +2 until 2026-08-03).
 *
 * The original +2 was set on the theory that reach is the strongest dial a ranged card has. The
 * first ranged deck measured that theory and it was wrong — not because reach is weak, but because
 * expected value is power x UPTIME and only the power had been priced. Exact range means a shooter
 * covers exactly four tiles, and `npm run diagnose -- redmark` found its archers hold a legal shot
 * only **24% of turns** (though 93% of the shots they do take kill, so the ability is strong and
 * rare, not weak). At +2 that put **18% of the deck's whole budget** into an ability that mostly
 * could not fire, and left it worst-in-class on every stat axis.
 *
 * +1 also better reflects that reach is the one premium carrying a built-in DRAWBACK: the dead
 * zone. A shooter cannot defend its own tile, so it is paying for reach and paying again in
 * vulnerability. No other premium in the rubric does that.
 *
 * 0 at range 1, so every card authored before exact range existed is priced exactly as before.
 */
export function rangeDc(range = 1): number {
  return Math.max(0, range - 1);
}

/**
 * THE DAMAGE FLOOR: 30 for a single-target `Damage` effect (2026-08-16).
 *
 * `Damage` against a unit is not incremental — `applyDamage` destroys if `amount >= effectiveAtk`
 * and otherwise does NOTHING. So "deal N damage" is a `Destroy` carrying a hidden
 * `EffAtkAtMost: N`, and the only question that matters is what fraction of the board sits under
 * N. `npm run impact` censused 113,603 live bodies at turn handovers and put the median effective
 * ATK at **40** — printed ATK runs far lower, but terrain, auras and survivorship mean the body
 * actually standing in front of you is a 40.
 *
 * At 20 that bought a **10% kill rate under greedy and 4% under search** (22/216 and 4/103 hits).
 * Nine cards across seven decks were priced around that number, and 30 covers ~37% of the board.
 *
 * ⚠ **30 IS A FLOOR, NOT A FIX, AND THE BOARD CENSUS IS THE WRONG DENOMINATOR.** Measured after the
 * raise: 30 damage killed **14 of 118 hits — 12%**, against the ~37% the board-wide census
 * predicted. The follow-up measurement explains it and is the more important number:
 *
 *     effective ATK of what damage ACTUALLY HIT     mean 44.1   median 45   (n=163)
 *     effective ATK of every live body              mean 39.7   median 40   (n=112,329)
 *
 * A damage effect does not hit a random body. A zone trap catches whoever walked into your half,
 * a mine catches whoever stepped on it, and an `Attacker`-targeted punish catches the thing that
 * chose to attack — all of which self-select for the BIG bodies. So pricing damage against the
 * board is optimistic by about 5 ATK, and 30 clears only the bottom eighth of what it meets.
 * To kill half of what it actually hits, a single-target number has to be near **45**.
 *
 * Which leaves the next lever an open question rather than a solved one, and the honest options are
 * to push the number much higher, to convert these cards to AREA (`meteor` sits at 0.89 kills/cast
 * and is the only damage card that works), or to convert them to a conditional `Destroy` the way
 * `breachTheLine` does — that card measured **1.00 kills per resolution**. Do not raise the floor
 * again without re-reading the victim census; the board census will lie to you a second time.
 *
 * PRICE: **+1 SP, DC UNCHANGED.**
 *
 * The instinct is to charge DC too — power went up, so the budget should. It is the wrong read, for
 * the same reason `rangeDc` came down from +2 to +1: expected value is power x UPTIME, and only the
 * power had ever been priced. These cards were ALREADY charged DC 2 for a slot that did nothing
 * 90-96% of the time, so raising the number does not add power to the deck's budget — it delivers
 * the power the budget had already bought. Charging again would bill the deck twice for one effect.
 *
 * The measurement backs it: the decks are built to the cap with every cheap slot at the 3-copy
 * limit, so +1 DC across nine cards had no legal 40-card solution in wildgrowth, skyfire or
 * dragonspire without cutting distinct cards out of three archetypes. A pricing rule that cannot
 * be paid is a pricing rule that is wrong.
 *
 * SP is where the cost lands, and it is the right currency: since 2026-08-09 a trap pays at SET,
 * so +1 SP makes a mine compete harder with a summon for the same turn. `scorchMine` came DOWN to
 * DC 2 in the same pass so the 30-damage tier prices uniformly.
 *
 * ⚠ THREE DELIBERATE EXCEPTIONS, all asserted by name in content.test.ts:
 *   - `meteor` stays at 20. It is a 2x2, and AREA is the other way to beat the threshold — it
 *     measured 0.77 kills/cast, the best of any damage card. Multiply the targets or raise the
 *     number, not both.
 *   - `scorchMine` stays at 30. It is the precedent.
 *   - `dragonfire` stays at 25. It is not removal: 221 resolutions produced 5,525 LP and ZERO unit
 *     kills — exactly 25.0 per cast, i.e. every copy went at a leader's face. `applyDamage` bills
 *     a leader the raw amount, so a burn card is priced on LP and the floor does not apply.
 *
 * ⚠ The floor also raises every zone trap's leader-chip mode 20 -> 30 LP against a 200 LP pool.
 */
export const DAMAGE_FLOOR = 30;

export function unitDc(atk: number, def: number, piercing = false): number {
  let dc = 1;
  if (atk >= 50) dc += 2;
  else if (atk >= 30) dc += 1;
  const excess = def - defaultDef(atk);
  if (excess >= 45) dc += 3;
  else if (excess >= 30) dc += 2;
  else if (excess >= 15) dc += 1;
  if (piercing) dc += 1;
  return dc;
}

// Deck-local SP pricing over shared poc/simDecks defs (2026-07 economy pass).
// The sim suites keep the original free/level-priced defs; only registered decks re-price.

/** Clone a shared spell def with an activation SP cost. */
export function priceSpell(def: CardDef, sp: number): SpellCardDef {
  if (def.kind !== 'spell') throw new Error(`${def.id} is not a spell`);
  return { ...def, sp };
}

/** Clone a shared unit def with a summon SP cost above its level. */
export function priceUnit(def: CardDef, sp: number): UnitCardDef {
  if (def.kind !== 'unit') throw new Error(`${def.id} is not a unit`);
  return { ...def, sp };
}

/**
 * Clone a shared unit def with a printed DEF, re-billing only the DEF premium.
 *
 * The poc.ts / simDecks.ts fixtures are shared with the sim suites, whose expected numbers are
 * locked against single-stat statlines — so a registered deck that wants a card to be a wall
 * clones it here rather than editing the fixture. The DC delta is computed against the card's
 * OWN previous armour (the round(atk/2) fallback it was already getting), so any premium the
 * original paid for its printed text carries over untouched and only the new armour is charged.
 */
export function armour(def: CardDef, defense: number, sp?: number): UnitCardDef {
  if (def.kind !== 'unit') throw new Error(`${def.id} is not a unit`);
  const pierces = def.keywords.includes('Piercing');
  const delta = unitDc(def.atk, defense, pierces) - unitDc(def.atk, def.def ?? defaultDef(def.atk), pierces);
  return { ...def, def: defense, dc: def.dc + delta, ...(sp === undefined ? {} : { sp }) };
}
