// TEST-ONLY content: the extra decks sims 4–9 introduced (Tidecaller, Ironworks,
// Duskweave, Vanguard, Skyfire, Greenwarden). Cards are data; the UI never ships these —
// scope discipline keeps the playable POC to Wildgrowth vs Gravemarch.

import type { CardDef, LeaderDef } from '../types';

// --- Tidecaller (sim 4, sim 7) — Aqua displacement control -----------------

export const TIDECALLER_CARDS: Record<string, CardDef> = {
  riptideNaga: {
    kind: 'unit', id: 'riptideNaga', name: 'Riptide Naga', type: 'Aqua', level: 4, atk: 35,
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'Pull', tiles: 1 }, target: { t: 'ChosenEnemy' } }],
  },
  tidePriest: {
    kind: 'unit', id: 'tidePriest', name: 'Tide Priest', type: 'Aqua', level: 3, atk: 30,
    keywords: [], rules: [],
  },
  leviathan: {
    kind: 'unit', id: 'leviathan', name: 'Leviathan', type: 'Aqua', level: 0, atk: 70,
    keywords: [], rules: [],
    fusion: { materials: ['riptideNaga', 'tidePriest'] },
  },
  undertow: {
    kind: 'spell', id: 'undertow', name: 'Undertow', scope: 'located',
    effects: [{ effect: { e: 'Push', tiles: 2 }, target: { t: 'ChosenUnit' } }],
  },
  maelstrom: {
    kind: 'spell', id: 'maelstrom', name: 'Maelstrom', scope: 'located',
    effects: [{ effect: { e: 'Push', tiles: 1 }, target: { t: 'Area3x3' } }],
  },
};

export const NERIS: LeaderDef = {
  id: 'neris', name: 'Neris, the Tidecaller', type: 'Aqua', atk: 25,
  rules: [
    { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'FriendlyOfTypesOnTerrain', types: ['Aqua'], terrain: 'Sea' } },
    { trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Sea' }, target: { t: 'TilesMovedThrough' } },
  ],
  // Sim 7 active: Maelstrom, 6 SP, located (leader must bring it into reach).
  ability: {
    id: 'maelstromAbility', name: 'Maelstrom', cost: 6, located: true, anchor: 'leader',
    effects: [{ effect: { e: 'Push', tiles: 1 }, target: { t: 'Area3x3' } }],
  },
};

// --- Ironworks (sim 6) — Machine fusion go-tall -----------------------------

export const IRONWORKS_CARDS: Record<string, CardDef> = {
  gearhulk: {
    kind: 'unit', id: 'gearhulk', name: 'Gearhulk', type: 'Machine', level: 5, atk: 45,
    keywords: [], rules: [],
  },
  pistonKnight: {
    kind: 'unit', id: 'pistonKnight', name: 'Piston Knight', type: 'Machine', level: 4, atk: 35,
    keywords: [], rules: [],
  },
  rivetDrone: {
    kind: 'unit', id: 'rivetDrone', name: 'Rivet Drone', type: 'Machine', level: 2, atk: 20,
    keywords: [], rules: [],
  },
  ironColossus: {
    kind: 'unit', id: 'ironColossus', name: 'Colossus', type: 'Machine', level: 0, atk: 75,
    keywords: [], rules: [],
    fusion: { materials: ['gearhulk', 'pistonKnight'] },
  },
};

export const COGSWORTH: LeaderDef = {
  id: 'cogsworth', name: 'Cogsworth', type: 'Machine', atk: 25,
  rules: [
    { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'FriendlyOfTypesOnTerrain', types: ['Machine'], terrain: 'Mountain' } },
  ],
  // Assemble: fuse two adjacent friendly Machines without spending their moves.
  // TODO(open): reach of Assemble unspecified — POC treats it as global.
  ability: {
    id: 'assemble', name: 'Assemble', cost: 4, located: false,
    effects: [{ effect: { e: 'FuseAdjacentFriendly' }, target: { t: 'ChosenUnit' } }],
  },
};

// --- Duskweave (sim 8) — Spellcaster/Fiend control-combo --------------------

export const DUSKWEAVE_CARDS: Record<string, CardDef> = {
  hexblade: {
    kind: 'unit', id: 'hexblade', name: 'Hexblade', type: 'Fiend', level: 3, atk: 30,
    keywords: [], rules: [],
  },
  nullAdept: {
    kind: 'unit', id: 'nullAdept', name: 'Null Adept', type: 'Spellcaster', level: 2, atk: 25,
    keywords: [], rules: [],
  },
  shadowSnare: {
    kind: 'trap', id: 'shadowSnare', name: 'Shadow Snare', interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{
      effect: { e: 'ApplyStatus', status: 'Immobilized', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'TriggeringUnit' },
    }],
  },
  mirrorTrap: {
    kind: 'trap', id: 'mirrorTrap', name: 'Mirror Trap', interrupt: 'negate',
    trigger: { t: 'enemyActivatesSpell' },
    effects: [{ effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
  hexMine: {
    kind: 'spell', id: 'hexMine', name: 'Hex Mine', scope: 'located',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: -20, duration: { kind: 'endOfTurn' } },
      target: { t: 'TriggeringUnit' },
    }],
  },
  doomshift: {
    kind: 'spell', id: 'doomshift', name: 'Doomshift', scope: 'located', ascension: true,
    effects: [{ effect: { e: 'Transform', atk: 60 }, target: { t: 'ChosenUnit' } }],
  },
  // Sim 8 also fields a destroy-the-attacker trap shape to prove `negate`:
  spikePit: {
    kind: 'trap', id: 'spikePit', name: 'Spike Pit', interrupt: 'negate',
    trigger: { t: 'enemyAttacksFriendly' },
    effects: [{ effect: { e: 'Destroy' }, target: { t: 'Attacker' } }],
  },
};

export const VAEL: LeaderDef = {
  id: 'vael', name: 'Vael', type: 'Spellcaster', atk: 20,
  rules: [
    { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'FriendlyOfTypesOnTerrain', types: ['Spellcaster', 'Fiend'], terrain: 'Shadow' } },
  ],
  ability: {
    id: 'wither', name: 'Wither', cost: 3, located: true, anchor: 'leader',
    // "until your next turn" ≈ 2 owner-turn ticks with the POC status clock.
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: -10, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'ChosenEnemy' },
    }],
  },
};

// --- Vanguard (sim 8) — Warrior aggro ---------------------------------------

export const VANGUARD_CARDS: Record<string, CardDef> = {
  legionnaire: {
    kind: 'unit', id: 'legionnaire', name: 'Legionnaire', type: 'Warrior', level: 4, atk: 45,
    keywords: [], rules: [],
  },
  skirmisher: {
    kind: 'unit', id: 'skirmisher', name: 'Skirmisher', type: 'Warrior', level: 2, atk: 25,
    keywords: [], rules: [],
  },
};

export const RURIK: LeaderDef = {
  id: 'rurik', name: 'Rurik', type: 'Warrior', atk: 30,
  rules: [
    { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'FriendlyOfTypesOnTerrain', types: ['Warrior'], terrain: 'Grassland' } },
  ],
  ability: {
    id: 'rallyCry', name: 'Rally', cost: 2, located: false,
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 5, duration: { kind: 'endOfTurn' } },
      target: { t: 'FriendlyOfTypes', types: ['Warrior'] },
    }],
  },
};

// --- Skyfire (sim 9) — Avian/Inferno aggro-tempo ----------------------------

export const SKYFIRE_CARDS: Record<string, CardDef> = {
  emberhawk: {
    kind: 'unit', id: 'emberhawk', name: 'Emberhawk', type: 'Avian', level: 3, atk: 30,
    keywords: ['Ranged'], rules: [],
  },
  cinderImp: {
    kind: 'unit', id: 'cinderImp', name: 'Cinder Imp', type: 'Inferno', level: 2, atk: 25,
    keywords: [], rules: [],
  },
  blazingRoc: {
    kind: 'unit', id: 'blazingRoc', name: 'Blazing Roc', type: 'Avian', level: 4, atk: 40,
    keywords: [], rules: [],
  },
  pyreWarden: {
    kind: 'unit', id: 'pyreWarden', name: 'Pyre Warden', type: 'Inferno', level: 3, atk: 35,
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'Damage', amount: 10 }, target: { t: 'AdjacentEnemies' } }],
  },
  meteor: {
    kind: 'spell', id: 'meteor', name: 'Meteor', scope: 'located',
    effects: [{ effect: { e: 'Damage', amount: 20 }, target: { t: 'Area2x2' } }],
  },
};

export const KAELEN: LeaderDef = {
  id: 'kaelen', name: 'Kaelen', type: 'Avian', atk: 25,
  rules: [
    // Punish-passive: +5 when attacking a unit that hasn't moved this turn.
    {
      trigger: 'Passive',
      effect: { e: 'AuraAtk', amount: 5 },
      target: { t: 'FriendlyOfTypes', types: ['Avian', 'Inferno'] },
      condition: { k: 'DefenderUnmovedThisTurn' },
    },
  ],
  ability: {
    id: 'divebomb', name: 'Divebomb', cost: 2, located: true, anchor: 'leader',
    effects: [{ effect: { e: 'GrantMove', tiles: 2 }, target: { t: 'ChosenUnit' } }],
  },
};

// --- Greenwarden (sim 9) — Verdant/Terra midrange ----------------------------

export const GREENWARDEN_CARDS: Record<string, CardDef> = {
  bulwarkGolem: {
    kind: 'unit', id: 'bulwarkGolem', name: 'Bulwark Golem', type: 'Terra', level: 3, atk: 30,
    keywords: ['Rooted'], rules: [],
  },
  stoneWarden: {
    kind: 'unit', id: 'stoneWarden', name: 'Stone Warden', type: 'Terra', level: 4, atk: 35,
    keywords: [], rules: [],
  },
  elderTreant: {
    kind: 'unit', id: 'elderTreant', name: 'Elder Treant', type: 'Verdant', level: 5, atk: 45,
    keywords: [], rules: [],
  },
};

export const THANE: LeaderDef = {
  id: 'thane', name: 'Thane, Greenwarden', type: 'Terra', atk: 25,
  rules: [
    { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'FriendlyOfTypesOnTerrain', types: ['Terra'], terrain: 'Mountain' } },
  ],
  ability: {
    id: 'bulwark', name: 'Bulwark', cost: 3, located: true, anchor: 'leader',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 10, duration: { kind: 'endOfTurn' } },
      target: { t: 'ChosenUnit' },
    }],
  },
};

export const ALL_SIM_CARDS: Record<string, CardDef> = {
  ...TIDECALLER_CARDS,
  ...IRONWORKS_CARDS,
  ...DUSKWEAVE_CARDS,
  ...VANGUARD_CARDS,
  ...SKYFIRE_CARDS,
  ...GREENWARDEN_CARDS,
};
