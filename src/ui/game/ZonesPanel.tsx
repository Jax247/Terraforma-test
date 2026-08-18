import type { GameState, PlayerId } from '../../engine';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import type { DetailSubject } from '../CardDetail';

export function ZonesPanel({
  view,
  seat,
  onOpenZone,
  onInspect,
}: {
  view: GameState;
  /** Online only: the fixed local seat. The opponent's deck is count-only. */
  seat?: PlayerId | undefined;
  onOpenZone: (player: PlayerId, zone: 'deck' | 'graveyard') => void;
  onInspect: (s: DetailSubject) => void;
}) {
  return (
    <Panel title="Zones">
      {([0, 1] as PlayerId[]).map((p) => {
        const ps = view.players[p];
        const deckHidden = seat !== undefined && p !== seat;
        return (
          <div key={p} className="zones-row">
            <span className="zones-seat">P{p + 1}</span>

            {deckHidden ? (
              <span className="panel-note">deck ({ps.deck.length})</span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => onOpenZone(p, 'deck')}>
                deck ({ps.deck.length})
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onOpenZone(p, 'graveyard')}>
              grave ({ps.graveyard.length})
            </Button>

            <span className="zones-fusion">
              fusion:
              {ps.fusionPool.length === 0
                ? ' —'
                : ps.fusionPool.map((id, i) => (
                    <Button
                      key={`${id}${i}`}
                      size="sm"
                      variant="ghost"
                      onClick={() => onInspect({ kind: 'card', def: view.cardDefs[id]! })}
                    >
                      {view.cardDefs[id]!.name}
                    </Button>
                  ))}
            </span>
          </div>
        );
      })}
    </Panel>
  );
}
