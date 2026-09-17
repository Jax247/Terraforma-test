import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DetailSubject } from '../CardDetail';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';

/**
 * The action menu a board piece opens over itself.
 *
 * This exists because everything a piece can do that ISN'T "move there" lived off the board
 * entirely — the leader's ability and the flip buttons in the command rail, summon/set/cast on
 * the hand cards. All of it was tabbable, but a keyboard player had to leave the grid, hunt
 * down the right button in a rail on the far side of the screen, act, and then find their way
 * back to where they were. The menu brings those same actions to the piece they belong to.
 *
 * It is a menu, not a dialog: it does not trap Tab, and it closes on Escape, on an outside
 * click, and as soon as one of its items runs. Board owns the open/closed state and puts focus
 * back on the tile afterwards, so the grid's roving cursor never ends up somewhere else than
 * the focus ring.
 *
 * ⚠ Items are NEVER hidden when unavailable — they are `aria-disabled` and carry a visible
 * reason. "The button is gone" teaches a player nothing; "Costs 3 SP — you have 1" does, and
 * it reads to a screen reader as part of the item's own name rather than as a hover tooltip.
 */
export interface MenuItem {
  key: string;
  label: string;
  icon?: IconName;
  /** Right-aligned annotation — an SP cost, mostly. */
  hint?: string;
  disabled?: boolean;
  /** Why it is off. Rendered under the label, so it is visible AND announced. */
  reason?: string;
  /**
   * The card, leader or token this item is about.
   *
   * Every item names a play, and a play is only worth choosing if you can see what you are
   * playing — the level, the stats, the rules text. While the item holds the roving cursor its
   * subject is shown in full beside the menu, so reading a card no longer means backing out of
   * the menu to hover it in the hand. Same subject shape the detail rail and the modal take,
   * so all three describe a card identically.
   */
  detail?: DetailSubject;
  onSelect?: () => void;
  /**
   * Drill-down page. Selecting pushes it over the current one rather than running `onSelect`.
   *
   * A push rather than a flyout: a second floating panel has to be positioned against the
   * first, which is already positioned against a tile that may be at the edge of the board —
   * and on a phone there is nowhere for it to fly out TO.
   */
  submenu?: MenuPage;
}

export interface MenuGroup {
  key: string;
  /** Optional heading. Also the group's accessible name. */
  label?: string;
  items: MenuItem[];
}

export interface MenuPage {
  title: string;
  groups: MenuGroup[];
}

export function ActionMenu({
  page,
  /** The element to sit over — the TILE, not the small button that opened it. */
  anchor,
  onClose,
  renderPreview,
}: {
  page: MenuPage;
  anchor: HTMLElement | null;
  onClose: () => void;
  /**
   * Renders the focused item's `detail` into the card panel beside the menu. A render prop
   * rather than the card body itself, because the body needs a `NameResolver` off the game
   * state and the menu has no business holding one.
   */
  renderPreview?: (subject: DetailSubject) => ReactNode;
}) {
  // A stack rather than a single page, so "Play a card…" can be walked into and backed out of.
  const [stack, setStack] = useState<MenuPage[]>([page]);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number } | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const current = stack[stack.length - 1]!;
  const depth = stack.length;
  const count = current.groups.reduce((n, g) => n + g.items.length, 0);

  // What the cursor is on, and therefore what the preview describes. Focus and hover both
  // drive `active`, so the card follows either one.
  const activeItem = flatten(current)[active];
  const preview = activeItem?.detail && renderPreview ? renderPreview(activeItem.detail) : null;

  /**
   * Sit ABOVE the piece by preference: the menu is about the card under it, and covering that
   * card with the menu describing it is the one placement that can't work. Flips below only
   * when there genuinely isn't room, and clamps to the viewport either way.
   *
   * `depth` is a dependency because walking into a sub-page changes the panel's height, and a
   * menu anchored above must be re-measured or it drifts off its piece.
   */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const a = anchor.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const margin = 8;
    const above = a.top - p.height - margin;
    const top = above >= margin ? above : Math.min(a.bottom + margin, window.innerHeight - p.height - margin);
    const left = Math.min(Math.max(margin, a.left + a.width / 2 - p.width / 2), window.innerWidth - p.width - margin);
    setPos({ top: Math.max(margin, top), left: Math.max(margin, left) });
  }, [anchor, depth]);

  /**
   * The preview sits BESIDE the menu — to its right by preference, to its left when the menu is
   * near the right edge, and nowhere at all when neither side fits (a phone, mostly, where the
   * board's own `Card details` item still opens the modal).
   *
   * Beside rather than inside: the menu is anchored over a piece and is already as tall as the
   * hand is long, and growing it by a card's height would push it off its own piece.
   *
   * Keyed on the item rather than on `detail` itself — the menus are rebuilt every render (see
   * GameView), so the subject is a fresh object each time and a dependency on it would re-run
   * this effect forever.
   */
  const previewKey = preview ? `${depth}:${activeItem?.key ?? ''}` : '';
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const card = previewRef.current;
    if (!pos || !panel || !card) {
      setPreviewPos(null);
      return;
    }
    const p = panel.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const margin = 8;
    const right = p.right + margin;
    const left = right + c.width <= window.innerWidth - margin ? right : p.left - margin - c.width;
    if (left < margin) {
      setPreviewPos(null);
      return;
    }
    // Top-aligned with the menu, then pulled back up the screen if the card is the taller of
    // the two — a preview running off the bottom is a preview you cannot read.
    const top = Math.max(margin, Math.min(p.top, window.innerHeight - c.height - margin));
    // ⚠ Bail out when nothing moved. This effect runs on every render of a component whose
    // parent rebuilds its props each time, and returning a fresh object unconditionally would
    // be a render loop.
    setPreviewPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, [pos, depth, previewKey]);

  /**
   * Focus follows the roving index.
   *
   * `depth` is a dependency because a new page reuses index 0 — the index alone does not
   * change, so the effect would not fire and focus would stay on the parent page's item.
   *
   * ⚠ `placed` is a dependency because the panel is `visibility: hidden` until it has been
   * measured, and focus cannot enter a hidden subtree — the call silently does nothing. On
   * first open that is exactly the state this effect would otherwise run in, which left the
   * grid holding focus and sent every arrow key meant for the menu to the board underneath.
   */
  const placed = pos !== null;
  useEffect(() => {
    if (!placed) return;
    itemRefs.current[active]?.focus();
  }, [active, depth, placed]);

  useEffect(() => {
    // The preview counts as part of the menu for both of these: it is the menu's own panel,
    // just parked next to it, so clicking or scrolling it must not be read as "elsewhere".
    const inside = (target: Node | null) =>
      Boolean(panelRef.current?.contains(target) || previewRef.current?.contains(target));
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target as Node)) onClose();
    };
    // Re-anchoring on scroll is more trouble than it's worth; close instead. Same call the
    // Popover makes, for the same reason.
    //
    // ⚠ But NOT when the panel is scrolling ITSELF. This listener is in the capture phase on
    // window — scroll does not bubble, which is the only way to see a descendant scrolling at
    // all — so it also saw the menu's own scroll region and closed the menu the instant it
    // moved. A long menu was therefore unusable in two different ways: the wheel shut it, and
    // so did arrowing past the last visible item, because focusing an item scrolls it into
    // view and that scroll is indistinguishable from a page scroll.
    //
    // The panel is a real scroll region (`max-height` + `overflow-y: auto` in _game.scss), so
    // the fix is simply to let it scroll: only a scroll that started OUTSIDE it means the menu
    // has drifted off the piece it is anchored to.
    const onScroll = (e: Event) => {
      if (inside(e.target as Node)) return;
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  function pop() {
    if (depth === 1) return onClose();
    setStack((s) => s.slice(0, -1));
    setActive(0);
  }

  function activate(item: MenuItem) {
    if (item.disabled) return;
    if (item.submenu) {
      setStack((s) => [...s, item.submenu!]);
      setActive(0);
      return;
    }
    item.onSelect?.();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // The board grid is listening for arrows and Escape too. Nothing here may reach it — an
    // ArrowDown meant for the menu must not also walk the grid cursor down a row underneath.
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
        handled();
        return setActive((i) => (i + 1) % count);
      case 'ArrowUp':
        handled();
        return setActive((i) => (i - 1 + count) % count);
      case 'Home':
        handled();
        return setActive(0);
      case 'End':
        handled();
        return setActive(count - 1);
      case 'ArrowRight': {
        const item = flatten(current)[active];
        if (!item?.submenu || item.disabled) return;
        handled();
        return activate(item);
      }
      case 'ArrowLeft':
      case 'Backspace':
        if (depth === 1) return;
        handled();
        return pop();
      case 'Escape':
        handled();
        return pop();
      case 'Tab':
        // A menu is not a tab stop set. Leaving it closes it.
        handled();
        return onClose();
      default:
        return;
    }
  }

  // Reset the ref array each render so a shortened page can't leave a stale node behind for an
  // index that no longer exists.
  itemRefs.current = [];
  let index = -1;

  return createPortal(
    <>
      <div
        ref={panelRef}
        className="action-menu"
        role="menu"
        aria-label={current.title}
        onKeyDown={onKeyDown}
        // Hidden until measured, so it never flashes at 0,0.
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
      >
        <div className="action-menu-head">
          {depth > 1 && (
            <button type="button" className="action-menu-back" aria-label="Back" onClick={pop}>
              <Icon name="back" size={13} />
            </button>
          )}
          <span className="action-menu-title">{current.title}</span>
        </div>

        {current.groups.map((group) => (
          <div key={group.key} role="group" aria-label={group.label} className="action-menu-group">
            {group.label && <div className="action-menu-group-label">{group.label}</div>}
            {group.items.map((item) => {
              index += 1;
              const at = index;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  ref={(el) => {
                    itemRefs.current[at] = el;
                  }}
                  // `aria-disabled`, not `disabled`: an unavailable item stays focusable so its
                  // reason is reachable and announced, which is the whole point of showing it.
                  aria-disabled={item.disabled || undefined}
                  aria-haspopup={item.submenu ? 'menu' : undefined}
                  tabIndex={at === active ? 0 : -1}
                  className={clsx('action-menu-item', item.disabled && 'action-menu-item-off')}
                  onClick={() => activate(item)}
                  onMouseEnter={() => setActive(at)}
                >
                  <span className="action-menu-icon">{item.icon && <Icon name={item.icon} size={13} />}</span>
                  <span className="action-menu-body">
                    <span className="action-menu-label">{item.label}</span>
                    {item.reason && <span className="action-menu-reason">{item.reason}</span>}
                  </span>
                  {item.hint && <span className="action-menu-hint">{item.hint}</span>}
                  {item.submenu && <Icon name="submenu" size={13} className="action-menu-chevron" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {preview && (
        /*
         * `aria-hidden`, deliberately. The item itself already announces its label, its cost and
         * the sentence saying why it is unavailable; re-reading a whole card body on every arrow
         * key would bury that. The panel is what the EYE gets, not a second announcement.
         */
        <div
          ref={previewRef}
          className="action-menu-preview"
          aria-hidden="true"
          style={{
            top: previewPos?.top ?? -9999,
            left: previewPos?.left ?? -9999,
            visibility: previewPos ? 'visible' : 'hidden',
          }}
        >
          {preview}
        </div>
      )}
    </>,
    document.body,
  );
}

function flatten(page: MenuPage): MenuItem[] {
  return page.groups.flatMap((g) => g.items);
}

/** The ⋯ affordance on a piece. Mouse and touch parity for the keyboard's Actions key. */
export function ActionMenuButton({
  label,
  open,
  onOpen,
}: {
  /** Names the piece, so the button reads as "Actions for Sand Wraith". */
  label: string;
  open: boolean;
  onOpen: (anchor: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className="tile-actions"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`Actions for ${label}`}
      onClick={(e) => {
        // The tile beneath would otherwise take this as a click on itself and select the piece.
        e.stopPropagation();
        // Anchor on the TILE: the menu is placed over the card, not over this 14px button.
        onOpen((e.currentTarget.closest('.tile') as HTMLElement | null) ?? e.currentTarget);
      }}
      // Enter/Space here must open the menu, not fall through to the tile's own handler.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Icon name="actions" size={11} />
    </button>
  );
}
