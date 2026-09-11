import { isSick, spellSpCost } from '../../engine';
import type { Action, CardDef, Coord, GameState, PlayerId, SpellCardDef, SpellEffectLine, Unit } from '../../engine';
import type { DetailSubject } from '../CardDetail';
import type { MenuGroup, MenuItem, MenuPage } from './ActionMenu';
import { handPlays } from './handPlays';
import type { HandPlayKind, Playable } from './handPlays';

/**
 * What each of the viewer's own pieces can do, as a menu, keyed by `"col,row"`.
 *
 * Everything offered here is read off the engine's own enumeration (`legal`, and `playable`
 * which comes from the bound enumeration) rather than re-derived from the rules — the same
 * discipline the board's target outline follows, and for the same reason: a second derivation
 * of a rule drifts from the first, and the menu would start offering actions `applyAction`
 * refuses. The costs quoted in a refusal only pick the WORDING; they never decide legality.
 *
 * Iterating the pieces rather than the 49 tiles is deliberate — a menu belongs to a piece, and
 * an empty tile has nothing to say.
 *
 * Note this reaches flip-summoning a face-down UNIT, which had no UI at all before: the command
 * rail's flip row only ever listed face-down SPELLS, so a set unit could only be turned up by
 * being attacked.
 */
export interface TileMenuCtx {
  /** The real state, for legality. */
  game: GameState;
  /** The fogged view, for names — identical to `game` for the viewer's own pieces. */
  view: GameState;
  viewer: PlayerId;
  legal: Action[];
  myTurn: boolean;
  /** True when no action can be taken at all — game over, or a forced hand burn is pending. */
  blocked: boolean;
  /** True while the board is asking for a tile; the menu stands down and Escape cancels. */
  targeting: boolean;
  playable: Playable;
  inspectUnit: (unitId: string) => DetailSubject;
  onAbility: () => void;
  onFlip: (setId: string, effects: SpellEffectLine[]) => void;
  onMoveSet: (setId: string) => void;
  onSummon: (cardId: string) => void;
  onSetCard: (cardId: string, stance?: 'attack' | 'defense') => void;
  onCast: (cardId: string, def: SpellCardDef) => void;
  onDispatch: (a: Action) => void;
  onInspect: (s: DetailSubject) => void;
}

export function buildTileMenus(ctx: TileMenuCtx): Map<string, MenuPage> {
  const menus = new Map<string, MenuPage>();
  const { view, viewer, myTurn, blocked, targeting } = ctx;
  // Not "grey everything out": on the opponent's turn `legal` describes THEIR options, so there
  // is nothing honest to show. The turn banner already says whose turn it is.
  if (!myTurn || blocked || targeting) return menus;

  const key = (c: Coord) => `${c.col},${c.row}`;

  for (const unit of Object.values(view.units)) {
    if (unit.owner !== viewer) continue;
    const groups: MenuGroup[] = unit.isLeader
      ? [{ key: 'leader', items: [abilityItem(ctx), { key: 'play', label: 'Play a card…', icon: 'decks', submenu: handPage(ctx) }] }]
      : [{ key: 'stance', label: 'Position', items: stanceItems(ctx, unit) }];
    groups.push({
      key: 'info',
      items: [{ key: 'details', label: 'Card details', icon: 'info', onSelect: () => ctx.onInspect(ctx.inspectUnit(unit.id)) }],
    });
    menus.set(key(unit.pos), { title: unit.name, groups });
  }

  for (const sc of Object.values(view.setCards)) {
    if (sc.owner !== viewer) continue;
    const def = view.cardDefs[sc.cardId];
    const items: MenuItem[] = [];

    if (def) {
      const canFlip = ctx.legal.some((a) => a.t === 'FlipCard' && a.set === sc.id);
      const cost = def.kind === 'spell' ? spellSpCost(def) : 0;
      items.push({
        key: 'flip',
        // A face-down unit is flip-SUMMONED; a spell simply resolves. Different verbs because
        // they are different moves, and the sickness rules differ between them.
        label: def.kind === 'unit' ? `Flip-summon ${def.name}` : `Flip ${def.name}`,
        icon: 'flip',
        hint: cost > 0 ? `${cost} SP` : undefined,
        disabled: !canFlip,
        reason: canFlip ? undefined : flipReason(def, sc.hasActed, view.players[viewer].sp),
        onSelect: () => ctx.onFlip(sc.id, def.kind === 'spell' ? def.effects : []),
      });
    }

    const canMove = ctx.legal.some((a) => a.t === 'MoveSet' && a.set === sc.id);
    items.push({
      key: 'move',
      label: 'Move it one tile',
      icon: 'move',
      disabled: !canMove,
      reason: canMove ? undefined : sc.hasActed ? 'Already acted this turn.' : 'No open tile beside it.',
      onSelect: () => ctx.onMoveSet(sc.id),
    });

    // Named here, exactly as the command rail has always named the viewer's own face-down
    // spells — it is their card, and they are entitled to know which one they are flipping.
    // No "card details" entry: opening the full card in a modal over a shared hotseat screen
    // is a bigger reveal than a line in the owner's own menu.
    menus.set(key(sc.pos), { title: 'Your face-down card', groups: [{ key: 'set', items }] });
  }

  return menus;
}

function abilityItem(ctx: TileMenuCtx): MenuItem {
  const leader = ctx.view.leaders[ctx.viewer];
  const sp = ctx.view.players[ctx.viewer].sp;
  const can = ctx.legal.some((a) => a.t === 'ActivateAbility');
  return {
    key: 'ability',
    label: `Use ${leader.ability.name}`,
    icon: 'ability',
    hint: `${leader.ability.cost} SP`,
    disabled: !can,
    reason: can ? undefined : `Costs ${leader.ability.cost} SP — you have ${sp}.`,
    onSelect: ctx.onAbility,
  };
}

function stanceItems(ctx: TileMenuCtx, unit: Unit): MenuItem[] {
  const acts = ctx.legal.filter((a): a is Extract<Action, { t: 'SetStance' }> => a.t === 'SetStance' && a.unit === unit.id);
  if (acts.length > 0) {
    return acts.map((a) => ({
      key: a.stance,
      label: a.stance === 'defense' ? 'Take defense stance' : 'Return to attack stance',
      icon: a.stance === 'defense' ? 'defending' : 'game',
      hint: 'uses action',
      onSelect: () => ctx.onDispatch(a),
    }));
  }
  // Kept visible and disabled rather than dropped — same three explanations the command rail's
  // stance panel gives, now attached to the piece they are about.
  return [
    {
      key: 'stance',
      label: unit.stance === 'defense' ? 'Return to attack stance' : 'Take defense stance',
      icon: 'defending',
      disabled: true,
      reason: isSick(unit)
        ? `Still summoning-sick for ${unit.sickTurns} more turn${unit.sickTurns === 1 ? '' : 's'}.`
        : unit.hasActed
          ? 'Already acted this turn.'
          : 'No stance change available.',
    },
  ];
}

function handPage(ctx: TileMenuCtx): MenuPage {
  const ps = ctx.view.players[ctx.viewer];
  // Copies of a card are interchangeable, so they collapse to one group with a count — the same
  // dedupe `legalActions` does over the hand, and it keeps a hand of seven from becoming a
  // twenty-row menu.
  const counts = new Map<string, number>();
  for (const id of ps.hand) counts.set(id, (counts.get(id) ?? 0) + 1);

  // ONE ROW PER CARD, with its plays a page deeper.
  //
  // Every card used to be a GROUP of its two-to-four plays, so a six-card hand opened as
  // eighteen rows under six headings and the last cards were several screens down a scroll.
  // Since the plays are the same three verbs on nearly every card, what the player is
  // actually choosing at this level is the CARD — so that is what this level offers.
  //
  // The cost and the reason a card cannot be played stay HERE rather than moving behind the
  // drill-down: an unaffordable card has to read as unaffordable without opening it, or the
  // collapse would trade scrolling for a guessing game.
  const items: MenuItem[] = [];
  for (const [cardId, n] of counts) {
    const def = ctx.view.cardDefs[cardId];
    if (!def) continue;
    const plays = handPlays(cardId, def, ps.sp, ctx.playable);
    if (plays.length === 0) continue;
    // The play the card is named for — Summon for a unit, Cast for a spell — which is also the
    // cost a player reads off the card itself. `handPlays` always lists it first.
    const primary = plays[0]!;
    const label = n > 1 ? `${def.name} ×${n}` : def.name;
    const row = plays.map((play) => ({
      key: play.kind,
      label: play.long,
      icon: playIcon(play.kind),
      hint: play.cost > 0 ? `${play.cost} SP` : undefined,
      disabled: !play.enabled,
      reason: play.enabled ? undefined : play.title,
      onSelect: () => runPlay(ctx, play.kind, cardId, def),
    }));
    // A trap sets and does nothing else. A one-item page to choose from is a page with no
    // choice on it, so that card acts on selection instead of drilling in.
    if (row.length === 1) {
      items.push({ ...row[0]!, key: cardId, label, hint: primary.cost > 0 ? `${primary.cost} SP` : undefined });
      continue;
    }
    const allBlocked = plays.every((play) => !play.enabled);
    items.push({
      key: cardId,
      label,
      icon: playIcon(primary.kind),
      hint: primary.cost > 0 ? `${primary.cost} SP` : undefined,
      disabled: allBlocked,
      // Only when NOTHING can be done with it — a card that cannot be summoned but can still
      // be set is a live option, and saying "costs 8 SP" on the row would be a lie about the
      // set that is still available underneath.
      reason: allBlocked ? primary.title : undefined,
      submenu: { title: def.name, groups: [{ key: 'plays', items: row }] },
    });
  }

  if (items.length === 0) {
    return { title: 'Play a card', groups: [{ key: 'empty', items: [{ key: 'none', label: 'Your hand is empty.', disabled: true }] }] };
  }
  return { title: 'Play a card', groups: [{ key: 'hand', items }] };
}

function playIcon(kind: HandPlayKind) {
  if (kind === 'summon') return 'game' as const;
  if (kind === 'cast') return 'sigil' as const;
  if (kind === 'setDef') return 'defending' as const;
  return 'decks' as const;
}

function runPlay(ctx: TileMenuCtx, kind: HandPlayKind, cardId: string, def: CardDef): void {
  if (kind === 'summon') return ctx.onSummon(cardId);
  if (kind === 'cast') return ctx.onCast(cardId, def as SpellCardDef);
  if (kind === 'setDef') return ctx.onSetCard(cardId, 'defense');
  return ctx.onSetCard(cardId);
}

function flipReason(def: CardDef, hasActed: boolean, sp: number): string {
  if (hasActed) return 'Already acted this turn.';
  // A trap is never flipped by its owner — it fires off its own trigger, which is the whole
  // reason it is worth setting.
  if (def.kind === 'trap') return 'A trap fires on its own trigger — you cannot turn it up.';
  if (def.kind === 'spell') return `Flipping this costs ${spellSpCost(def)} SP — you have ${sp}.`;
  return 'Cannot be turned up right now.';
}
