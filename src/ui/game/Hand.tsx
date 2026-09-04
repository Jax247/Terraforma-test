import { AnimatePresence, motion } from 'framer-motion';
import { cardSpCost, defaultDef, unitSpCost } from '../../engine';
import type { CardDef, GameState, PlayerId } from '../../engine';
import { Button } from '../components/Button';
import { CardFrame } from '../components/CardFrame';
import { StatChip } from '../components/Chip';
import { Panel } from '../components/Panel';
import type { DetailSubject } from '../CardDetail';
import { useGameMotionDuration } from '../motion';
import { handPlays } from './handPlays';
import type { Playable } from './handPlays';

/**
 * A stable React key per card in hand.
 *
 * `PlayerState.hand` is a bare list of card DEF ids with duplicates allowed (see
 * engine/types.ts) — there is no per-copy instance id to key off. The obvious
 * `${cardId}${index}` is worse than no key at all: playing anything but the last
 * card shifts every card after it down one index, so every one of their keys
 * changes and React unmounts and remounts the entire tail. AnimatePresence then
 * sees the whole hand exit and a near-identical hand enter, on every single play.
 * Under `mode="popLayout"` the leavers are taken out of flow and stacked, so at AI
 * speed they pile up faster than they can finish leaving — a five-card hand was
 * measured holding 11 nodes on Watchable, 27 on Fast and 95 on Instant, smeared
 * over each other in the middle of the row.
 *
 * Numbering each duplicate instead means a card's key depends only on the copies of
 * ITSELF that precede it, so playing one card leaves every other card's key alone.
 * Copies of the same def are interchangeable, so which one is treated as leaving
 * does not matter — they render identically.
 */
function handKeys(hand: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return hand.map((cardId) => {
    const n = seen.get(cardId) ?? 0;
    seen.set(cardId, n + 1);
    return `${cardId}#${n}`;
  });
}

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
  playable: Playable;
  onInspect: (s: DetailSubject) => void;
  onHover: (s: DetailSubject | null) => void;
  onBurn: (index: number) => void;
  onSummon: (cardId: string) => void;
  onCast: (cardId: string, def: CardDef) => void;
  onSet: (cardId: string, stance?: 'attack' | 'defense') => void;
}) {
  const ps = view.players[viewer];
  const keys = handKeys(ps.hand);
  // 0 when motion is off, which is also what lets a leaver be REMOVED rather than
  // linger absolutely-positioned over the row; see useGameMotionDuration.
  const duration = useGameMotionDuration(0.18);

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
            // Which plays this card offers, whether each is available, and the sentence
            // explaining a refusal — all shared with the board's action menu, so a card greyed
            // out in one is greyed out in the other for the identical stated reason.
            const plays = handPlays(cardId, def, ps.sp, playable);
            return (
              <motion.div
                key={keys[i]}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -24, scale: 0.9 }}
                transition={{ duration }}
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
                      {!pendingBurn &&
                        myTurn &&
                        plays.map((play) => (
                          <Button
                            key={play.kind}
                            size="sm"
                            disabled={!play.enabled}
                            title={play.title}
                            onClick={() => {
                              if (play.kind === 'summon') onSummon(cardId);
                              else if (play.kind === 'cast') onCast(cardId, def);
                              else onSet(cardId, play.kind === 'setDef' ? 'defense' : undefined);
                            }}
                          >
                            {play.short}
                          </Button>
                        ))}
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
