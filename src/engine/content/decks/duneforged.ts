// Duneforged — the mix-and-match deck: no new cards, no new leader. It borrows
// from three registries (Gravemarch, Skyfire, Hivebrood) under Oskar and bets on
// one cohesive idea: TERRAIN CONVERGENCE. Undead, Insect and Inferno all favor
// Desert (+10), Skyfire's Scorched Earth paints it, and Oskar's aura + Raise
// recursion grind on top. Proof that a cross-archetype pile can still be a deck —
// the glue is the terrain chart, not a tribe.

import { GRAVEMARCH_CARDS, OSKAR } from '../poc';
import { SKYFIRE_CARDS } from '../simDecks';
import { GRAVEMARCH_EXTRA_CARDS } from './gravemarch';
import { SKYFIRE_EXTRA_CARDS } from './skyfire';
import { HIVEBROOD_CARDS } from './hivebrood';
import { dup, type DeckDef } from './deckDef';

export const DUNEFORGED_DECK: DeckDef = {
  id: 'duneforged',
  name: 'Duneforged (Mixed)',
  leader: OSKAR,
  cards: {
    ...GRAVEMARCH_CARDS, ...GRAVEMARCH_EXTRA_CARDS,
    ...SKYFIRE_CARDS, ...SKYFIRE_EXTRA_CARDS,
    ...HIVEBROOD_CARDS,
  },
  list: [
    // Gravemarch core: Desert-native Undead grind + the recursion engine.
    ...dup('carrionSwarm', 3), ...dup('duneshambler', 3), ...dup('sandRevenant', 3),
    ...dup('bonewroughtGolem', 2), ...dup('plagueBearer', 2), ...dup('marrowHound', 2),
    ...dup('raiseTheFallen', 2), ...dup('corpseTithe', 2), ...dup('scorchMine', 2),
    ...dup('suddenInterment', 2),
    // 2026-08-16: the deck runs eleven Undead bodies and trades constantly, so the graveyard
    // threshold is reachable by the midgame — and this pile had 17 DC of budget it was not
    // spending. Paid for by one Stokefire, which is "gain 1 SP, draw 1" for 1 SP, i.e. null-sum
    // (two other decks print the identical card under different names). Corpse Tithe still
    // covers the deck's required economy slot, and does it at +2 SP rather than +1.
    ...dup('theDebtCalled', 2),
    // Skyfire splash: Inferno bodies that ALSO love Desert, and the paint that makes it.
    ...dup('cinderImp', 3), ...dup('magmaWhelp', 2), ...dup('ashenFirebrand', 2),
    ...dup('scorchedEarth', 3), ...dup('backdraft', 2),
    // Hivebrood splash: Ranged Desert-favored chip that ignores strikeback.
    ...dup('venomSpitter', 3),
  ],
  fusionPool: ['plagueTitan'], // carrionSwarm + plagueBearer — both in the list
};
