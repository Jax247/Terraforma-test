import { describe, expect, it } from 'vitest';
import {
  bindingsFor,
  DEFAULT_KEYBINDS,
  describeKeyEvent,
  keybindProblem,
  keyLabel,
  matchBoardCommand,
} from '../keybinds';
import type { Keybinds } from '../keybinds';

/** A KeyboardEvent's worth of fields, with every modifier off unless named. */
const press = (key: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('describeKeyEvent', () => {
  it('upper-cases single characters so `a` and `A` are one binding', () => {
    expect(describeKeyEvent(press('a'))).toBe('A');
    expect(describeKeyEvent(press('A', { shiftKey: true }))).toBe('Shift+A');
  });

  it('names the space bar rather than emitting a bare space', () => {
    expect(describeKeyEvent(press(' '))).toBe('Space');
  });

  it('orders modifiers so the same chord always produces the same descriptor', () => {
    expect(describeKeyEvent(press('K', { shiftKey: true, altKey: true, ctrlKey: true }))).toBe('Ctrl+Alt+Shift+K');
  });

  it('returns null mid-chord, so holding Shift does not bind Shift', () => {
    expect(describeKeyEvent(press('Shift', { shiftKey: true }))).toBeNull();
    expect(describeKeyEvent(press('Control', { ctrlKey: true }))).toBeNull();
    expect(describeKeyEvent(press('Unidentified'))).toBeNull();
  });
});

describe('matchBoardCommand', () => {
  it('runs the bound key', () => {
    expect(matchBoardCommand(press('a'), DEFAULT_KEYBINDS)).toBe('actions');
    expect(matchBoardCommand(press('Escape'), DEFAULT_KEYBINDS)).toBe('cancel');
  });

  it('keeps the platform gestures alive whatever the player bound', () => {
    const rebound: Keybinds = { actions: 'Q', cancel: 'Shift+Z' };
    expect(matchBoardCommand(press('q'), rebound)).toBe('actions');
    expect(matchBoardCommand(press('ContextMenu'), rebound)).toBe('actions');
    expect(matchBoardCommand(press('F10', { shiftKey: true }), rebound)).toBe('actions');
    // Escape is the universal way out and is never taken away by a rebind.
    expect(matchBoardCommand(press('Escape'), rebound)).toBe('cancel');
    expect(matchBoardCommand(press('Z', { shiftKey: true }), rebound)).toBe('cancel');
  });

  it('leaves the old key alone once it has been rebound', () => {
    expect(matchBoardCommand(press('a'), { actions: 'Q', cancel: 'Escape' })).toBeNull();
  });

  it('ignores the grid keys and anything unbound', () => {
    for (const key of ['ArrowUp', 'Enter', ' ', 'Tab', 'z']) {
      expect(matchBoardCommand(press(key), DEFAULT_KEYBINDS)).toBeNull();
    }
  });

  it('does not fire on a modified copy of a bound key', () => {
    expect(matchBoardCommand(press('a', { ctrlKey: true }), DEFAULT_KEYBINDS)).toBeNull();
  });
});

describe('keybindProblem', () => {
  it('protects the grid contract', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Space', 'Tab']) {
      expect(keybindProblem('actions', key, DEFAULT_KEYBINDS)).toBeTruthy();
    }
  });

  it('leaves Ctrl and ⌘ chords to the browser', () => {
    expect(keybindProblem('actions', 'Ctrl+K', DEFAULT_KEYBINDS)).toMatch(/browser/);
    expect(keybindProblem('actions', 'Meta+K', DEFAULT_KEYBINDS)).toMatch(/browser/);
    // Alt and Shift are the player's to spend.
    expect(keybindProblem('actions', 'Alt+K', DEFAULT_KEYBINDS)).toBeNull();
    expect(keybindProblem('actions', 'Shift+K', DEFAULT_KEYBINDS)).toBeNull();
  });

  it('refuses a key another command already owns, and says which', () => {
    const binds: Keybinds = { actions: 'Q', cancel: 'Escape' };
    expect(keybindProblem('cancel', 'Q', binds)).toMatch(/Already bound/);
    // A command may always be re-confirmed on the key it already has.
    expect(keybindProblem('actions', 'Q', binds)).toBeNull();
  });

  it("refuses a key that is another command's permanent gesture", () => {
    // Never bindable elsewhere — but which sentence you get depends on why. On the defaults
    // Escape is also cancel's CHOSEN key, so the more specific "already bound" wins.
    expect(keybindProblem('actions', 'Escape', DEFAULT_KEYBINDS)).toMatch(/Already bound/);
    // Move cancel off Escape and the permanent-gesture branch is what refuses it.
    expect(keybindProblem('actions', 'Escape', { actions: 'A', cancel: 'Shift+Z' })).toMatch(/always means/);
    expect(keybindProblem('cancel', 'ContextMenu', DEFAULT_KEYBINDS)).toMatch(/always means/);
  });

  it('accepts an ordinary key', () => {
    expect(keybindProblem('actions', 'Q', DEFAULT_KEYBINDS)).toBeNull();
    expect(keybindProblem('actions', '/', DEFAULT_KEYBINDS)).toBeNull();
  });
});

describe('bindingsFor', () => {
  it('lists the chosen key first, then the permanent gestures', () => {
    expect(bindingsFor('actions', { actions: 'Q', cancel: 'Escape' })).toEqual(['Q', 'ContextMenu', 'Shift+F10']);
  });

  it('does not list the chosen key twice when it IS a permanent gesture', () => {
    expect(bindingsFor('cancel', DEFAULT_KEYBINDS)).toEqual(['Escape']);
  });
});

describe('keyLabel', () => {
  it('spells a chord out and gives the odd keys readable names', () => {
    expect(keyLabel('Shift+F10')).toBe('Shift + F10');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('ContextMenu')).toBe('Menu');
    expect(keyLabel('A')).toBe('A');
  });
});
