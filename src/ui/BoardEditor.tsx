import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { arenaLayout, boardFromLayout, describeSigil, randomBoardLayout, RULES_DEFAULTS, sameCoord, SIGIL_STATUSES, TERRAINS, validateBoardLayout } from '../engine';
import type { BoardLayout, Coord, SigilSpec, Terrain } from '../engine';
import { newId } from './storage';
import type { StoredBoard } from './storage';
import { TERRAIN_COLOR, terrainVar } from './theme';
import { Button } from './components/Button';
import { ChoiceCard } from './components/ChoiceCard';
import { Tag } from './components/Chip';
import { Icon } from './components/Icon';
import { MapThumb } from './components/MapPreview';

type Tool = Terrain | 'spring' | 'sigil';

/** What the sigil tool stamps. Seeded from the shipping rules so an unedited stamp is the default. */
const DEFAULT_SPEC: SigilSpec = {
  status: RULES_DEFAULTS.sigilStatus,
  amount: RULES_DEFAULTS.sigilAmount,
  turns: RULES_DEFAULTS.sigilTurns,
};

const LEADER_STARTS: Coord[] = [{ col: 4, row: 1 }, { col: 4, row: 7 }];

function blankLayout(): BoardLayout {
  return {
    terrain: Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => 'Normal' as Terrain)),
    springs: [{ col: 2, row: 4 }, { col: 6, row: 4 }],
  };
}

export function BoardEditor({
  boards,
  onSave,
}: {
  boards: StoredBoard[];
  onSave: (bs: StoredBoard[]) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('New board');
  const [layout, setLayout] = useState<BoardLayout>(arenaLayout);
  const [tool, setTool] = useState<Tool>('Forest');
  const [mirror, setMirror] = useState(true);
  const [painting, setPainting] = useState(false);
  const [io, setIo] = useState(''); // JSON export/import textarea
  const [spec, setSpec] = useState<SigilSpec>(DEFAULT_SPEC);

  useEffect(() => {
    const up = () => setPainting(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const warnings = useMemo(() => validateBoardLayout(layout), [layout]);

  function paint(c: Coord) {
    setLayout((prev) => {
      const l = structuredClone(prev);
      const targets = mirror && c.row !== 4 ? [c, { col: c.col, row: 8 - c.row }] : [c];
      if (tool === 'spring') {
        const turnOn = !l.springs.some((s) => sameCoord(s, c));
        for (const t of targets) {
          l.springs = l.springs.filter((s) => !sameCoord(s, t));
          if (turnOn) l.springs.push({ ...t });
        }
      } else if (tool === 'sigil') {
        // Toggles like the spring tool, and stamps the CURRENT spec so what the panel shows is
        // what the tile gets. Mirrored targets receive an identical spec, which is what the
        // validator's mirror check wants.
        const existing = l.sigils ?? [];
        const turnOn = !existing.some((g) => sameCoord(g.at, c));
        let next = existing.filter((g) => !targets.some((t) => sameCoord(g.at, t)));
        if (turnOn) next = [...next, ...targets.map((t) => ({ at: { ...t }, spec: { ...spec } }))];
        if (next.length > 0) l.sigils = next;
        else delete l.sigils;
      } else {
        for (const t of targets) l.terrain[t.col - 1]![t.row - 1] = tool;
        // Painting turns the ground over and destroys the marking, exactly as it does in play.
        const kept = (l.sigils ?? []).filter((g) => !targets.some((t) => sameCoord(g.at, t)));
        if (kept.length > 0) l.sigils = kept;
        else delete l.sigils;
      }
      return l;
    });
  }

  function loadBoard(b: StoredBoard) {
    setSelectedId(b.id);
    setName(b.name);
    setLayout(structuredClone(b.layout));
  }

  function startNew(base: BoardLayout, label: string) {
    setSelectedId(null);
    setName(label);
    setLayout(base);
  }

  function save(asCopy: boolean) {
    const id = !asCopy && selectedId ? selectedId : newId('board');
    const entry: StoredBoard = { id, name: name.trim() || 'Unnamed board', layout: structuredClone(layout) };
    const rest = boards.filter((b) => b.id !== id);
    onSave([...rest, entry]);
    setSelectedId(id);
  }

  function remove() {
    if (!selectedId) return;
    onSave(boards.filter((b) => b.id !== selectedId));
    startNew(arenaLayout(), 'New board');
  }

  function importJson() {
    try {
      const parsed = JSON.parse(io) as Partial<StoredBoard>;
      if (!parsed.layout) throw new Error('missing layout');
      boardFromLayout(parsed.layout); // structural check — throws on bad shape/springs
      setLayout(structuredClone(parsed.layout));
      if (parsed.name) setName(parsed.name);
      setSelectedId(null);
      setIo('');
    } catch (e) {
      setIo(`import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="editor">
      <div className="panel editor-side">
        <h3>Boards</h3>
        <div className="button-row">
          <Button size="sm" onClick={() => startNew(arenaLayout(), 'Arena copy')}>New from Arena</Button>
          <Button size="sm" onClick={() => startNew(blankLayout(), 'New board')}>New blank</Button>
          {/* Deselects like the other two, so a reroll can never overwrite a saved board by
              accident — you get a fresh canvas to tweak and then Save as a new entry. */}
          <Button
            size="sm"
            title="Generate a symmetric, ranked-legal layout to start from. Click again to reroll."
            onClick={() => startNew(randomBoardLayout(), 'Random map')}
          >
            <Icon name="random" size={13} />
            Randomize
          </Button>
        </div>
        {boards.length === 0 && <div className="detail-empty">No saved boards yet.</div>}
        {boards.map((b) => {
          const warns = validateBoardLayout(b.layout);
          return (
            <ChoiceCard
              key={b.id}
              selected={selectedId === b.id}
              onSelect={() => loadBoard(b)}
              title={b.name}
              blurb={`${b.layout.springs.length} springs`}
              figure={<MapThumb layout={b.layout} />}
              badges={
                warns.length > 0 ? (
                  <Tag tone="warn" title={warns.join('\n')}>
                    <Icon name="warning" size={11} />
                    {warns.length}
                  </Tag>
                ) : undefined
              }
            />
          );
        })}

        <h3>Share</h3>
        <div className="button-row">
          <Button size="sm" onClick={() => setIo(JSON.stringify({ name, layout }, null, 1))}>
            Export JSON
          </Button>
          <Button size="sm" onClick={importJson}>Import JSON</Button>
        </div>
        <textarea
          className="io"
          value={io}
          onChange={(e) => setIo(e.target.value)}
          placeholder="Board JSON appears / paste here"
        />
      </div>

      <div className="editor-main">
        <div className="board">
          {Array.from({ length: 7 }, (_, rowIdx) => 7 - rowIdx).map((row) =>
            Array.from({ length: 7 }, (_, colIdx) => colIdx + 1).map((col) => {
              const c = { col, row };
              const isSpring = layout.springs.some((s) => sameCoord(s, c));
              const leaderHere = LEADER_STARTS.some((s) => sameCoord(s, c));
              const sigil = (layout.sigils ?? []).find((g) => sameCoord(g.at, c));
              const terrain = layout.terrain[col - 1]![row - 1]!;
              return (
                <div
                  key={`${col},${row}`}
                  className="tile"
                  style={
                    {
                      '--tile-bg': `var(${terrainVar(terrain)})`,
                      '--tile-edge': `var(${terrainVar(terrain)}-edge)`,
                      '--tile-ink': `var(${terrainVar(terrain)}-ink)`,
                    } as CSSProperties
                  }
                  title={`(${col},${row}) ${terrain}${isSpring ? ' · spring' : ''}${sigil ? ` · sigil: ${describeSigil(sigil.spec ?? DEFAULT_SPEC)}` : ''}${leaderHere ? ' · leader start' : ''}`}
                  // Pointer events rather than mouse events, so drag-paint works on a
                  // touchscreen too (paired with `touch-action: none` on the tile).
                  onPointerDown={(e) => {
                    e.currentTarget.releasePointerCapture?.(e.pointerId);
                    paint(c);
                    if (tool !== 'spring') setPainting(true);
                  }}
                  onPointerEnter={() => {
                    if (painting && tool !== 'spring') paint(c);
                  }}
                >
                  <span className="tile-coord">{col},{row}</span>
                  {terrain === 'Wall' && <span className="tile-wall" />}
                  {isSpring && (
                    <span className="tile-marker tile-spring">
                      <Icon name="springActive" size={11} />
                    </span>
                  )}
                  {sigil && (
                    <span className="tile-marker tile-sigil">
                      <Icon name="sigil" size={11} />
                    </span>
                  )}
                  {leaderHere && (
                    <span className="leader-mark">
                      <Icon name="leader" size={12} />
                    </span>
                  )}
                </div>
              );
            }),
          )}
        </div>
      </div>

      <div className="editor-side">
        <div className="panel">
          <h3>Tools</h3>
          <div className="tool-group" role="radiogroup" aria-label="Terrain">
            <div className="tool-label">Terrain</div>
            <div className="palette">
              {TERRAINS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={tool === t}
                  className={`swatch${tool === t ? ' active' : ''}`}
                  onClick={() => setTool(t)}
                >
                  <span className="swatch-chip" style={{ background: TERRAIN_COLOR[t] }} />
                  <span className="swatch-name">{t}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Markers ride on whatever ground is already there, so they are their own
              group rather than entries in the terrain palette. */}
          <div className="tool-group" role="radiogroup" aria-label="Markers">
            <div className="tool-label">Markers</div>
            <div className="palette">
              <button
                type="button"
                role="radio"
                aria-checked={tool === 'spring'}
                className={`swatch${tool === 'spring' ? ' active' : ''}`}
                title="Toggle springs"
                onClick={() => setTool('spring')}
              >
                <span className="swatch-chip" style={{ background: 'var(--state-info)' }} />
                <span className="swatch-name">Spring</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={tool === 'sigil'}
                className={`swatch${tool === 'sigil' ? ' active' : ''}`}
                title="Toggle sigils — marked ground that hits whatever steps on it"
                onClick={() => setTool('sigil')}
              >
                <span className="swatch-chip" style={{ background: '#b98cff' }} />
                <span className="swatch-name">Sigil</span>
              </button>
            </div>
          </div>

          <label className="ai-toggle mirror-toggle">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            Mirror across centre row
          </label>
          {tool === 'sigil' && (
            <div className="sigil-spec">
              <div className="panel-note">Applied on entry:</div>
              <select
                value={spec.status}
                onChange={(e) => setSpec({ ...spec, status: e.target.value as SigilSpec['status'] })}
              >
                {SIGIL_STATUSES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
              {spec.status !== 'Stunned' && (
                <label className="knob">
                  <span className="knob-label">Amount</span>
                  <input
                    type="number"
                    step={5}
                    value={spec.amount}
                    onChange={(e) => setSpec({ ...spec, amount: Number(e.target.value) || 0 })}
                  />
                </label>
              )}
              <label className="knob">
                <span className="knob-label">Turns</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={spec.turns}
                  onChange={(e) => setSpec({ ...spec, turns: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <div className="panel-note">Click a tile to place; click again to clear.</div>
            </div>
          )}
        </div>

        <div className="panel">
          <h3>Save</h3>
          <input className="name-input" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="button-row">
            <Button size="sm" variant="primary" onClick={() => save(false)}>{selectedId ? 'Save' : 'Save new'}</Button>
            {selectedId && <Button size="sm" onClick={() => save(true)}>Save as copy</Button>}
            {selectedId && <Button size="sm" variant="danger" onClick={remove}>Delete</Button>}
          </div>
        </div>

        <div className="panel">
          <h3>Ranked eligibility</h3>
          {/* The verdict is the constraint a map is built against, so it leads. */}
          <div className={`verdict ${warnings.length === 0 ? 'verdict-ok' : 'verdict-warn'}`}>
            <Icon name={warnings.length === 0 ? 'check' : 'warning'} size={15} />
            {warnings.length === 0
              ? 'Ranked-eligible — symmetric & spring-legal'
              : `${warnings.length} eligibility warning${warnings.length === 1 ? '' : 's'}`}
          </div>
          {warnings.length > 0 && (
            <ul className="warnings">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="panel-note">
            Warnings never block saving or playing — custom maps default to casual.
          </div>
        </div>
      </div>
    </div>
  );
}
