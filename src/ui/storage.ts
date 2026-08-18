// localStorage persistence for custom boards and decks. UI-side only — the
// engine stays storage-free. Stored decks reference built-in cards by id
// (looked up live in DECK_CARDS so pool changes propagate) and carry full defs
// for their tweaked custom cards.

import { useState } from 'react';
import { DECK_CARDS, DECKS } from '../engine';
import type { BoardLayout, CardDef, DeckDef, LeaderDef } from '../engine';
import type { AiConfig } from './AiSettings';
import type { ExperimentConfig } from './experiments';
import type { MotionSetting } from './motion';

const BOARDS_KEY = 'terraforma.customBoards.v1';
const DECKS_KEY = 'terraforma.customDecks.v1';
const SETUP_KEY = 'terraforma.setup.v1';
const SETTINGS_KEY = 'terraforma.settings.v1';

export type Controller = 'human' | 'ai';

/** The setup screen's full configuration, remembered across visits. */
export interface StoredSetup {
  p1: string;
  p2: string;
  boardId: string;
  c1: Controller;
  c2: Controller;
  ai1: AiConfig;
  ai2: AiConfig;
  speed: number;
  /** Rules-experiment settings (absent in setups saved before the workbench existed). */
  experiments?: ExperimentConfig;
}

export interface StoredBoard {
  id: string;
  name: string;
  layout: BoardLayout;
}

export interface StoredDeck {
  id: string;
  name: string;
  /** One of the built-in DECKS leaders (custom leaders are a non-goal). */
  leaderId: string;
  list: string[];
  fusionPool: string[];
  /** Full tweaked defs keyed by their new ids (not diffs — stable across pool changes). */
  customCards: Record<string, CardDef>;
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
}

function loadList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function saveList<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch (e) {
    console.warn(`failed to persist ${key}`, e);
  }
}

export const loadBoards = (): StoredBoard[] => loadList<StoredBoard>(BOARDS_KEY);
export const saveBoards = (bs: StoredBoard[]): void => saveList(BOARDS_KEY, bs);
export const loadDecks = (): StoredDeck[] => loadList<StoredDeck>(DECKS_KEY);
export const saveDecks = (ds: StoredDeck[]): void => saveList(DECKS_KEY, ds);

function loadObject<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function saveObject<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`failed to persist ${key}`, e);
  }
}

export const loadSetup = (): StoredSetup | undefined => loadObject<StoredSetup>(SETUP_KEY);
export const saveSetup = (setup: StoredSetup): void => saveObject(SETUP_KEY, setup);

// --- App settings ---

/**
 * Preferences that outlive a single game, kept apart from StoredSetup because
 * they apply everywhere (including mid-game and on non-game screens).
 */
export interface StoredSettings {
  /** Animations. `auto` follows prefers-reduced-motion; see src/ui/motion.ts. */
  motion: MotionSetting;
}

export const DEFAULT_SETTINGS: StoredSettings = { motion: 'auto' };

export const loadSettings = (): StoredSettings => ({
  ...DEFAULT_SETTINGS,
  ...loadObject<Partial<StoredSettings>>(SETTINGS_KEY),
});
export const saveSettings = (s: StoredSettings): void => saveObject(SETTINGS_KEY, s);

// --- Online play ---

const ONLINE_SETUP_KEY = 'terraforma.onlineSetup.v1';
const ONLINE_SESSION_KEY = 'terraforma.onlineSession.v1';

/** Last deck/board picked in the online lobby, remembered across visits. */
export interface StoredOnlineSetup {
  deckId?: string;
  boardId?: string;
}

export const loadOnlineSetup = (): StoredOnlineSetup => loadObject<StoredOnlineSetup>(ONLINE_SETUP_KEY) ?? {};
export const saveOnlineSetup = (s: StoredOnlineSetup): void => saveObject(ONLINE_SETUP_KEY, s);

/**
 * Active room membership, kept in sessionStorage (per-tab, so two tabs on one
 * machine hold two different seats) to survive a refresh mid-game.
 */
export interface StoredOnlineSession {
  code: string;
  seat: 0 | 1;
  token: string;
}

export function loadOnlineSession(): StoredOnlineSession | undefined {
  try {
    const raw = sessionStorage.getItem(ONLINE_SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredOnlineSession) : undefined;
  } catch {
    return undefined;
  }
}

export function saveOnlineSession(s: StoredOnlineSession): void {
  try {
    sessionStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('failed to persist online session', e);
  }
}

export function clearOnlineSession(): void {
  try {
    sessionStorage.removeItem(ONLINE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function leaderById(leaderId: string): LeaderDef {
  const found = DECKS.find((d) => d.leader.id === leaderId)?.leader;
  if (!found) {
    console.warn(`unknown leader '${leaderId}' in stored deck — falling back to ${DECKS[0]!.leader.id}`);
    return DECKS[0]!.leader;
  }
  return found;
}

/** Reconstruct a runtime DeckDef: built-in cards looked up live, overlaid with the deck's tweaked defs. */
export function toDeckDef(d: StoredDeck): DeckDef {
  const cards: Record<string, CardDef> = {};
  const wanted = new Set([...d.list, ...d.fusionPool, ...Object.keys(d.customCards)]);
  for (const id of wanted) {
    const def = d.customCards[id] ?? DECK_CARDS[id];
    if (def) cards[id] = def;
    // Unknown ids stay absent — validateDeck reports them as violations.
  }
  // Fusion materials referenced by pool cards must resolve for name display even
  // when missing from the list (validateDeck flags the gameplay gap separately).
  for (const id of d.fusionPool) {
    const def = cards[id];
    if (def?.kind === 'unit' && def.fusion) {
      for (const mat of def.fusion.materials) {
        if (!cards[mat] && DECK_CARDS[mat]) cards[mat] = DECK_CARDS[mat];
      }
    }
  }
  return { id: d.id, name: d.name, leader: leaderById(d.leaderId), cards, list: [...d.list], fusionPool: [...d.fusionPool] };
}

/** App-owned persistent state: setter writes through to localStorage. */
function usePersistentList<T>(load: () => T[], save: (items: T[]) => void): [T[], (items: T[]) => void] {
  const [items, setItems] = useState<T[]>(load);
  return [
    items,
    (next: T[]) => {
      setItems(next);
      save(next);
    },
  ];
}

export const useStoredBoards = () => usePersistentList<StoredBoard>(loadBoards, saveBoards);
export const useStoredDecks = () => usePersistentList<StoredDeck>(loadDecks, saveDecks);

/** App settings, write-through like the lists above. */
export function useStoredSettings(): [StoredSettings, (next: StoredSettings) => void] {
  const [settings, setSettings] = useState<StoredSettings>(loadSettings);
  return [
    settings,
    (next: StoredSettings) => {
      setSettings(next);
      saveSettings(next);
    },
  ];
}
