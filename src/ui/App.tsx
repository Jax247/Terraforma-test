import { useMemo, useState } from 'react';
import {
  applyAction,
  BRIAR,
  effectiveAtk,
  gravemarchDeck,
  initGame,
  legalActions,
  makePocBoard,
  OSKAR,
  POC_CARDS,
  POC_TOKENS,
  sameCoord,
  tileAt,
  wildgrowthDeck,
} from '../engine';
import type { Action, CardDef, Coord, GameState, SpellCardDef, Terrain } from '../engine';

const TERRAIN_COLOR: Record<Terrain, string> = {
  Normal: '#cfc8b8',
  Forest: '#4e8f4a',
  Mountain: '#9c8b72',
  Sea: '#4a7fc4',
  Grassland: '#a4c26a',
  Desert: '#dbb96a',
  Shadow: '#6b5a8a',
  Sanctuary: '#efe3ac',
};

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function newGame(): GameState {
  return initGame({
    board: makePocBoard(),
    cardDefs: POC_CARDS,
    tokenDefs: POC_TOKENS,
    players: [
      { leader: BRIAR, deck: shuffle(wildgrowthDeck()), fusionPool: ['apexPredator'] },
      { leader: OSKAR, deck: shuffle(gravemarchDeck()), fusionPool: ['dreadColossus'] },
    ],
  });
}

/** How many chosen tiles an effect list needs (POC target-picking). */
function targetsNeeded(effects: { target: { t: string } }[]): number {
  let n = 0;
  for (const line of effects) {
    const t = line.target.t;
    if (t === 'Line3') n = Math.max(n, 3);
    if (t === 'ChosenUnit' || t === 'ChosenEnemy' || t === 'Area2x2' || t === 'Area3x3') n = Math.max(n, 1);
  }
  return n;
}

function cardEffects(def: CardDef): { target: { t: string } }[] {
  if (def.kind === 'unit') return [];
  return def.effects;
}

/** A face-down located spell that only targets its triggering unit is a mine: set it, don't cast it. */
function isMineOnly(def: CardDef): boolean {
  return def.kind === 'spell' && def.effects.every((l) => l.target.t === 'TriggeringUnit');
}

type Targeting =
  | { kind: 'summon'; card: string }
  | { kind: 'set'; card: string }
  | { kind: 'cast'; card: string; needed: number; picked: Coord[] }
  | { kind: 'flip'; set: string; needed: number; picked: Coord[] }
  | { kind: 'ability'; needed: number; picked: Coord[] }
  | { kind: 'moveset'; set: string };

export function App() {
  const [game, setGame] = useState<GameState>(newGame);
  const [selected, setSelected] = useState<string | null>(null); // unit id
  const [targeting, setTargeting] = useState<Targeting | null>(null);
  const [error, setError] = useState('');

  const legal = useMemo(() => legalActions(game), [game]);
  const active = game.active;
  const ps = game.players[active];
  const leader = game.leaders[active];

  function dispatch(a: Action) {
    try {
      setGame(applyAction(game, a));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSelected(null);
    setTargeting(null);
  }

  function clickTile(c: Coord) {
    if (game.phase === 'gameover') return;
    // Target-picking flows first.
    if (targeting) {
      if (targeting.kind === 'summon') return dispatch({ t: 'Summon', card: targeting.card, tile: c });
      if (targeting.kind === 'set') return dispatch({ t: 'SetCard', card: targeting.card, tile: c });
      if (targeting.kind === 'moveset') return dispatch({ t: 'MoveSet', set: targeting.set, to: c });
      const picked = [...targeting.picked, c];
      if (picked.length < targeting.needed) {
        setTargeting({ ...targeting, picked });
        return;
      }
      if (targeting.kind === 'cast') return dispatch({ t: 'CastSpell', card: targeting.card, targets: picked });
      if (targeting.kind === 'flip') return dispatch({ t: 'FlipCard', set: targeting.set, targets: picked });
      if (targeting.kind === 'ability') return dispatch({ t: 'ActivateAbility', targets: picked });
      return;
    }
    const occ = tileAt(game.board, c).occupant;
    // Select own unit / set card.
    if (occ?.kind === 'unit' && game.units[occ.id]!.owner === active && selected !== occ.id) {
      setSelected(occ.id);
      return;
    }
    if (occ?.kind === 'set' && game.setCards[occ.id]!.owner === active) {
      setTargeting({ kind: 'moveset', set: occ.id });
      setSelected(null);
      return;
    }
    // Move the selected unit.
    if (selected) {
      dispatch({ t: 'Move', unit: selected, to: c });
      return;
    }
    setSelected(null);
  }

  const moveTargets: Coord[] = selected
    ? legal.filter((a): a is Extract<Action, { t: 'Move' }> => a.t === 'Move' && a.unit === selected).map((a) => a.to)
    : [];

  const selectedSetForFlip = Object.values(game.setCards).filter(
    (sc) => sc.owner === active && game.cardDefs[sc.cardId]!.kind === 'spell',
  );

  const prompt =
    targeting === null
      ? selected
        ? 'Click a highlighted tile to move / attack / fuse.'
        : ''
      : targeting.kind === 'summon'
        ? 'Click an empty tile in the leader ring to summon.'
        : targeting.kind === 'set'
          ? 'Click an empty tile in the leader ring to set face-down.'
          : targeting.kind === 'moveset'
            ? 'Click an adjacent empty tile to move the face-down card (1 tile).'
            : `Pick ${targeting.needed - targeting.picked.length} more target tile(s).`;

  return (
    <div className="app">
      {game.winner !== undefined && (
        <div className="winner">
          Player {game.winner + 1} ({game.leaders[game.winner].name}) wins!&nbsp;
          <button onClick={() => setGame(newGame())}>New game</button>
        </div>
      )}
      <div>
        <div className="board">
          {Array.from({ length: 7 }, (_, rowIdx) => 7 - rowIdx).map((row) =>
            Array.from({ length: 7 }, (_, colIdx) => colIdx + 1).map((col) => {
              const c = { col, row };
              const tile = tileAt(game.board, c);
              const occ = tile.occupant;
              const unit = occ?.kind === 'unit' ? game.units[occ.id] : undefined;
              const isSel = unit && selected === unit.id;
              const isMove = moveTargets.some((m) => sameCoord(m, c));
              const isPicked = targeting && 'picked' in targeting && targeting.picked.some((p) => sameCoord(p, c));
              return (
                <div
                  key={`${col},${row}`}
                  className={`tile${isMove ? ' highlight' : ''}${isSel ? ' selected' : ''}${isPicked ? ' targeting' : ''}`}
                  style={{ background: TERRAIN_COLOR[tile.terrain] }}
                  onClick={() => clickTile(c)}
                  title={`(${col},${row}) ${tile.terrain}${tile.spring ? tile.springActive ? ' · spring (active)' : ' · spring (dormant)' : ''}`}
                >
                  <span className="coord">{col},{row}</span>
                  {tile.spring && <span className="spring">{tile.springActive ? '💧' : '🕳️'}</span>}
                  {unit && (
                    <div className={`unit p${unit.owner}${unit.summoningSick ? ' sick' : ''}${unit.isLeader ? ' leader' : ''}`}>
                      <span className="atk">
                        {unit.isLeader ? '👑' : ''}
                        {effectiveAtk(game, unit)}
                      </span>
                      <span className="tag">{unit.name}</span>
                    </div>
                  )}
                  {occ?.kind === 'set' && <div className="facedown">🂠</div>}
                </div>
              );
            }),
          )}
        </div>
      </div>

      <div className="side">
        <div className="panel statusline">
          <span className="big">P{active + 1} · {leader.name}</span>
          <span>turn {ps.turnCount}</span>
          <span>SP <b>{ps.sp}</b></span>
          <span>LP <b>{game.players[0].leaderLife}</b> vs <b>{game.players[1].leaderLife}</b></span>
          <button onClick={() => dispatch({ t: 'EndTurn' })}>End turn</button>
        </div>
        <div className="prompt">{prompt}</div>
        <div className="error">{error}</div>

        <div className="panel">
          <h3>Hand ({ps.hand.length}) — deck {ps.deck.length}</h3>
          <div className="hand">
            {ps.hand.map((cardId, i) => {
              const def = game.cardDefs[cardId]!;
              return (
                <div key={`${cardId}${i}`} className="card">
                  <div>
                    {def.name} {def.kind === 'unit' && <span className="cost">Lv{def.level}</span>}
                  </div>
                  <div style={{ opacity: 0.7 }}>
                    {def.kind === 'unit' ? `${def.type} · ATK ${def.atk}` : def.kind}
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {def.kind === 'unit' && (
                      <button className="small" onClick={() => setTargeting({ kind: 'summon', card: cardId })}>
                        summon
                      </button>
                    )}
                    {def.kind === 'spell' && !isMineOnly(def) && (
                      <button
                        className="small"
                        onClick={() => {
                          const needed = targetsNeeded(cardEffects(def));
                          if (needed === 0) dispatch({ t: 'CastSpell', card: cardId });
                          else setTargeting({ kind: 'cast', card: cardId, needed, picked: [] });
                        }}
                      >
                        cast
                      </button>
                    )}
                    {def.kind !== 'unit' && (
                      <button className="small" onClick={() => setTargeting({ kind: 'set', card: cardId })}>
                        set
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h3>Leader ability</h3>
          <button
            disabled={ps.sp < leader.ability.cost}
            onClick={() => {
              const needed = targetsNeeded(leader.ability.effects);
              if (needed === 0) dispatch({ t: 'ActivateAbility' });
              else setTargeting({ kind: 'ability', needed, picked: [] });
            }}
          >
            {leader.ability.name} ({leader.ability.cost} SP)
          </button>
          {selectedSetForFlip.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {selectedSetForFlip.map((sc) => {
                const def = game.cardDefs[sc.cardId] as SpellCardDef;
                return (
                  <button
                    key={sc.id}
                    className="small"
                    onClick={() => {
                      const needed = targetsNeeded(def.effects);
                      if (needed === 0) dispatch({ t: 'FlipCard', set: sc.id });
                      else setTargeting({ kind: 'flip', set: sc.id, needed, picked: [] });
                    }}
                  >
                    flip {def.name} @({sc.pos.col},{sc.pos.row})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <h3>Zones</h3>
          <div style={{ fontSize: 12 }}>
            P1 fusion: {game.players[0].fusionPool.map((id) => game.cardDefs[id]!.name).join(', ') || '—'} · grave{' '}
            {game.players[0].graveyard.length}
            <br />
            P2 fusion: {game.players[1].fusionPool.map((id) => game.cardDefs[id]!.name).join(', ') || '—'} · grave{' '}
            {game.players[1].graveyard.length}
          </div>
        </div>

        <div className="panel">
          <h3>Log</h3>
          <div className="log">
            {game.log.slice(-14).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
