import { unitSpCost } from '../engine';
import type { CardDef, GameState, PlayerId } from '../engine';
import { Modal } from './Modal';
import type { DetailSubject } from './CardDetail';

function kindTag(def: CardDef): string {
  return def.kind === 'unit' ? `${def.type} · Lv ${def.level} · ${unitSpCost(def)} SP · ATK ${def.atk}` : def.kind;
}

export function ZoneModal({
  game,
  player,
  zone,
  onClose,
  onInspect,
  pick,
}: {
  game: GameState;
  player: PlayerId;
  zone: 'deck' | 'graveyard';
  onClose: () => void;
  onInspect: (s: DetailSubject) => void;
  /**
   * Turns the browser into a PICKER for the card-choice pass (a chosen Raise, or a `Search` in
   * 'choose' mode). `only` is the set of ids the action will actually accept — everything else is
   * still listed, greyed and inert, so the player can see the whole zone while being shown exactly
   * what is legal. Absent = the ordinary read-only browser.
   */
  pick?: { prompt: string; only: string[]; onPick: (cardId: string) => void };
}) {
  const ids = game.players[player][zone];
  const title = pick
    ? `${pick.prompt} — ${zone} (${ids.length})`
    : `P${player + 1} ${game.leaders[player].name} — ${zone} (${ids.length})`;
  const pickable = pick ? new Set(pick.only) : undefined;

  // Deck contents are shown grouped and name-sorted so the hotseat opponent
  // (and the owner) never learn the draw order. Graveyard order is public.
  let rows: { key: string; def: CardDef; label: string; count?: number }[];
  if (zone === 'deck') {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    rows = [...counts.entries()]
      .map(([id, count]) => {
        const def = game.cardDefs[id]!;
        return { key: id, def, label: def.name, count };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } else {
    rows = [...ids].reverse().map((id, i) => {
      const def = game.cardDefs[id]!;
      return { key: `${id}-${i}`, def, label: def.name + (i === 0 ? ' (top)' : '') };
    });
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="zone-list">
        {rows.length === 0 && <div className="line">Empty.</div>}
        {rows.map((row) => {
          const canPick = pickable?.has(row.def.id) ?? false;
          return (
            <div
              key={row.key}
              className={`zone-row${pick ? (canPick ? ' pickable' : ' unpickable') : ''}`}
              onClick={() => {
                onInspect({ kind: 'card', def: row.def });
                if (canPick) pick!.onPick(row.def.id);
              }}
            >
              <span>
                {row.label}
                {row.count !== undefined && <b className="count"> ×{row.count}</b>}
              </span>
              <span className="stat">{kindTag(row.def)}</span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
