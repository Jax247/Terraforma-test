import { effectiveAtk, effectiveDef, isSick } from '../../engine';
import type { Action, GameState, LeaderDef, SetCard, SpellCardDef, Unit } from '../../engine';
import { Button } from '../components/Button';
import { StatChip, Tag } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Panel } from '../components/Panel';
import type { DetailSubject } from '../CardDetail';

/** Stance controls for the selected unit. Absent for leaders, which never defend. */
export function StancePanel({
  game,
  unit,
  actions,
  myTurn,
  onDispatch,
}: {
  game: GameState;
  unit: Unit;
  actions: Extract<Action, { t: 'SetStance' }>[];
  myTurn: boolean;
  onDispatch: (a: Action) => void;
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
        <div className="button-row">
          {actions.map((a) => (
            <Button
              key={a.stance}
              size="sm"
              disabled={!myTurn}
              title="Changing stance uses this unit's action for the turn"
              onClick={() => onDispatch(a)}
            >
              {a.stance === 'defense' ? 'Take defense stance' : 'Return to attack stance'}
            </Button>
          ))}
        </div>
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

/** Leader ability, plus the flip buttons for this player's face-down spells. */
export function LeaderPanel({
  leader,
  sp,
  myTurn,
  setSpells,
  cardDefs,
  onActivate,
  onFlip,
  onInspect,
}: {
  leader: LeaderDef;
  sp: number;
  myTurn: boolean;
  setSpells: SetCard[];
  cardDefs: GameState['cardDefs'];
  onActivate: () => void;
  onFlip: (setId: string, def: SpellCardDef) => void;
  onInspect: (s: DetailSubject) => void;
}) {
  return (
    <Panel
      title="Leader ability"
      aside={
        <Button size="sm" variant="ghost" aria-label="Leader details" onClick={() => onInspect({ kind: 'leader', def: leader })}>
          <Icon name="info" size={14} />
        </Button>
      }
    >
      <Button block disabled={sp < leader.ability.cost || !myTurn} onClick={onActivate}>
        {leader.ability.name} ({leader.ability.cost} SP)
      </Button>

      {setSpells.length > 0 && (
        <div className="button-row flip-row">
          {setSpells.map((sc) => {
            const def = cardDefs[sc.cardId] as SpellCardDef;
            return (
              <Button key={sc.id} size="sm" onClick={() => onFlip(sc.id, def)}>
                flip {def.name} @({sc.pos.col},{sc.pos.row})
              </Button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
