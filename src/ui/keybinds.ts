// Board keyboard bindings — the single place that decides which key does what on the grid.
//
// Only the commands that have no universal convention are bindable. Arrow keys, Home/End,
// Enter and Space are the ARIA grid contract and stay fixed: a player who rebound them would
// be left with a grid that no longer behaves like one, and screen-reader users would lose the
// behaviour their software already tells them to expect.
//
// A binding is stored as a canonical DESCRIPTOR — modifiers in a fixed order, then the key
// ("A", "Shift+F10", "ContextMenu", "/"). That is what makes a binding comparable, storable
// and printable without keeping a KeyboardEvent around.

/** A board command the player may put on a key of their choosing. */
export type BoardCommand = 'actions' | 'cancel';

export type Keybinds = Record<BoardCommand, string>;

export interface KeybindSpec {
  command: BoardCommand;
  label: string;
  hint: string;
  /**
   * Keys that work for this command NO MATTER what the player binds.
   *
   * Not "extra defaults" — these are platform gestures that already mean this command
   * everywhere else. The Menu key and Shift+F10 are what a keyboard or an assistive tool
   * emits for "context menu", and Escape is the universal way out of anything. Taking either
   * away because someone picked a comfier key would be a trap, and the player gains nothing
   * by removing them.
   */
  always: readonly string[];
}

export const KEYBIND_SPECS: readonly KeybindSpec[] = [
  {
    command: 'actions',
    label: 'Open a piece’s actions',
    hint: 'On the focused tile, opens the same menu as its ⋯ button and a right-click.',
    always: ['ContextMenu', 'Shift+F10'],
  },
  {
    command: 'cancel',
    label: 'Cancel / deselect',
    hint: 'Backs out of a summon, a set, or a half-picked spell.',
    always: ['Escape'],
  },
];

export const DEFAULT_KEYBINDS: Keybinds = {
  actions: 'A',
  cancel: 'Escape',
};

/**
 * Keys the board needs for itself. Bindable keys are checked against this, so a player cannot
 * quietly break grid navigation from the settings screen.
 */
const RESERVED: Record<string, string> = {
  ArrowUp: 'moves the board cursor',
  ArrowDown: 'moves the board cursor',
  ArrowLeft: 'moves the board cursor',
  ArrowRight: 'moves the board cursor',
  Home: 'jumps to the first tile',
  End: 'jumps to the last tile',
  Enter: 'acts on the focused tile',
  Space: 'acts on the focused tile',
  Tab: 'moves between panels',
};

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * The canonical descriptor for a key press, or null when there is nothing to bind — a bare
 * modifier (the player is still mid-chord), or a key the browser could not identify.
 */
export function describeKeyEvent(e: KeyLike): string | null {
  const { key } = e;
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return null;
  if (key === 'Dead' || key === 'Unidentified') return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Meta');
  if (e.shiftKey) parts.push('Shift');
  // A single character is upper-cased so `a` and `A` are one binding; `Shift` is still
  // recorded separately, so Shift+A remains distinct from A.
  parts.push(key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}

const KEY_NAMES: Record<string, string> = {
  Escape: 'Esc',
  ContextMenu: 'Menu',
  Meta: '⌘',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** A descriptor as a player should read it: `Shift+F10` → `Shift + F10`. */
export function keyLabel(descriptor: string): string {
  return descriptor
    .split('+')
    .map((part) => KEY_NAMES[part] ?? part)
    .join(' + ');
}

/**
 * Which command this key press triggers, if any.
 *
 * The player's own binding is checked before the always-on gestures so that a binding always
 * wins for its own command; `keybindProblem` is what stops the two sets overlapping in the
 * first place.
 */
export function matchBoardCommand(e: KeyLike, binds: Keybinds): BoardCommand | null {
  const pressed = describeKeyEvent(e);
  if (pressed === null) return null;
  for (const spec of KEYBIND_SPECS) {
    if (binds[spec.command] === pressed) return spec.command;
  }
  for (const spec of KEYBIND_SPECS) {
    if (spec.always.includes(pressed)) return spec.command;
  }
  return null;
}

/**
 * Why this key cannot be bound to this command, or null if it can.
 *
 * Returns a sentence rather than a boolean: "that key is taken" is only useful if it says by
 * what, and a refusal the player cannot act on reads as a broken control.
 */
export function keybindProblem(command: BoardCommand, key: string, binds: Keybinds): string | null {
  const reserved = RESERVED[key];
  if (reserved) return `${keyLabel(key)} ${reserved}.`;
  // Left alone on purpose: these are the browser's and the OS's, and a game that swallows
  // ⌘W or Ctrl+T is a game the player cannot get out of.
  if (key.startsWith('Ctrl+') || key.startsWith('Meta+')) {
    return 'Ctrl and ⌘ combinations belong to the browser.';
  }
  for (const spec of KEYBIND_SPECS) {
    if (spec.command === command) continue;
    if (binds[spec.command] === key) return `Already bound to “${spec.label}”.`;
    if (spec.always.includes(key)) return `${keyLabel(key)} always means “${spec.label}”.`;
  }
  return null;
}

/** Every key that currently runs a command, for the settings screen's summary line. */
export function bindingsFor(command: BoardCommand, binds: Keybinds): string[] {
  const spec = KEYBIND_SPECS.find((s) => s.command === command)!;
  const chosen = binds[command];
  return spec.always.includes(chosen) ? [...spec.always] : [chosen, ...spec.always];
}
