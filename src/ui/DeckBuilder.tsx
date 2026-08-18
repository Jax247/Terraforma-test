import { useMemo, useState } from 'react';
import {
  DECK_CARDS,
  DECK_SIZE_MAX,
  DECK_SIZE_MIN,
  DECK_TOKENS,
  DECKS,
  deckCost,
  defaultResolver,
  STANDARD_DC_CAP,
  validateDeck,
} from '../engine';
import type { CardDef, UnitCardDef } from '../engine';
import { Button } from './components/Button';
import { ChoiceCard } from './components/ChoiceCard';
import { Tag } from './components/Chip';
import { Icon } from './components/Icon';
import { CardDetailBody } from './CardDetail';
import type { DetailSubject } from './CardDetail';
import { CardTile, grouped } from './DeckPage';
import { Modal } from './Modal';
import { newId, toDeckDef } from './storage';
import type { StoredDeck } from './storage';

function emptyDeck(): StoredDeck {
  return { id: newId('deck'), name: 'New deck', leaderId: DECKS[0]!.leader.id, list: [], fusionPool: [], customCards: {} };
}

function fromBuiltin(base: (typeof DECKS)[number]): StoredDeck {
  return {
    id: newId('deck'),
    name: `${base.name} copy`,
    leaderId: base.leader.id,
    list: [...base.list],
    fusionPool: [...base.fusionPool],
    customCards: {},
  };
}

const isFusion = (def: CardDef): def is UnitCardDef => def.kind === 'unit' && !!def.fusion;

/** Pool entries deduped by id: the first deck in DECKS owning an id displays it. */
function poolGroups(): { id: string; name: string; defs: CardDef[] }[] {
  const seen = new Set<string>();
  return DECKS.map((d) => {
    const defs = Object.values(d.cards).filter((def) => {
      if (seen.has(def.id)) return false;
      seen.add(def.id);
      return true;
    });
    return { id: d.id, name: d.name, defs };
  });
}

function TweakDialog({
  source,
  onConfirm,
  onClose,
}: {
  source: CardDef;
  onConfirm: (def: CardDef) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(`${source.name} (mod)`);
  const [atk, setAtk] = useState(source.kind === 'unit' ? source.atk : 0);
  const [level, setLevel] = useState(source.kind === 'unit' ? source.level : 0);
  const [dc, setDc] = useState(source.dc);
  return (
    <Modal title={`Clone & tweak — ${source.name}`} onClose={onClose}>
      <div className="tweak">
        <label>Name <input className="name-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        {source.kind === 'unit' && (
          <>
            <label>ATK <input type="number" min={0} step={5} value={atk} onChange={(e) => setAtk(Number(e.target.value))} /></label>
            <label>Level (SP cost) <input type="number" min={0} max={12} value={level} onChange={(e) => setLevel(Number(e.target.value))} /></label>
          </>
        )}
        <label>DC <input type="number" min={0} max={5} value={dc} onChange={(e) => setDc(Number(e.target.value))} /></label>
        <div className="panel-note">
          Tweaked clones get a new card id: they no longer count as fusion material for existing recipes.
        </div>
        <Button
          variant="primary"
          onClick={() => {
            const def = structuredClone(source);
            def.id = newId('custom');
            def.name = name.trim() || def.name;
            def.dc = Number.isFinite(dc) ? dc : def.dc;
            if (def.kind === 'unit') {
              if (Number.isFinite(atk)) def.atk = atk;
              if (Number.isFinite(level)) def.level = level;
            }
            onConfirm(def);
          }}
        >
          Create variant
        </Button>
      </div>
    </Modal>
  );
}


/** A labelled progress bar for a build constraint (DC cap, deck size, fusion pool). */
function Meter({
  label,
  value,
  max,
  suffix,
  over = false,
  ok = false,
}: {
  label: string;
  value: number;
  max: number;
  /** Overrides the default "/max" reading — deck size has a legal WINDOW, not a cap. */
  suffix?: string;
  over?: boolean;
  ok?: boolean;
}) {
  return (
    <div className={`meter${over ? ' meter-over' : ok ? ' meter-ok' : ''}`}>
      <div className="meter-head">
        <span>{label}</span>
        <span className="meter-value">
          {value}
          {suffix ?? `/${max}`}
        </span>
      </div>
      <div className="meter-bar">
        <div className="meter-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
    </div>
  );
}

export function DeckBuilder({
  decks,
  onSave,
  onInspect,
}: {
  decks: StoredDeck[];
  onSave: (ds: StoredDeck[]) => void;
  onInspect: (s: DetailSubject) => void;
}) {
  const [working, setWorking] = useState<StoredDeck>(emptyDeck);
  const [isSaved, setIsSaved] = useState(false);
  const [kindFilter, setKindFilter] = useState<'all' | CardDef['kind']>('all');
  const [hovered, setHovered] = useState<DetailSubject | null>(null);
  const [tweakSource, setTweakSource] = useState<CardDef | null>(null);
  const [io, setIo] = useState('');

  const pool = useMemo(poolGroups, []);
  const deckDef = useMemo(() => toDeckDef(working), [working]);
  const violations = useMemo(() => validateDeck(deckDef), [deckDef]);
  const cost = useMemo(() => deckCost(deckDef), [deckDef]);
  const names = useMemo(
    () => defaultResolver({ ...DECK_CARDS, ...working.customCards }, DECK_TOKENS),
    [working.customCards],
  );

  const countOf = (id: string) => working.list.filter((x) => x === id).length + working.fusionPool.filter((x) => x === id).length;

  function update(mut: (d: StoredDeck) => void) {
    setWorking((prev) => {
      const d = structuredClone(prev);
      mut(d);
      return d;
    });
  }

  function add(def: CardDef) {
    if (!isFusion(def) && countOf(def.id) >= 3) return;
    update((d) => {
      (isFusion(def) ? d.fusionPool : d.list).push(def.id);
    });
  }

  function removeOne(id: string, zone: 'list' | 'fusionPool') {
    update((d) => {
      const idx = d[zone].indexOf(id);
      if (idx !== -1) d[zone].splice(idx, 1);
    });
  }

  function deleteVariant(id: string) {
    update((d) => {
      delete d.customCards[id];
      d.list = d.list.filter((x) => x !== id);
      d.fusionPool = d.fusionPool.filter((x) => x !== id);
    });
  }

  function loadDeck(d: StoredDeck) {
    setWorking(structuredClone(d));
    setIsSaved(true);
  }

  function startNew(d: StoredDeck) {
    setWorking(d);
    setIsSaved(false);
  }

  function save() {
    const entry = structuredClone(working);
    entry.name = entry.name.trim() || 'Unnamed deck';
    onSave([...decks.filter((x) => x.id !== entry.id), entry]);
    setWorking(entry);
    setIsSaved(true);
  }

  function remove() {
    onSave(decks.filter((x) => x.id !== working.id));
    startNew(emptyDeck());
  }

  function importJson() {
    try {
      const parsed = JSON.parse(io) as Partial<StoredDeck>;
      if (!Array.isArray(parsed.list) || !Array.isArray(parsed.fusionPool)) throw new Error('missing list/fusionPool');
      startNew({
        ...emptyDeck(),
        ...parsed,
        id: newId('deck'),
        customCards: parsed.customCards ?? {},
      } as StoredDeck);
      setIo('');
    } catch (e) {
      setIo(`import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const poolEntry = (def: CardDef) => (
    <div
      key={def.id}
      className="pool-entry"
      onMouseEnter={() => setHovered({ kind: 'card', def })}
      onMouseLeave={() => setHovered(null)}
    >
      {/* The one place Deck Cost belongs on the card face: you are spending against the cap here. */}
      <CardTile def={def} onInspect={onInspect} showDc />
      <div className="pool-actions">
        <Button
          size="sm"
          disabled={!isFusion(def) && countOf(def.id) >= 3}
          onClick={() => add(def)}
          title={isFusion(def) ? 'Add to fusion pool' : 'Add to main deck'}
        >
          + add{countOf(def.id) > 0 ? ` (${countOf(def.id)})` : ''}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setTweakSource(def)}>clone & tweak</Button>
        {working.customCards[def.id] && (
          <Button size="sm" variant="danger" onClick={() => deleteVariant(def.id)}>delete</Button>
        )}
      </div>
    </div>
  );

  const kindMatches = (def: CardDef) => kindFilter === 'all' || def.kind === kindFilter;
  const customDefs = Object.values(working.customCards).filter(kindMatches);

  return (
    <div className="editor builder">
      {/* Pool */}
      <div className="panel builder-pool">
        <h3>Card pool</h3>
        <div className="button-row">
          {(['all', 'unit', 'spell', 'trap'] as const).map((k) => (
            <Button key={k} size="sm" variant="ghost" active={kindFilter === k} onClick={() => setKindFilter(k)}>
              {k}
            </Button>
          ))}
        </div>
        {customDefs.length > 0 && (
          <>
            <h4>Custom variants</h4>
            <div className="pool-grid">{customDefs.map(poolEntry)}</div>
          </>
        )}
        {pool.map((g) => {
          const defs = g.defs.filter(kindMatches);
          if (defs.length === 0) return null;
          return (
            <div key={g.id}>
              <h4>{g.name}</h4>
              <div className="pool-grid">{defs.map(poolEntry)}</div>
            </div>
          );
        })}
      </div>

      {/* Deck */}
      <div className="panel builder-deck">
        {/*
          The build constraints, always visible. DC against the cap and the deck-size
          window are what you are actually building against; they used to be a line in
          the header and a separate "Rules check" section further down.
        */}
        <div className="deck-status">
          <div className="deck-status-head">
            <span className="deck-status-name">{working.name}</span>
            {violations.length === 0 ? (
              <Tag tone="ok">
                <Icon name="check" size={11} />
                Tournament-legal
              </Tag>
            ) : (
              <Tag tone="warn">
                <Icon name="warning" size={11} />
                {violations.length} problem{violations.length === 1 ? '' : 's'}
              </Tag>
            )}
          </div>

          <div className="deck-meters">
            <Meter label="Deck cost" value={cost} max={STANDARD_DC_CAP} over={cost > STANDARD_DC_CAP} />
            <Meter
              label="Main deck"
              value={working.list.length}
              max={DECK_SIZE_MAX}
              suffix={`/${DECK_SIZE_MIN}–${DECK_SIZE_MAX}`}
              ok={working.list.length >= DECK_SIZE_MIN && working.list.length <= DECK_SIZE_MAX}
              over={working.list.length > DECK_SIZE_MAX}
            />
            {/* No bar: validateDeck imposes no size cap on the fusion pool, and a
                meter would invent a constraint that does not exist. */}
            <div className="meter">
              <div className="meter-head">
                <span>Fusion pool</span>
                <span className="meter-value">{working.fusionPool.length}</span>
              </div>
            </div>
          </div>

          {violations.length > 0 && (
            <ul className="warnings">
              {violations.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          )}
        </div>

        <h4>Leader</h4>
        <div className="leader-row">
          {DECKS.map((d) => (
            <Button
              key={d.leader.id}
              size="sm"
              variant="ghost"
              active={working.leaderId === d.leader.id}
              onClick={() => update((w) => { w.leaderId = d.leader.id; })}
              onMouseEnter={() => setHovered({ kind: 'leader', def: d.leader })}
              onMouseLeave={() => setHovered(null)}
            >
              {d.leader.name}
            </Button>
          ))}
        </div>

        <h4>Main deck</h4>
        {grouped(working.list, deckDef.cards).map(({ def, count }) => (
          <div key={def.id} className="deck-row" onMouseEnter={() => setHovered({ kind: 'card', def })} onMouseLeave={() => setHovered(null)}>
            <span className="deck-row-name">{def.name}</span>
            <span className="deck-row-meta">×{count}</span>
            <Button size="sm" aria-label={`Remove one ${def.name}`} onClick={() => removeOne(def.id, 'list')}>−</Button>
            <Button size="sm" aria-label={`Add one ${def.name}`} disabled={countOf(def.id) >= 3} onClick={() => add(def)}>+</Button>
          </div>
        ))}
        {working.list.length === 0 && <div className="detail-empty">Click cards in the pool to add them.</div>}

        <h4>Fusion pool</h4>
        {grouped(working.fusionPool, deckDef.cards).map(({ def, count }) => (
          <div key={def.id} className="deck-row" onMouseEnter={() => setHovered({ kind: 'card', def })} onMouseLeave={() => setHovered(null)}>
            <span className="deck-row-name">{def.name}</span>
            <span className="deck-row-meta">×{count}</span>
            <Button size="sm" aria-label={`Remove ${def.name}`} onClick={() => removeOne(def.id, 'fusionPool')}>
              −
            </Button>
          </div>
        ))}
      </div>

      {/* Meta / save / preview */}
      <div className="editor-side">
        <div className="panel">
          <h3>Decks</h3>
          <div className="button-row">
            <Button size="sm" onClick={() => startNew(emptyDeck())}>New empty</Button>
            {DECKS.map((d) => (
              <Button key={d.id} size="sm" variant="ghost" onClick={() => startNew(fromBuiltin(d))}>
                From {d.name}
              </Button>
            ))}
          </div>
          {decks.map((d) => {
            const warns = validateDeck(toDeckDef(d));
            return (
              <ChoiceCard
                key={d.id}
                selected={isSaved && working.id === d.id}
                onSelect={() => loadDeck(d)}
                title={d.name}
                blurb={`${d.list.length} cards · ${Object.keys(d.customCards).length} variants`}
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
        </div>

        <div className="panel">
          <h3>Save</h3>
          <input className="name-input" value={working.name} onChange={(e) => update((w) => { w.name = e.target.value; })} />
          <div className="button-row">
            <Button size="sm" variant="primary" onClick={save}>Save</Button>
            {isSaved && <Button size="sm" variant="danger" onClick={remove}>Delete</Button>}
          </div>
        </div>

        <div className="panel">
          <h3>Share</h3>
          <div className="button-row">
            <Button size="sm" onClick={() => setIo(JSON.stringify(working, null, 1))}>Export JSON</Button>
            <Button size="sm" onClick={importJson}>Import JSON</Button>
          </div>
          <textarea className="io" value={io} onChange={(e) => setIo(e.target.value)} placeholder="Deck JSON appears / paste here" />
        </div>

        <div className="panel detail-panel">
          <h3>Card detail</h3>
          {hovered ? (
            <CardDetailBody subject={hovered} names={names} />
          ) : (
            <div className="detail-empty">Hover a card to preview it.</div>
          )}
        </div>
      </div>

      {tweakSource && (
        <TweakDialog
          source={tweakSource}
          onClose={() => setTweakSource(null)}
          onConfirm={(def) => {
            update((d) => {
              d.customCards[def.id] = def;
              (isFusion(def) ? d.fusionPool : d.list).push(def.id); // one copy, ready to use
            });
            setTweakSource(null);
          }}
        />
      )}
    </div>
  );
}
