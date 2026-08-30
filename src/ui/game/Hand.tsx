import { AnimatePresence, motion } from 'framer-motion';
import { cardSpCost, defaultDef, isMineOnly, setSpCost, unitSpCost } from '../../engine';
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
  playable,
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
  /** Card ids the engine will currently accept each play for — see GameView. */
  playable: { summon: ReadonlySet<string>; cast: ReadonlySet<string>; set: ReadonlySet<string> };
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
            const canSummon = playable.summon.has(cardId);
            const canCast = playable.cast.has(cardId);
            const canSet = playable.set.has(cardId);
            // Why a button is off, when it is. `playable` stays the authority on WHETHER each
            // works; these only pick the wording, from the same costs the engine charges.
            //
            // A SET price is not the price printed on the card: a trap and a mine both prepay at
            // set, and an ordinary board spell sets for nothing. Summoning and casting do charge
            // the printed number, which is `sp` above.
            const setCost = setSpCost(def);
            const short = (cost: number) => ps.sp < cost;
            const summonBlocked = short(sp)
              ? `Summoning this costs ${sp} SP — you have ${ps.sp}.`
              : 'No room: the board is at its unit cap.';
            const castBlocked = short(sp)
              ? `Casting this costs ${sp} SP — you have ${ps.sp}.`
              : 'Nothing on the board can be targeted by this.';
            const setBlocked = short(setCost)
              ? `Setting this costs ${setCost} SP — you have ${ps.sp}.`
              : `No room: the board is at its ${def.kind === 'unit' ? 'unit' : 'set-card'} cap.`;
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
                        <Button
                          size="sm"
                          disabled={!canSummon}
                          title={canSummon ? `Summon face-up for ${sp} SP` : summonBlocked}
                          onClick={() => onSummon(cardId)}
                        >
                          summon
                        </Button>
                      )}
                      {!pendingBurn && myTurn && def.kind === 'spell' && !isMineOnly(def) && (
                        <Button
                          size="sm"
                          disabled={!canCast}
                          title={canCast ? `Cast for ${sp} SP` : castBlocked}
                          onClick={() => onCast(cardId, def)}
                        >
                          cast
                        </Button>
                      )}
                      {/* Any card — unit, spell, or trap — can be set face-down (universal bluff). */}
                      {!pendingBurn && myTurn && (
                        <Button
                          size="sm"
                          disabled={!canSet}
                          title={canSet ? `Set face-down${setCost > 0 ? ` for ${setCost} SP` : ' for free'}` : setBlocked}
                          onClick={() => onSet(cardId)}
                        >
                          set
                        </Button>
                      )}
                      {/* A face-down UNIT picks its stance on the way down. Since 2026-08-16 being
                          hidden is not a posture, so this is the only way a set unit fights on DEF. */}
                      {!pendingBurn && myTurn && def.kind === 'unit' && (
                        <Button
                          size="sm"
                          disabled={!canSet}
                          title={canSet ? 'Set face-down in defense position' : setBlocked}
                          onClick={() => onSet(cardId, 'defense')}
                        >
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
