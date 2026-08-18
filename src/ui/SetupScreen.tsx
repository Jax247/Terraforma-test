import { useEffect, useMemo, useState } from 'react';
import {
  boardFromLayout,
  BOARDS,
  deckCost,
  DECKS,
  DEFENSE_DECKS,
  makeArenaBoard,
  randomBoardLayout,
  RULES_DEFAULTS,
  STANDARD_DC_CAP,
  validateBoardLayout,
  validateDeck,
} from '../engine';
import type { Board, BoardLayout, DeckDef } from '../engine';
import { AiSettings, normalizeAiConfig } from './AiSettings';
import type { AiConfig } from './AiSettings';
import type { DetailSubject } from './CardDetail';
import { Button } from './components/Button';
import { CardPortrait } from './components/CardFrame';
import { ChoiceCard } from './components/ChoiceCard';
import { StatChip, Tag } from './components/Chip';
import { Icon } from './components/Icon';
import { MapPreview } from './components/MapPreview';
import { Panel } from './components/Panel';
import { StageHead } from './components/StageHead';
import { changedCount, describeExperiments, normalizeExperiments, RULE_KNOBS } from './experiments';
import type { ExperimentConfig, RuleKnob, RuleValue } from './experiments';
import { loadSetup, saveSetup, toDeckDef } from './storage';
import type { Controller, StoredBoard, StoredDeck } from './storage';

export type { Controller } from './storage';

export const AI_SPEEDS = [
  { label: 'Watchable', ms: 350 },
  { label: 'Fast', ms: 80 },
  { label: 'Instant', ms: 0 },
] as const;

interface PickableDeck {
  def: DeckDef;
  /** Short badge next to the name ('custom', 'probe') — built-in standard decks carry none. */
  tag?: string;
  violations: string[];
}

function DeckPicker({
  seat,
  label,
  decks,
  chosen,
  onChoose,
  controller,
  onController,
  aiConfig,
  onAiConfig,
  onInspect,
}: {
  seat: 0 | 1;
  label: string;
  decks: PickableDeck[];
  chosen: string;
  onChoose: (id: string) => void;
  controller: Controller;
  onController: (c: Controller) => void;
  aiConfig: AiConfig;
  onAiConfig: (c: AiConfig) => void;
  onInspect: (s: DetailSubject) => void;
}) {
  return (
    <section className={`stage seat-${seat}`} aria-label={label}>
      <StageHead step={seat + 1} title={label} />

      <div className="seat-controller" role="radiogroup" aria-label={`${label} controller`}>
        {(['human', 'ai'] as const).map((c) => (
          <Button
            key={c}
            size="sm"
            variant="ghost"
            role="radio"
            aria-checked={controller === c}
            active={controller === c}
            onClick={() => onController(c)}
          >
            <Icon name={c === 'human' ? 'online' : 'ai'} size={13} />
            {c === 'human' ? 'Human' : 'AI'}
          </Button>
        ))}
      </div>

      {controller === 'ai' && (
        <details className="advanced">
          <summary>AI opponent</summary>
          <div className="advanced-body">
            <AiSettings config={aiConfig} onChange={onAiConfig} />
          </div>
        </details>
      )}

      <div className="choice-list" role="radiogroup" aria-label={`${label} deck`}>
        {decks.map(({ def: deck, tag, violations }) => (
          <ChoiceCard
            key={deck.id}
            role="radio"
            selected={chosen === deck.id}
            onSelect={() => onChoose(deck.id)}
            title={deck.name}
            tag={tag}
            // The leader is the deck's face — its portrait says more than its name.
            figure={<CardPortrait id={deck.leader.id} name={deck.leader.name} type={deck.leader.type} />}
            blurb={`${deck.leader.name} · ${deck.leader.type}`}
            badges={
              <>
                <StatChip
                  label="DC"
                  value={`${deckCost(deck)}/${STANDARD_DC_CAP}`}
                  tone={deckCost(deck) > STANDARD_DC_CAP ? 'warn' : 'accent'}
                />
                {violations.length > 0 && (
                  <Tag tone="warn">
                    <Icon name="warning" size={11} />
                    {violations.length}
                  </Tag>
                )}
              </>
            }
            aside={
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Details for ${deck.leader.name}`}
                onClick={() => onInspect({ kind: 'leader', def: deck.leader })}
              >
                <Icon name="info" size={15} />
              </Button>
            }
          />
        ))}
      </div>
    </section>
  );
}

/** One rules knob — a number field, a checkbox, or a dropdown. Off-baseline values highlight. */
function RuleKnobRow({
  knob,
  value,
  onChange,
}: {
  knob: RuleKnob;
  value: RuleValue;
  onChange: (v: RuleValue) => void;
}) {
  const base = RULES_DEFAULTS[knob.key];
  const dirty = value !== base;
  const shown = typeof base === 'boolean' ? (base ? 'on' : 'off') : base;
  return (
    <label className={`knob${dirty ? ' dirty' : ''}`} title={`${knob.hint} Default ${shown}.`}>
      <span className="knob-label">{knob.label}</span>
      {knob.kind === 'number' ? (
        <input
          type="number"
          min={knob.min}
          max={knob.max}
          step={knob.step}
          value={Number(value)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(knob.max, Math.max(knob.min, n)));
          }}
        />
      ) : knob.kind === 'toggle' ? (
        <input type="checkbox" className="knob-check" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      ) : (
        <select className="knob-select" value={String(value)} onChange={(e) => onChange(e.target.value as RuleValue)}>
          {knob.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      )}
      {dirty && (
        <button className="knob-reset" title={`Reset to ${shown}`} onClick={() => onChange(base)}>
          ↺
        </button>
      )}
    </label>
  );
}

/** Picker sentinels — not board ids, so they can never collide with a saved map. */
export const RANDOM_SAVED = '__random-saved__';
export const RANDOM_GENERATED = '__random-generated__';

/**
 * The tester's rules workbench: prototype flags plus every tunable engine constant, applied
 * to the next game started. All of it is off/baseline by default and collapsed behind one
 * summary line, so a normal playtest never sees it; the badge counts anything off-baseline
 * so you can't unknowingly play a game on a stale tweak.
 */
function ExperimentsPanel({
  cfg,
  onChange,
}: {
  cfg: ExperimentConfig;
  onChange: (c: ExperimentConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const changed = changedCount(cfg);
  const groups: RuleKnob['group'][] = ['Economy', 'Board & combat'];
  const setRule = (k: RuleKnob['key'], v: RuleValue) => onChange({ ...cfg, rules: { ...cfg.rules, [k]: v } });

  return (
    <details className="advanced experiments" open={open}>
      <summary onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}>
        Rules experiments
        <Tag tone={changed > 0 ? 'warn' : 'default'}>{changed === 0 ? 'baseline' : `${changed} changed`}</Tag>
      </summary>

      <div className="advanced-body">
        <div className="experiments-note">
          Applied to the next game you start, then fixed for its lifetime. Local games only —
          online matches always run the shipping ruleset.
        </div>

        {groups.map((g) => (
          <div key={g}>
            <h4>{g}</h4>
            <div className="knob-grid">
              {RULE_KNOBS.filter((k) => k.group === g).map((knob) => (
                <RuleKnobRow key={knob.key} knob={knob} value={cfg.rules[knob.key]} onChange={(n) => setRule(knob.key, n)} />
              ))}
            </div>
          </div>
        ))}

        {changed > 0 && (
          <>
            <div className="experiments-diff">
              {describeExperiments(cfg).map((line, i) => (
                <div key={i}>· {line}</div>
              ))}
            </div>
            <Button size="sm" onClick={() => onChange(normalizeExperiments())}>
              Reset all to baseline
            </Button>
          </>
        )}
      </div>
    </details>
  );
}

export function SetupScreen({
  onStart,
  onInspect,
  customDecks,
  customBoards,
}: {
  onStart: (
    a: DeckDef,
    b: DeckDef,
    board: Board,
    controllers: [Controller, Controller],
    aiConfigs: [AiConfig, AiConfig],
    aiSpeedMs: number,
    experiments: ExperimentConfig,
    boardName: string,
  ) => void;
  onInspect: (s: DetailSubject) => void;
  customDecks: StoredDeck[];
  customBoards: StoredBoard[];
}) {
  // Remembers the last-used setup across visits to this screen (localStorage).
  const stored = useMemo(() => loadSetup(), []);
  const [p1, setP1] = useState(stored?.p1 ?? 'wildgrowth');
  const [p2, setP2] = useState(stored?.p2 ?? 'gravemarch');
  const [boardId, setBoardId] = useState(stored?.boardId ?? 'arena');
  const [c1, setC1] = useState<Controller>(stored?.c1 ?? 'human');
  const [c2, setC2] = useState<Controller>(stored?.c2 ?? 'human');
  const [ai1, setAi1] = useState<AiConfig>(normalizeAiConfig(stored?.ai1));
  const [ai2, setAi2] = useState<AiConfig>(normalizeAiConfig(stored?.ai2));
  const [speed, setSpeed] = useState<number>(stored?.speed ?? AI_SPEEDS[0].ms);
  const [experiments, setExperiments] = useState<ExperimentConfig>(normalizeExperiments(stored?.experiments));
  // The generated map on offer. Rolled once on mount and only re-rolled on demand, so the
  // preview is stable while you set up the rest of the game.
  const [generated, setGenerated] = useState<BoardLayout>(() => randomBoardLayout());
  const anyAi = c1 === 'ai' || c2 === 'ai';

  useEffect(() => {
    saveSetup({ p1, p2, boardId, c1, c2, ai1, ai2, speed, experiments });
  }, [p1, p2, boardId, c1, c2, ai1, ai2, speed, experiments]);

  const pickable: PickableDeck[] = useMemo(
    () => [
      ...DECKS.map((def) => ({ def, violations: [] as string[] })),
      // Two-stat probe decks: harness fixtures, kept pickable so the DEF-heavy matchups stay
      // playable by hand. Deliberately not in DECKS — anvil busts the DC cap on purpose, which
      // `validateDeck` surfaces as a violation tag rather than hiding the deck.
      ...DEFENSE_DECKS.map((def) => ({ def, tag: 'probe', violations: validateDeck(def) })),
      ...customDecks.map((d) => {
        const def = toDeckDef(d);
        return { def, tag: 'custom', violations: validateDeck(def) };
      }),
    ],
    [customDecks],
  );

  function changeExperiments(next: ExperimentConfig) {
    setExperiments(next);
  }

  function findDeck(id: string): DeckDef {
    return pickable.find((p) => p.def.id === id)?.def ?? DECKS[0]!;
  }

  /** Every concrete map that "random saved" may roll: the built-in pool plus your own. */
  const savedBoards: { id: string; name: string; layout: BoardLayout }[] = useMemo(
    () => [
      ...BOARDS.map((b) => ({ id: b.id, name: b.name, layout: b.layout })),
      ...customBoards.map((b) => ({ id: b.id, name: b.name, layout: b.layout })),
    ],
    [customBoards],
  );

  /**
   * Resolve the picker to an actual board. The two random modes resolve HERE, at start, so a
   * roll is locked in for the whole game — `RANDOM_SAVED` picks one of the saved maps, and
   * `RANDOM_GENERATED` plays the layout currently shown in the preview (so you always get the
   * map you were looking at, and "Reroll" is the only way to change it).
   */
  function chosenBoard(): { board: Board; name: string } {
    if (boardId === RANDOM_SAVED) {
      const roll = savedBoards[Math.floor(Math.random() * savedBoards.length)]!;
      return { board: boardFromLayout(roll.layout), name: `${roll.name} (random)` };
    }
    if (boardId === RANDOM_GENERATED) return { board: boardFromLayout(generated), name: 'Generated map' };
    const saved = savedBoards.find((b) => b.id === boardId);
    return saved
      ? { board: boardFromLayout(saved.layout), name: saved.name }
      : { board: makeArenaBoard(), name: 'Arena' };
  }

  /**
   * The layout to preview. `RANDOM_SAVED` is the one selection with no answer — it resolves to
   * a different map every start — so it previews nothing rather than showing a map you might
   * not get.
   */
  const previewed: { layout: BoardLayout; label: string } | undefined =
    boardId === RANDOM_SAVED
      ? undefined
      : boardId === RANDOM_GENERATED
        ? { layout: generated, label: 'Generated map' }
        : (() => {
            const saved = savedBoards.find((b) => b.id === boardId);
            return saved ? { layout: saved.layout, label: saved.name } : undefined;
          })();

  const previewWarnings = previewed ? validateBoardLayout(previewed.layout) : [];

  return (
    <div className="setup">
      <DeckPicker
        seat={0}
        label="Player 1" decks={pickable} chosen={p1} onChoose={setP1}
        controller={c1} onController={setC1}
        aiConfig={ai1} onAiConfig={setAi1} onInspect={onInspect}
      />
      <DeckPicker
        seat={1}
        label="Player 2" decks={pickable} chosen={p2} onChoose={setP2}
        controller={c2} onController={setC2}
        aiConfig={ai2} onAiConfig={setAi2} onInspect={onInspect}
      />

      <section className="stage" aria-label="Battlefield">
        <StageHead step={3} title="Battlefield" />

        <div className="choice-list" role="radiogroup" aria-label="Map">
          {BOARDS.map((b) => (
            <ChoiceCard
              key={b.id}
              role="radio"
              selected={boardId === b.id}
              onSelect={() => setBoardId(b.id)}
              title={b.name}
              blurb={b.blurb}
              figure={<MapPreview layout={b.layout} thumb />}
            />
          ))}
          {customBoards.map((b) => {
            const warns = validateBoardLayout(b.layout);
            return (
              <ChoiceCard
                key={b.id}
                role="radio"
                selected={boardId === b.id}
                onSelect={() => setBoardId(b.id)}
                title={b.name}
                tag="custom"
                blurb={`${b.layout.springs.length} springs`}
                figure={<MapPreview layout={b.layout} thumb />}
                badges={
                  warns.length > 0 ? (
                    <Tag tone="warn">
                      <Icon name="warning" size={11} />
                      {warns.length}
                    </Tag>
                  ) : undefined
                }
              />
            );
          })}

          <ChoiceCard
            role="radio"
            selected={boardId === RANDOM_SAVED}
            onSelect={() => setBoardId(RANDOM_SAVED)}
            title="Random saved map"
            blurb={`Rolls one of the ${savedBoards.length} saved maps at start`}
            figure={<Icon name="random" size={20} />}
          />
          <ChoiceCard
            role="radio"
            selected={boardId === RANDOM_GENERATED}
            onSelect={() => setBoardId(RANDOM_GENERATED)}
            title="Generate a random map"
            blurb="A fresh symmetric, ranked-legal layout"
            figure={<Icon name="map" size={20} />}
          />
        </div>

        <Panel>
          {previewed ? (
            <div className="preview-body">
              <div className="preview-head">
                <span className="preview-label">{previewed.label}</span>
                {boardId === RANDOM_GENERATED && (
                  <Button size="sm" onClick={() => setGenerated(randomBoardLayout())}>
                    Reroll
                  </Button>
                )}
              </div>
              <MapPreview layout={previewed.layout} />
              <div className={`preview-note ${previewWarnings.length === 0 ? 'preview-ok' : 'preview-warn'}`}>
                {previewWarnings.length === 0
                  ? 'Symmetric & spring-legal'
                  : `${previewWarnings.length} eligibility warning(s): ${previewWarnings.join('; ')}`}
              </div>
            </div>
          ) : (
            <div className="preview-note">Rolled when the game starts — no preview.</div>
          )}
        </Panel>

        <div className="start-bar">
          {anyAi && (
            <details className="advanced">
              <summary>AI speed</summary>
              <div className="advanced-body">
                <div className="speed-row" role="radiogroup" aria-label="AI speed">
                  {AI_SPEEDS.map(({ label, ms }) => (
                    <Button
                      key={label}
                      size="sm"
                      variant="ghost"
                      role="radio"
                      aria-checked={speed === ms}
                      active={speed === ms}
                      title={ms === 0 ? 'No delay between AI actions' : `${ms} ms between AI actions`}
                      onClick={() => setSpeed(ms)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </details>
          )}
          <ExperimentsPanel cfg={experiments} onChange={changeExperiments} />
          <Button
            variant="accent"
            size="lg"
            block
            className="start"
            onClick={() => {
              const { board, name } = chosenBoard();
              onStart(findDeck(p1), findDeck(p2), board, [c1, c2], [ai1, ai2], speed, experiments, name);
            }}
          >
            Start game
          </Button>
        </div>
      </section>
    </div>
  );
}
