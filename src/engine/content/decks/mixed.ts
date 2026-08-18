// Mixed — a REALISTIC DEFENSE_EXPERIMENT probe deck (unlike the wall-heavy anvil). A defensive
// backbone behind a real aggro core and a couple of piercers, all under the 110 DC cap.
// Purpose: show that a deck with actual attackers does NOT turtle into the fatigue stall the
// anvil mirror produced. NOT registered in DECKS, but deck-legal — all three probes are held to
// the 40-card / 3-copy / DC rules by content.test.ts.
//
// 2026-07-31 build-out. The old list was forty vanilla units: no spell, no trap, no draw, no
// economy — which made it the least realistic of the three "realistic deck" candidates and left
// its result hard to read (was the game healthy, or was neither side able to do anything?). It
// now runs the same support suite a human would build, drawn from both probe pools, plus two
// cards of its own that state the archetype: bodies whose ATK and DEF are close enough that the
// stance decision is a real one every turn, rather than an obvious one.

import type { CardDef, LeaderDef } from '../../types';
import { unitDc as dc, dup, type DeckDef } from './deckDef';
import { ANVIL_DECK } from './anvil';
import { PIERCER_DECK } from './piercer';

/**
 * No passive, on purpose: Bastion and Vanguard are each pulling their deck hard in one direction,
 * and this deck exists to read the CARDS. A leader with no standing aura keeps that reading clean.
 * The ability is the vault's neutral-pool Rally (Leader Ability Pools.md) — it used to be named
 * Rally while painting Grassland, which told the player nothing true about what it did.
 */
const MARSHAL: LeaderDef = {
  id: 'marshal', name: 'Marshal Kaine', type: 'Warrior', atk: 35,
  rules: [],
  ability: {
    id: 'rally', name: 'Rally', cost: 2, located: false,
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 5, duration: { kind: 'endOfTurn' } },
      target: { t: 'FriendlyOfTypes', types: ['Warrior', 'Beast', 'Fiend', 'Machine', 'Terra'] },
    }],
  },
};

/**
 * Mixed's own cards. Anvil prints ATK << DEF and Piercer prints ATK >> DEF, so in both probes
 * the stance choice is decided at deckbuild time. These two are the midrange case the flag most
 * needs data on: a body that is worth roughly the same attacking or holding, where `SetStance`
 * is a genuine read of the board and not a stat lookup.
 */
const MIXED_CARDS: Record<string, CardDef> = {
  vanguardPikeman: { kind: 'unit', id: 'vanguardPikeman', name: 'Vanguard Pikeman', type: 'Warrior', level: 3, atk: 30, def: 35, dc: dc(30, 35), keywords: [], rules: [] },
  bulwarkRider: { kind: 'unit', id: 'bulwarkRider', name: 'Bulwark Rider', type: 'Beast', level: 4, atk: 40, def: 40, dc: dc(40, 40), keywords: [], rules: [] },
};

export const MIXED_DECK: DeckDef = {
  id: 'mixed', name: 'Mixed (Realistic)', leader: MARSHAL,
  // Reuses the anvil + piercer card pools; the MIX is in the list, plus the two flex bodies above.
  cards: { ...ANVIL_DECK.cards, ...PIERCER_DECK.cards, ...MIXED_CARDS },
  list: [
    // Defensive backbone (8) — enough to wall a lane, not enough to turtle the game. Every one
    // of them is a 2-of or less: this deck holds a line, it does not build a fortress.
    // Boulder Brute went 2 → 1 in the 2026-08-02 card pass: the shared bodies got printed rules
    // and got more expensive with them, and this deck pays the same 110 cap as the other two.
    ...dup('stoneWall', 1), ...dup('ironBulwark', 1), ...dup('sentryGolem', 2),
    ...dup('boulderBrute', 1), ...dup('graniteRampart', 1),
    // Flex core (8) — the archetype. Cairnwright comes from the Anvil pool for the same reason
    // Anvil runs three: the Mountain it paints raises whatever stands there afterwards, and this
    // deck's Terra/Machine half wants that tile as much as Anvil's does.
    ...dup('vanguardPikeman', 3), ...dup('cairnwright', 3), ...dup('bulwarkRider', 2),
    // Aggro core (11) — bodies that WANT to attack, so a defensive equilibrium never forms.
    ...dup('warhound', 3), ...dup('rushBlade', 3), ...dup('skirmisher', 2),
    ...dup('houndmaster', 3), ...dup('berserker', 1),
    // Wall-breakers (3) — the deck can also punch through an opponent's defense.
    ...dup('ironLance', 1), ...dup('voidBreaker', 1),
    // Support (10) — economy, one trick from each side, and a trap package that works whether
    // this deck is the one holding or the one pushing.
    ...dup('warSpoils', 3), ...dup('warcryChant', 2), ...dup('bulwarkRepulse', 2),
    // Stun repricing (2026-08-03) put this at 111. Trimmed a duplicate ironLance for a cheaper
    // skirmisher rather than cutting either stun card — this deck exists to carry a realistic
    // mix, so losing its only Pin Down or Ambush Run would defeat the point.
    // 2026-08-04, the relative DC rubric: pricing armour on its excess over round(atk/2) put
    // this deck at 114/110, all of it in the two shared Anvil walls. Trimmed stoneWall and
    // ironBulwark to a single copy each and spent the slots on reach — which suits Mixed better
    // anyway, since its thesis is a deck that can BOTH hold and push, not a second Anvil.
    ...dup('ambushRun', 1), ...dup('pinDown', 1), ...dup('grapnelYank', 2),
    ...dup('skirmisher', 1),
  ],
  fusionPool: [],
};
