import {
  defaultDef,
  describeCard,
  describeLeader,
  describeToken,
  describeRange,
  keywordGloss,
  cardSpCost,
  unitSpCost,
} from '../engine';
import clsx from 'clsx';
import type { CardDef, Keyword, LeaderDef, NameResolver, TokenDef, TypeName } from '../engine';
import { artSrc, setArtVariant, useArtVariant, useArtVariants } from './cardArt';
import { CardFrame } from './components/CardFrame';
import { StatChip, TagButton } from './components/Chip';
import { Popover } from './components/Popover';
import { Modal } from './Modal';
import styles from './CardDetail.module.scss';

export type DetailSubject =
  | { kind: 'card'; def: CardDef }
  | { kind: 'leader'; def: LeaderDef }
  | { kind: 'token'; def: TokenDef };

/** Firing distance for whichever subject shape this is. Leaders carry none yet. */
function rangeOf(s: DetailSubject): number {
  if (s.kind === 'token') return s.def.range ?? 1;
  if (s.kind === 'card' && s.def.kind === 'unit') return s.def.range ?? 1;
  return 1;
}

function typeOf(s: DetailSubject): TypeName | undefined {
  if (s.kind === 'leader' || s.kind === 'token') return s.def.type;
  return s.def.kind === 'unit' ? s.def.type : undefined;
}

/** The "Leader · Warrior" line under the name. Level has its own badge on the frame. */
function metaOf(s: DetailSubject): string {
  if (s.kind === 'leader') return `Leader · ${s.def.type}`;
  if (s.kind === 'token') return `Token · ${s.def.type}`;
  const def = s.def;
  if (def.kind === 'unit') return def.type;
  if (def.kind === 'spell') return `Spell · ${def.scope}`;
  return 'Trap';
}

/** Only cards carry a level; leaders and tokens have none. */
function levelOf(s: DetailSubject): string | undefined {
  return s.kind === 'card' && s.def.kind === 'unit' ? `Lv ${s.def.level}` : undefined;
}

function spCostOf(s: DetailSubject): number | undefined {
  if (s.kind === 'leader' || s.kind === 'token') return undefined;
  return s.def.kind === 'unit' ? unitSpCost(s.def) : cardSpCost(s.def);
}

/**
 * Stat chips. DEF shows while two-stat combat is live (every unit has one,
 * defaulted if unstated), and always for cards carrying an explicit DEF — those were
 * authored for the experiment, so hiding the stat while browsing them would mislead.
 */
function statsOf(s: DetailSubject) {
  const chips: { label: string; value: string | number; tone?: 'accent' }[] = [];
  if (s.kind === 'leader') {
    chips.push({ label: 'ATK', value: s.def.atk });
  } else if (s.kind === 'token') {
    chips.push({ label: 'ATK', value: s.def.atk }, { label: 'DEF', value: defaultDef(s.def.atk) });
  } else if (s.def.kind === 'unit') {
    const def = s.def;
    chips.push({ label: 'ATK', value: def.atk }, { label: 'DEF', value: def.def ?? defaultDef(def.atk) });
    // Reach only shows when it is off the default — a range-1 shooter reads as plain Ranged.
    if (def.keywords.includes('Ranged') && (def.range ?? 1) > 1) chips.push({ label: 'Range', value: def.range! });
    chips.push({ label: 'DC', value: def.dc, tone: 'accent' });
  } else {
    chips.push({ label: 'DC', value: s.def.dc, tone: 'accent' });
  }
  return chips;
}

function keywords(s: DetailSubject): Keyword[] {
  if (s.kind === 'leader') return [];
  if (s.kind === 'token') return s.def.keywords;
  return s.def.kind === 'unit' ? s.def.keywords : [];
}

function lines(s: DetailSubject, names: NameResolver): string[] {
  if (s.kind === 'leader') return describeLeader(s.def, names);
  if (s.kind === 'token') return describeToken(s.def);
  return describeCard(s.def, names);
}

/**
 * A keyword tag that opens its gloss. Was a `title=` tooltip, which no touch user
 * and no keyboard user could ever read.
 */
export function KeywordTag({ keyword, range }: { keyword: Keyword; range: number }) {
  const gloss = keyword === 'Ranged' ? describeRange(range) : keywordGloss(keyword);
  return (
    <Popover title={keyword} content={gloss}>
      {(props) => (
        <TagButton {...props} tone="accent">
          {keyword}
        </TagButton>
      )}
    </Popover>
  );
}

/** The inner card-detail content — shared by the modal and the hover panel. */
export function CardDetailBody({
  subject,
  names,
  allowArtPicker = false,
}: {
  subject: DetailSubject;
  names: NameResolver;
  /** Offer the illustration picker. Off for the hover panel, which is not clickable. */
  allowArtPicker?: boolean;
}) {
  const range = rangeOf(subject);
  const sp = spCostOf(subject);
  return (
    <>
      <CardFrame
        id={subject.def.id}
        variant="hero"
        // ⚠ ALWAYS printed on the card. The modal used to hide it — visually-hidden, on
        // the grounds that the dialog's title bar already said it — which was fine while
        // the card was a plain art box. Now that the frame carries a real name plate,
        // suppressing it leaves the plate showing a bare type and stats, and the card
        // reads as unfinished. A card has its name printed on it; the title bar repeating
        // it is the lesser redundancy.
        name={subject.def.name}
        type={typeOf(subject)}
        cost={sp !== undefined && sp > 0 ? `${sp} SP` : undefined}
        level={levelOf(subject)}
        meta={metaOf(subject)}
        keywords={keywords(subject).map((k) => (
          <KeywordTag key={k} keyword={k} range={range} />
        ))}
        stats={statsOf(subject).map((c) => (
          <StatChip key={c.label} label={c.label} value={c.value} tone={c.tone ?? 'default'} />
        ))}
        rules={lines(subject, names).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      />
      {allowArtPicker && <ArtPicker id={subject.def.id} name={subject.def.name} />}
    </>
  );
}

/**
 * Choose which generated illustration a card wears.
 *
 * Renders NOTHING unless the card actually has alternates — `npm run art --variants=N`
 * is what creates them, and most cards have exactly one image, so an always-present
 * picker would be an empty row on nearly every card.
 */
function ArtPicker({ id, name }: { id: string; name: string }) {
  const variants = useArtVariants(id);
  const current = useArtVariant(id);
  if (variants.length < 2) return null;
  return (
    <div className={styles['artPicker']}>
      <span className={styles['artPickerLabel']}>Illustration</span>
      <div className={styles['artPickerRow']}>
        {variants.map(({ n, model }, i) => (
          <button
            key={n}
            type="button"
            className={clsx(styles['artOption'], n === current && styles['artOptionActive'])}
            aria-pressed={n === current}
            aria-label={`${name} illustration ${i + 1} of ${variants.length}${model ? `, ${model}` : ''}`}
            onClick={() => setArtVariant(id, n)}
          >
            <img src={artSrc(id, n)} alt="" loading="lazy" draggable={false} />
            {/* Which engine drew it. Without this a model bake-off is indistinguishable thumbnails. */}
            {model && <span className={styles['artOptionModel']}>{model}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CardDetailModal({
  subject,
  names,
  onClose,
}: {
  subject: DetailSubject;
  names: NameResolver;
  onClose: () => void;
}) {
  return (
    <Modal title={subject.def.name} onClose={onClose} top narrow>
      <CardDetailBody subject={subject} names={names} allowArtPicker />
    </Modal>
  );
}
