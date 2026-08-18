import { AnimatePresence, motion } from 'framer-motion';
import { cardSpCost, defaultDef, isMineOnly, unitSpCost } from '../../engine';
import type { CardDef, GameState, PlayerId } from '../../engine';
import { Button } from '../components/Button';
import { CardFrame } from '../components/CardFrame';
import { StatChip } from '../components/Chip';
import { Panel } from '../components/Panel';
import type { DetailSubject } from '../CardDetail';

export function Hand({
  view,
  viewer,
  myTurn,
  pendingBurn,
  onInspect,
  onHover,
  onBurn,
  onSummon,
  onCast,
  onSet,
}: {
  view: GameState;
  viewer: PlayerId;
  myTurn: boolean;
  /** True while the hand is over cap and one card must be burned. */
  pendingBurn: boolean;
  onInspect: (s: DetailSubject) => void;
  onHover: (s: DetailSubject | null) => void;
  onBurn: (index: number) => void;
  onSummon: (cardId: string) => void;
  onCast: (cardId: string, def: CardDef) => void;
  onSet: (cardId: string, stance?: 'attack' | 'defense') => void;
}) {
  const ps = view.players[viewer];

  return (
    <Panel
      className="hand-panel"
      title="Hand"
      aside={
        <span className="hand-meta">
          <span>{ps.hand.length} cards</span>
          <span>deck {ps.deck.length}</span>
          {ps.fatigue > 0 && <span className="fatigue">fatigue {ps.fatigue}</span>}
        </span>
      }
    >
      <div className="hand">
        {/*
          AnimatePresence handles cards leaving the hand (played or burned). The
          card is already gone from state when its exit runs — nothing waits on it.
        */}
        <AnimatePresence initial={false} mode="popLayout">
          {ps.hand.map((cardId, i) => {
            const def = view.cardDefs[cardId]!;
            // The over-cap draw is the last card in hand and cannot itself be burned.
            const isIncoming = pendingBurn && i === ps.hand.length - 1;
            const sp = def.kind === 'unit' ? unitSpCost(def) : cardSpCost(def);
            return (
              <motion.div
                key={`${cardId}${i}`}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -24, scale: 0.9 }}
                transition={{ duration: 0.18 }}
              >
                <CardFrame
                  id={cardId}
                  variant="thumb"
                  name={def.name}
                  type={def.kind === 'unit' ? def.type : undefined}
                  cost={sp > 0 ? `${sp} SP` : undefined}
                  highlighted={isIncoming}
                  level={def.kind === 'unit' ? `Lv ${def.level}` : undefined}
                  meta={def.kind === 'unit' ? def.type : def.kind}
                  stats={
                    def.kind === 'unit' ? (
                      <>
                        <StatChip label="ATK" value={def.atk} />
                        <StatChip label="DEF" value={def.def ?? defaultDef(def.atk)} />
                      </>
                    ) : undefined
                  }
                  onClick={() => onInspect({ kind: 'card', def })}
                  onMouseEnter={() => onHover({ kind: 'card', def })}
                  onMouseLeave={() => onHover(null)}
                  actions={
                    <>
                      {pendingBurn && !isIncoming && (
                        <Button size="sm" variant="danger" onClick={() => onBurn(i)}>
                          burn
                        </Button>
                      )}
                      {!pendingBurn && myTurn && def.kind === 'unit' && (
                        <Button size="sm" onClick={() => onSummon(cardId)}>
                          summon
                        </Button>
                      )}
                      {!pendingBurn && myTurn && def.kind === 'spell' && !isMineOnly(def) && (
                        <Button size="sm" onClick={() => onCast(cardId, def)}>
                          cast
                        </Button>
                      )}
                      {/* Any card — unit, spell, or trap — can be set face-down (universal bluff). */}
                      {!pendingBurn && myTurn && (
                        <Button size="sm" onClick={() => onSet(cardId)}>
                          set
                        </Button>
                      )}
                      {/* A face-down UNIT picks its stance on the way down. Since 2026-08-16 being
                          hidden is not a posture, so this is the only way a set unit fights on DEF. */}
                      {!pendingBurn && myTurn && def.kind === 'unit' && (
                        <Button size="sm" onClick={() => onSet(cardId, 'defense')} title="Set face-down in defense position">
                          set def
                        </Button>
                      )}
                    </>
                  }
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
