import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { cardSpCost, deckCost, STANDARD_DC_CAP, unitSpCost, validateDeck } from '../engine';
import type { CardDef, DeckDef, LeaderDef, TypeName } from '../engine';
import { Button } from './components/Button';
import { CardFrame, CardPortrait } from './components/CardFrame';
import { StatChip, Tag } from './components/Chip';
import { Icon } from './components/Icon';
import type { DetailSubject } from './CardDetail';

const KIND_ORDER: Record<CardDef['kind'], number> = { unit: 0, spell: 1, trap: 2 };

export function grouped(list: string[], cardDefs: Record<string, CardDef>) {
  const counts = new Map<string, number>();
  for (const id of list) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => ({ def: cardDefs[id]!, count }))
    .sort((a, b) => {
      if (a.def.kind !== b.def.kind) return KIND_ORDER[a.def.kind] - KIND_ORDER[b.def.kind];
      if (a.def.kind === 'unit' && b.def.kind === 'unit' && a.def.level !== b.def.level)
        return a.def.level - b.def.level;
      return a.def.name.localeCompare(b.def.name);
    });
}

/** The card's identity line: what it is, before what it does. */
// The type/kind line under the name. Level is deliberately absent — it has its own
// badge on the frame's right shoulder, which keeps this to one short line.
function metaOf(def: CardDef): string {
  if (def.kind === 'unit') return def.type;
  if (def.kind === 'spell') return `Spell · ${def.scope}`;
  return 'Trap';
}

/**
 * Stat chips under the name.
 *
 * An explicit `def` means the card was authored for two-stat combat (the defense-mode
 * probe decks), so its DEF shows regardless of whether the flag is currently on —
 * otherwise browsing those decks hides the stat they exist to exercise.
 *
 * DC is gated on `showDc`. Deck Cost is a DECKBUILDING constraint — it only means
 * anything while you are spending against the 110 cap — so it earns space on the card
 * face in the builder pool and nowhere else. A built deck already reports its total DC
 * in the section header, which is the number that matters when browsing.
 */
function statsOf(def: CardDef, showDc: boolean): { label: string; value: number; tone?: 'accent' }[] {
  const dc = showDc ? [{ label: 'DC', value: def.dc, tone: 'accent' as const }] : [];
  if (def.kind !== 'unit') return dc;
  return [
    { label: 'ATK', value: def.atk },
    ...(def.def !== undefined ? [{ label: 'DEF', value: def.def }] : []),
    ...dc,
  ];
}

export function CardTile({
  def,
  count,
  onInspect,
  showDc = false,
}: {
  def: CardDef;
  count?: number;
  onInspect: (s: DetailSubject) => void;
  /** Show Deck Cost on the card face. The builder pool only — see `statsOf`. */
  showDc?: boolean;
}) {
  const sp = def.kind === 'unit' ? unitSpCost(def) : cardSpCost(def);
  const stats = statsOf(def, showDc);
  return (
    <CardFrame
      id={def.id}
      variant="full"
      name={def.name}
      type={def.kind === 'unit' ? def.type : undefined}
      count={count}
      cost={sp > 0 ? `${sp} SP` : undefined}
      level={def.kind === 'unit' ? `Lv ${def.level}` : undefined}
      meta={metaOf(def)}
      // ⚠ Must be undefined rather than an empty array when there is nothing to show:
      // `[]` is truthy, so passing it renders an empty stat row that still takes space
      // on the plate. A spell outside the builder now has no stats at all.
      stats={stats.length > 0
        ? stats.map((c) => (
            <StatChip key={c.label} label={c.label} value={c.value} tone={c.tone ?? 'default'} />
          ))
        : undefined}
      onClick={() => onInspect({ kind: 'card', def })}
    />
  );
}

// ---------------------------------------------------------------------------
// Search / sort / filter
// ---------------------------------------------------------------------------

type SortKey = 'name' | 'level' | 'sp' | 'atk' | 'dc';
type KindFilter = 'all' | CardDef['kind'];

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'level', label: 'Level' },
  { key: 'sp', label: 'SP cost' },
  { key: 'atk', label: 'ATK' },
  { key: 'dc', label: 'DC' },
];

function spOf(def: CardDef): number {
  return cardSpCost(def);
}

function sortValue(def: CardDef, key: SortKey): number | string {
  switch (key) {
    case 'name': return def.name.toLowerCase();
    case 'level': return def.kind === 'unit' ? def.level : -1;
    case 'sp': return spOf(def);
    case 'atk': return def.kind === 'unit' ? def.atk : -1;
    case 'dc': return def.dc;
  }
}

interface Filters {
  query: string;
  kind: KindFilter;
  type: 'all' | TypeName;
  sort: SortKey;
  dir: 1 | -1;
}

function matchesCard(def: CardDef, f: Filters): boolean {
  if (f.kind !== 'all' && def.kind !== f.kind) return false;
  if (f.type !== 'all' && (def.kind !== 'unit' || def.type !== f.type)) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = [def.name, def.kind, def.kind === 'unit' ? def.type : '', ...(def.kind === 'unit' ? def.keywords : [])]
      .join(' ')
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function matchesLeader(leader: LeaderDef, f: Filters): boolean {
  if (f.kind !== 'all' && f.kind !== 'unit') return false; // a leader reads as a creature
  if (f.type !== 'all' && leader.type !== f.type) return false;
  const q = f.query.trim().toLowerCase();
  if (q) return `${leader.name} ${leader.type}`.toLowerCase().includes(q);
  return true;
}

function processCards(items: { def: CardDef; count?: number }[], f: Filters) {
  return items
    .filter((it) => matchesCard(it.def, f))
    .sort((a, b) => {
      const av = sortValue(a.def, f.sort);
      const bv = sortValue(b.def, f.sort);
      let c = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      if (c === 0) c = a.def.name.localeCompare(b.def.name);
      return c * f.dir;
    });
}

// ---------------------------------------------------------------------------

/** A collapsible sub-section (Leader / Fusion pool / Main deck) within a deck.
 *  Forced open while a filter is active so matches are never hidden. */
function DeckSection({
  title,
  defaultOpen,
  forceOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  forceOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="deck-section" open={forceOpen || open}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          if (!forceOpen) setOpen((o) => !o);
        }}
      >
        {title}
      </summary>
      {children}
    </details>
  );
}

// ---------------------------------------------------------------------------

/** One deck's collapsible card — identical for registered and experimental decks. */
function DeckEntry({
  deck,
  f,
  filtering,
  open,
  onToggle,
  onInspect,
  violations,
}: {
  deck: DeckDef;
  f: Filters;
  filtering: boolean;
  open: boolean;
  onToggle: () => void;
  onInspect: (s: DetailSubject) => void;
  /** Deck-legality problems, shown as a ⚠ badge. Empty for legal decks. */
  violations?: string[];
}) {
  const fusion = processCards(deck.fusionPool.map((id) => ({ def: deck.cards[id]! })), f);
  const main = processCards(grouped(deck.list, deck.cards), f);
  const leaderShown = matchesLeader(deck.leader, f);
  const matchCount = fusion.length + main.reduce((n, m) => n + (m.count ?? 1), 0);

  // While filtering, hide decks with nothing to show.
  if (filtering && !leaderShown && fusion.length === 0 && main.length === 0) return null;

  return (
    <details className="deck-col" open={open}>
      <summary onClick={(e) => { e.preventDefault(); onToggle(); }}>
        <span className="deck-head">
          <span className="deck-crest">
            <CardPortrait id={deck.leader.id} name={deck.leader.name} type={deck.leader.type} />
          </span>
          <span>
            <span className="deck-name">{deck.name}</span>
            <span className="deck-identity">
              <br />
              {deck.leader.name} · {deck.leader.type} · {deck.list.length} cards
            </span>
          </span>
          <span className="deck-badges">
            {filtering ? (
              <Tag tone="accent">
                {matchCount} match{matchCount === 1 ? '' : 'es'}
              </Tag>
            ) : (
              <StatChip
                label="DC"
                value={`${deckCost(deck)}/${STANDARD_DC_CAP}`}
                tone={deckCost(deck) > STANDARD_DC_CAP ? 'warn' : 'accent'}
              />
            )}
            {!filtering && violations && violations.length > 0 && (
              <Tag tone="warn" title={violations.join('\n')}>
                <Icon name="warning" size={11} />
                {violations.length}
              </Tag>
            )}
          </span>
        </span>
      </summary>

      {leaderShown && (
        <DeckSection title="Leader" defaultOpen={false} forceOpen={filtering}>
          <div className="deck-cards">
            <CardFrame
              id={deck.leader.id}
              variant="full"
              name={deck.leader.name}
              type={deck.leader.type}
              meta={`Leader · ${deck.leader.type}`}
              stats={<StatChip label="ATK" value={deck.leader.atk} />}
              onClick={() => onInspect({ kind: 'leader', def: deck.leader })}
            />
          </div>
        </DeckSection>
      )}

      {fusion.length > 0 && (
        <DeckSection title="Fusion pool" defaultOpen={false} forceOpen={filtering}>
          <div className="deck-cards">
            {fusion.map(({ def }) => (
              <CardTile key={def.id} def={def} onInspect={onInspect} />
            ))}
          </div>
        </DeckSection>
      )}

      {main.length > 0 && (
        <DeckSection title="Main deck" defaultOpen={true} forceOpen={filtering}>
          <div className="deck-cards">
            {main.map(({ def, count }) => (
              <CardTile key={def.id} def={def} count={count} onInspect={onInspect} />
            ))}
          </div>
        </DeckSection>
      )}
    </details>
  );
}

export function DeckPage({
  decks,
  experimentalDecks = [],
  onInspect,
}: {
  decks: DeckDef[];
  /**
   * Harness probe decks, listed below the registered ones in the same format. They exist to
   * exercise a flag-gated ruleset, are not deck-legal, and are not part of the standard pool.
   */
  experimentalDecks?: DeckDef[];
  onInspect: (s: DetailSubject) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [type, setType] = useState<'all' | TypeName>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [dir, setDir] = useState<1 | -1>(1);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(decks[0] ? [decks[0].id] : []));

  const f: Filters = { query, kind, type, sort, dir };
  const filtering = query.trim() !== '' || kind !== 'all' || type !== 'all';

  // Types actually present across the loaded decks, for the filter dropdown.
  const types = useMemo(() => {
    const s = new Set<TypeName>();
    for (const d of [...decks, ...experimentalDecks]) {
      for (const c of Object.values(d.cards)) if (c.kind === 'unit') s.add(c.type);
    }
    return [...s].sort();
  }, [decks, experimentalDecks]);

  const isOpen = (id: string) => filtering || openIds.has(id);
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="deck-page">
      <div className="deck-toolbar">
        <input
          className="deck-search"
          placeholder="Search name, type, keyword…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
            <option value="all">All</option>
            <option value="unit">Units</option>
            <option value="spell">Spells</option>
            <option value="trap">Traps</option>
          </select>
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as 'all' | TypeName)}>
            <option value="all">All</option>
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
        <Button size="sm" onClick={() => setDir((d) => (d === 1 ? -1 : 1))} title="Toggle sort direction">
          {dir === 1 ? 'Ascending' : 'Descending'}
        </Button>

        {/* Active filters as removable chips: what's narrowing the list should be
            visible without re-reading every dropdown. */}
        {filtering && (
          <span className="filter-chips">
            {query.trim() && (
              <Button size="sm" variant="ghost" active onClick={() => setQuery('')}>
                “{query.trim()}” <Icon name="close" size={11} />
              </Button>
            )}
            {kind !== 'all' && (
              <Button size="sm" variant="ghost" active onClick={() => setKind('all')}>
                {kind} <Icon name="close" size={11} />
              </Button>
            )}
            {type !== 'all' && (
              <Button size="sm" variant="ghost" active onClick={() => setType('all')}>
                {type} <Icon name="close" size={11} />
              </Button>
            )}
            <Button size="sm" onClick={() => { setQuery(''); setKind('all'); setType('all'); }}>
              Clear all
            </Button>
          </span>
        )}
      </div>

      {decks.map((deck) => (
        <DeckEntry
          key={deck.id}
          deck={deck}
          f={f}
          filtering={filtering}
          open={isOpen(deck.id)}
          onToggle={() => toggle(deck.id)}
          onInspect={onInspect}
        />
      ))}

      {experimentalDecks.length > 0 && (
        <>
          <div className="deck-divider">
            <h3>Experimental decks</h3>
            <span>
              Probe decks for flag-gated rulesets — playable only with the matching experiment
              enabled in game setup. Not deck-legal and not part of the standard pool.
            </span>
          </div>
          {experimentalDecks.map((deck) => (
            <DeckEntry
              key={deck.id}
              deck={deck}
              f={f}
              filtering={filtering}
              open={isOpen(deck.id)}
              onToggle={() => toggle(deck.id)}
              onInspect={onInspect}
              violations={validateDeck(deck)}
            />
          ))}
        </>
      )}
    </div>
  );
}
