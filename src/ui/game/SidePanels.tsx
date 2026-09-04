import { effectiveAtk, effectiveDef, isSick } from '../../engine';
import type { Action, GameState, LeaderDef, SetCard, Unit } from '../../engine';
import { Button } from '../components/Button';
import { StatChip, Tag } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Panel } from '../components/Panel';
import type { DetailSubject } from '../CardDetail';

/**
 * ⚠ Both panels below are READ-ONLY as of the board action menu.
 *
 * Stance, the leader ability and the set-spell flips used to be buttons here, a rail's width
 * away from the pieces they act on — the leader's ability sat in the far corner of the screen
 * from the leader. Every one of those controls now lives on the piece itself, in the menu its
 * ⋯ button (or the Actions key) opens; see `game/tileMenus.ts`.
 *
 * What stays is the readout, which the board has no room for: the numbers, the posture, and
 * where this player's face-down spells actually are.
 */

/** A line pointing at the piece that now owns the controls this panel used to have. */
function MenuHint({ children }: { children: string }) {
  return (
    <div className="panel-note panel-hint">
      <Icon name="actions" size={12} />
      <span>{children}</span>
    </div>
  );
}

/** Stats and posture for the selected unit. Absent for leaders, which never defend. */
export function StancePanel({
  game,
  unit,
  actions,
}: {
  game: GameState;
  unit: Unit;
  /** The stance changes the engine currently allows — read only to word the note. */
  actions: Extract<Action, { t: 'SetStance' }>[];
}) {
  return (
    <Panel title={`Stance — ${unit.name}`}>
      <div className="stance-line">
        <StatChip label="ATK" value={effectiveAtk(game, unit)} />
        <StatChip label="DEF" value={effectiveDef(game, unit)} />
        <Tag tone={unit.stance === 'defense' ? 'ok' : 'default'}>
          <Icon name={unit.stance === 'defense' ? 'defending' : 'game'} size={11} />
          {unit.stance === 'defense' ? 'Defending' : 'Attacking'}
        </Tag>
      </div>

      {actions.length > 0 ? (
        <MenuHint>Change stance from this unit's own actions on the board.</MenuHint>
      ) : (
        <div className="panel-note">
          {isSick(unit)
            ? `Still summoning-sick for ${unit.sickTurns} more turn${unit.sickTurns === 1 ? '' : 's'}.`
            : unit.hasActed
              ? 'Already acted this turn.'
              : 'No stance change available.'}
        </div>
      )}
    </Panel>
  );
}

/** The leader's ability, and where this player's face-down spells are sitting. */
export function LeaderPanel({
  leader,
  sp,
  setSpells,
  cardDefs,
  onInspect,
}: {
  leader: LeaderDef;
  sp: number;
  setSpells: SetCard[];
  cardDefs: GameState['cardDefs'];
  onInspect: (s: DetailSubject) => void;
}) {
  const affordable = sp >= leader.ability.cost;
  return (
    <Panel
      title="Leader ability"
      aside={
        <Button size="sm" variant="ghost" aria-label="Leader details" onClick={() => onInspect({ kind: 'leader', def: leader })}>
          <Icon name="info" size={14} />
        </Button>
      }
    >
      <div className="stance-line">
        <Tag tone={affordable ? 'ok' : 'default'}>
          <Icon name="ability" size={11} />
          {leader.ability.name}
        </Tag>
        <StatChip label="SP" value={leader.ability.cost} />
      </div>
      <MenuHint>
        {affordable
          ? 'Use it from your leader’s own actions on the board.'
          : `Not affordable yet — you have ${sp} SP.`}
      </MenuHint>

      {setSpells.length > 0 && (
        <>
          {/* Kept as a readout because the board deliberately does not name a face-down card:
              this is the one place the owner can see which of theirs is where, without having
              to walk the grid tile by tile. */}
          <div className="panel-note">Your face-down spells</div>
          <ul className="setspell-list">
            {setSpells.map((sc) => (
              <li key={sc.id}>
                <span>{cardDefs[sc.cardId]!.name}</span>
                <span className="setspell-at">
                  {sc.pos.col},{sc.pos.row}
                </span>
              </li>
            ))}
          </ul>
          <MenuHint>Flip one from its own actions on the board.</MenuHint>
        </>
      )}
    </Panel>
  );
}
