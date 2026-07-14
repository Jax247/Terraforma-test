// Hardcoded POC content: Wildgrowth vs Gravemarch + the suggested sim map.
// From "Simulation Content — Wildgrowth vs Gravemarch.md". Cards are data, not code.

import { makeBoard } from '../board';
import type { Board, CardDef, Coord, LeaderDef, TokenDef } from '../types';

export const WILDGROWTH_CARDS: Record<string, CardDef> = {
  thornfang: {
    kind: 'unit', id: 'thornfang', name: 'Thornfang', type: 'Beast', level: 3, atk: 30,
    keywords: [],
    rules: [{ trigger: 'OnKill', effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'DestinationTile' } }],
  },
  grovecaller: {
    kind: 'unit', id: 'grovecaller', name: 'Grovecaller', type: 'Verdant', level: 4, atk: 25,
    keywords: [],
    rules: [{
      trigger: 'Passive',
      effect: { e: 'AuraAtkPerCount', amount: 5, count: { c: 'TerrainTilesAround', terrain: 'Forest' } },
      target: { t: 'Self' },
    }],
  },
  mosshideBull: {
    kind: 'unit', id: 'mosshideBull', name: 'Mosshide Bull', type: 'Beast', level: 5, atk: 45,
    keywords: [], rules: [],
  },
  saplingSentry: {
    kind: 'unit', id: 'saplingSentry', name: 'Sapling Sentry', type: 'Verdant', level: 2, atk: 20,
    keywords: ['Rooted'], rules: [],
  },
  apexPredator: {
    kind: 'unit', id: 'apexPredator', name: 'Apex Predator', type: 'Beast', level: 0, atk: 70,
    keywords: [], rules: [],
    fusion: { materials: ['thornfang', 'mosshideBull'] },
  },
  verdantSurge: {
    kind: 'spell', id: 'verdantSurge', name: 'Verdant Surge', scope: 'located',
    effects: [{ effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'Line3' } }],
  },
  snareVine: {
    kind: 'trap', id: 'snareVine', name: 'Snare Vine', interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{
      effect: { e: 'ApplyStatus', status: 'Immobilized', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'TriggeringUnit' },
    }],
  },
  wildAwakening: {
    kind: 'spell', id: 'wildAwakening', name: 'Wild Awakening', scope: 'located', ascension: true,
    // Frenzy here is the LOCKED redefinition (+5/adjacent ally), not the superseded no-strikeback one.
    effects: [{ effect: { e: 'Transform', atk: 60, addKeywords: ['Frenzy'] }, target: { t: 'ChosenUnit' } }],
  },
};

export const GRAVEMARCH_CARDS: Record<string, CardDef> = {
  duneshambler: {
    kind: 'unit', id: 'duneshambler', name: 'Duneshambler', type: 'Undead', level: 3, atk: 30,
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'SummonToken', tokenId: 'husk', count: 1 }, target: { t: 'EmptyTileNear' } }],
  },
  graveTyrant: {
    kind: 'unit', id: 'graveTyrant', name: 'Grave Tyrant', type: 'Undead', level: 6, atk: 55,
    keywords: [],
    rules: [{
      trigger: 'OnSummon',
      effect: { e: 'Destroy' },
      target: { t: 'ChosenEnemy' },
      condition: { k: 'EffAtkAtMost', amount: 20 },
    }],
  },
  carrionSwarm: {
    kind: 'unit', id: 'carrionSwarm', name: 'Carrion Swarm', type: 'Insect', level: 2, atk: 15,
    keywords: ['Frenzy'], rules: [],
  },
  sandRevenant: {
    kind: 'unit', id: 'sandRevenant', name: 'Sand Revenant', type: 'Undead', level: 4, atk: 35,
    keywords: [],
    rules: [{
      trigger: 'Passive',
      effect: { e: 'AuraAtkPerCount', amount: 5, count: { c: 'TypeInOwnGraveyard', type: 'Undead' } },
      target: { t: 'Self' },
    }],
  },
  dreadColossus: {
    kind: 'unit', id: 'dreadColossus', name: 'Dread Colossus', type: 'Undead', level: 0, atk: 75,
    keywords: [], rules: [],
    fusion: { materials: ['duneshambler', 'sandRevenant'] },
  },
  raiseTheFallen: {
    kind: 'spell', id: 'raiseTheFallen', name: 'Raise the Fallen', scope: 'global',
    effects: [{ effect: { e: 'RaiseFromGraveyard', type: 'Undead' }, target: { t: 'ChosenUnit' } }],
  },
  scorchMine: {
    kind: 'spell', id: 'scorchMine', name: 'Scorch Mine', scope: 'located',
    effects: [{ effect: { e: 'Damage', amount: 30 }, target: { t: 'TriggeringUnit' } }],
  },
  graspOfTheDead: {
    kind: 'trap', id: 'graspOfTheDead', name: 'Grasp of the Dead', interrupt: 'respond',
    trigger: { t: 'enemyAttacksFriendly' },
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: -20, duration: { kind: 'endOfTurn' } },
      target: { t: 'Attacker' },
    }],
  },
};

export const POC_TOKENS: Record<string, TokenDef> = {
  husk: { id: 'husk', name: 'Husk', type: 'Undead', atk: 10, keywords: [] },
  sapling: { id: 'sapling', name: 'Sapling', type: 'Verdant', atk: 10, keywords: ['Rooted'] },
};

export const BRIAR: LeaderDef = {
  id: 'briar', name: 'Briar, the Wildshepherd', type: 'Verdant', atk: 20,
  rules: [
    { trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'TilesMovedThrough' } },
    { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'FriendlyOfTypesOnTerrain', types: ['Beast', 'Verdant'], terrain: 'Forest' } },
  ],
  // Chosen active for the POC (matches sim 5): Overgrowth, 3 SP, located, anchored to friendly units.
  ability: {
    id: 'overgrowth', name: 'Overgrowth', cost: 3, located: true, anchor: 'friendlyUnit',
    effects: [{ effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'Line3' } }],
  },
};

export const OSKAR: LeaderDef = {
  id: 'oskar', name: 'Oskar, the Pale Shepherd', type: 'Undead', atk: 25,
  rules: [
    { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'FriendlyOfTypesOnTerrain', types: ['Undead'], terrain: 'Desert' } },
    { trigger: 'OnCapture', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
  ],
  // Chosen active for the POC (matches sim 5): Raise, 5 SP, located (summon zone is inherently in reach).
  ability: {
    id: 'raise', name: 'Raise', cost: 5, located: true, anchor: 'leader',
    effects: [{ effect: { e: 'RaiseFromGraveyard', type: 'Undead' }, target: { t: 'ChosenUnit' } }],
  },
};

/**
 * Suggested sim map: symmetric across row 4. Springs (2,4)/(6,4) on Normal;
 * 2-tile Forest patches near each flank on rows 2/6; a Desert band across
 * columns 3–5 on rows 3/5; Shadow corners; rest Normal/Grassland.
 */
export function makePocBoard(): Board {
  return makeBoard((c: Coord) => {
    if ((c.row === 2 || c.row === 6) && (c.col === 1 || c.col === 2)) return 'Forest';
    if ((c.row === 3 || c.row === 5) && c.col >= 3 && c.col <= 5) return 'Desert';
    if ((c.row === 1 || c.row === 7) && (c.col === 1 || c.col === 7)) return 'Shadow';
    if (c.row === 4 && (c.col === 1 || c.col === 7)) return 'Grassland';
    return 'Normal';
  });
}

const dup = (id: string, n: number): string[] => Array.from({ length: n }, () => id);

/** 40-card Wildgrowth deck list (3-of cap respected via padding with vanilla bodies). */
export function wildgrowthDeck(): string[] {
  return [
    ...dup('thornfang', 3), ...dup('grovecaller', 3), ...dup('mosshideBull', 3),
    ...dup('saplingSentry', 3), ...dup('verdantSurge', 3), ...dup('snareVine', 3),
    ...dup('wildAwakening', 2),
    // POC filler to reach a playable deck size: repeat the core (throwaway content).
    ...dup('thornfang', 3), ...dup('saplingSentry', 3), ...dup('mosshideBull', 3),
    ...dup('grovecaller', 3), ...dup('verdantSurge', 3), ...dup('snareVine', 2),
    ...dup('wildAwakening', 1),
  ];
}

export function gravemarchDeck(): string[] {
  return [
    ...dup('duneshambler', 3), ...dup('graveTyrant', 2), ...dup('carrionSwarm', 3),
    ...dup('sandRevenant', 3), ...dup('raiseTheFallen', 3), ...dup('scorchMine', 3),
    ...dup('graspOfTheDead', 3),
    ...dup('duneshambler', 3), ...dup('carrionSwarm', 3), ...dup('sandRevenant', 3),
    ...dup('scorchMine', 2), ...dup('graveTyrant', 2), ...dup('graspOfTheDead', 2),
  ];
}

export const POC_CARDS: Record<string, CardDef> = { ...WILDGROWTH_CARDS, ...GRAVEMARCH_CARDS };
