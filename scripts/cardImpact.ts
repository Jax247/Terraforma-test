// Per-card impact probe: when a spell or trap RESOLVES, what measurably happens?
//
//   npm run impact [--seeds 8] [--policy greedy|search] [--board arena] [--focus <deck>]
//
// Written 2026-08-16. The A/B ladder says which DECK wins; `npm run diagnose` says why a deck is
// losing. Neither can say whether an individual CARD does anything, and it turned out that several
// did not — the pass this script was written for found that the pool's nine 20-damage cards killed
// something 4-10% of the time, that three cards had never resolved once in 729 games, and that
// Dragonfire's 221 resolutions produced zero unit kills because every copy went at a leader's face.
//
// HOW IT ATTRIBUTES. Every applied action's new log lines are sliced out and segmented by
// resolution marker, then the lines around each marker are tallied into that card's row. Two
// quirks of the engine's logging drive the whole design and are easy to get backwards:
//
//   1. `spell X resolves` is logged AFTER its effects (see `resolveSpell`), while `trap X fires` is
//      logged BEFORE them (see `fireTraps`). So a spell marker claims the lines BEHIND it and a
//      trap marker the lines AHEAD. Getting this wrong makes every spell look like it does nothing,
//      which is exactly the bug the first draft of this script had.
//   2. A `respond` trap on `enemyAttacksFriendly` is followed by the attack finishing, so its
//      forward span must be cut at the first combat-resolution line or the trap gets credited with
//      the kill the ATTACKER made. Uncut, Backdraft read as a 0.95-kills-per-fire monster.
//
// Mines need no marker of their own: a mine resolves through `resolveSpell` and logs the ordinary
// spell line.
//
// ⚠ READING THE `res` COLUMN. A card that is SET often and RESOLVED never is usually a real finding,
// but check the eval before concluding the card is weak: `evaluate()` scores `setCard` (11) above
// `handCard` (10), so setting anything is a free +1 while casting a net-zero spell is <= 0. A
// one-ply bot therefore declines cards worth less than about one eval point — which says the
// effect is SMALL, not that it is unplayable by a human. Cross-check with `--policy search`.

import {
  initGame, applyAction, DECKS, DECK_CARDS, DECK_TOKENS, boardFromLayout, BOARDS,
  mulberry32, shuffled, effectiveAtk,
} from '../src/engine/index.ts';
import { makeGreedyPolicy } from '../src/ai/greedy.ts';
import { makeSearchPolicy } from '../src/ai/search.ts';
import type { Action, CardDef, GameState } from '../src/engine/index.ts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const SEEDS = Number(flag('--seeds', '8'));
const POLICY = flag('--policy', 'greedy');
const BOARD_ID = flag('--board', 'arena');
const FOCUS = argv.indexOf('--focus') >= 0 ? flag('--focus', '') : '';

const board = BOARDS.find((b) => b.id === BOARD_ID);
if (!board) {
  console.error(`unknown board '${BOARD_ID}'. Known: ${BOARDS.map((b) => b.id).join(', ')}`);
  process.exit(1);
}

// Card NAMES are what the log prints, so the markers are resolved back to ids through this.
const byName = new Map<string, string>();
const defs: Record<string, CardDef> = {};
for (const d of DECKS) {
  for (const [id, def] of Object.entries(d.cards)) {
    defs[id] = def;
    byName.set(def.name, id);
  }
}

interface Rec {
  id: string; name: string; kind: string; dc: number; sp: number; copies: number;
  cast: number; set: number; resolved: number;
  kills: number; leaderLp: number; survives: number; statuses: number; counters: number;
  displaced: number; anchoredNoop: number; paints: number; draws: number; spGained: number;
  tokens: number; negates: number; ascends: number; searches: number; summons: number;
  /** Resolved and NOTHING observable followed — the strongest single signal of a dead card. */
  empty: number;
}

const recs = new Map<string, Rec>();
function rec(id: string): Rec {
  let r = recs.get(id);
  if (!r) {
    const d = defs[id];
    r = {
      id, name: d?.name ?? id, kind: d?.kind ?? '?', dc: d?.dc ?? 0,
      sp: (d && 'sp' in d ? d.sp : 0) ?? 0, copies: 0,
      cast: 0, set: 0, resolved: 0, kills: 0, leaderLp: 0, survives: 0, statuses: 0, counters: 0,
      displaced: 0, anchoredNoop: 0, paints: 0, draws: 0, spGained: 0, tokens: 0, negates: 0,
      ascends: 0, searches: 0, summons: 0, empty: 0,
    };
    recs.set(id, r);
  }
  return r;
}

const decks = FOCUS ? DECKS.filter((d) => d.id === FOCUS) : DECKS;
if (decks.length === 0) {
  console.error(`--focus '${FOCUS}' matched no deck. Known: ${DECKS.map((d) => d.id).join(', ')}`);
  process.exit(1);
}
for (const d of decks) {
  for (const id of d.list) if (defs[id] && defs[id]!.kind !== 'unit') rec(id).copies++;
}

const SPELL_MARK = /^spell (.+) resolves$/;
const TRAP_MARK = /^trap (.+) fires$/;
/** Combat resolution — where a respond-trap's credit has to stop. See quirk 2 in the header. */
const COMBAT = /\) kills |dies attacking|cannot break|mutual destruction|advances onto|flanks with|defense broken|wall holds/;

/** How much damage of size N actually kills, pooled across every card that deals it. */
const dmgTable = new Map<number, { kill: number; live: number }>();
/** Effective ATK of everything a damage effect actually hit — the SELECTED sample, not the board. */
const victimAtk: number[] = [];
function noteDamage(amount: number, killed: boolean, threshold: number): void {
  let e = dmgTable.get(amount);
  if (!e) { e = { kill: 0, live: 0 }; dmgTable.set(amount, e); }
  if (killed) e.kill++; else e.live++;
  victimAtk.push(threshold);
}

function segment(lines: string[]): void {
  const marks: { i: number; r: Rec; dir: 'back' | 'fwd' }[] = [];
  lines.forEach((l, i) => {
    let m = SPELL_MARK.exec(l);
    if (m) { const id = byName.get(m[1]!); if (id) marks.push({ i, r: rec(id), dir: 'back' }); return; }
    m = TRAP_MARK.exec(l);
    if (m) { const id = byName.get(m[1]!); if (id) marks.push({ i, r: rec(id), dir: 'fwd' }); }
  });
  marks.forEach((mk, n) => {
    mk.r.resolved++;
    const lo = mk.dir === 'back' ? (n > 0 ? marks[n - 1]!.i + 1 : 0) : mk.i + 1;
    const hi = mk.dir === 'back' ? mk.i : (n + 1 < marks.length ? marks[n + 1]!.i : lines.length);
    let span = lines.slice(lo, hi);
    if (mk.dir === 'fwd') {
      const stop = span.findIndex((l) => COMBAT.test(l));
      if (stop >= 0) span = span.slice(0, stop);
    }
    tally(mk.r, span);
  });
}

function tally(cur: Rec, lines: string[]): void {
  let saw = false;
  for (const l of lines) {
    // `destroyUnit` is the single chokepoint. Counting the `destroyed by N damage` line as well
    // would double-count every damage kill — the first draft did, and doubled Meteor's rate.
    if (/destroyed -> graveyard/.test(l) || /\(token\) vanishes/.test(l)) { cur.kills++; saw = true; }
    let d = /takes (\d+) damage \(LP/.exec(l);
    if (d) { cur.leaderLp += Number(d[1]); saw = true; }
    if (/survives \d+ damage/.test(l)) { cur.survives++; saw = true; }
    if (/ gains (Stunned|Snared|Disarmed|Suppressed|Marked|AtkMod|DefMod)/.test(l)) { cur.statuses++; saw = true; }
    if (/counter\(s\)/.test(l)) { cur.counters++; saw = true; }
    if (/displaced to/.test(l)) { cur.displaced++; saw = true; }
    if (/is Anchored — displacement has no effect/.test(l)) { cur.anchoredNoop++; saw = true; }
    if (/terrain painted/.test(l)) { cur.paints++; saw = true; }
    if (/draws \d+$/.test(l)) { cur.draws++; saw = true; }
    d = /gains (\d+) SP/.exec(l);
    if (d) { cur.spGained += Number(d[1]); saw = true; }
    if (/^token .* appears at/.test(l)) { cur.tokens++; saw = true; }
    if (/is negated/.test(l)) { cur.negates++; saw = true; }
    if (/ascends/.test(l)) { cur.ascends++; saw = true; }
    if (/searches their deck/.test(l)) { cur.searches++; saw = true; }
    if (/ enters at \(/.test(l)) { cur.summons++; saw = true; }
    d = /destroyed by (\d+) damage \(ATK (\d+)\)/.exec(l);
    if (d) noteDamage(Number(d[1]), true, Number(d[2]));
    d = /survives (\d+) damage \(ATK (\d+)\)/.exec(l);
    if (d) noteDamage(Number(d[1]), false, Number(d[2]));
  }
  if (!saw) cur.empty++;
}

/** Effective ATK of every live body, sampled each turn handover — what damage is compared against. */
const census: number[] = [];

function runGame(a: (typeof DECKS)[number], b: (typeof DECKS)[number], seed: number): void {
  const order = (deck: typeof a, n: number): string[] => shuffled(deck.list, mulberry32(seed * 2 + n));
  let cur: GameState = initGame({
    board: boardFromLayout(board!.layout),
    cardDefs: { ...DECK_CARDS, ...a.cards, ...b.cards },
    tokenDefs: DECK_TOKENS,
    players: [
      { leader: a.leader, deck: order(a, 1), fusionPool: [...a.fusionPool] },
      { leader: b.leader, deck: order(b, 2), fusionPool: [...b.fusionPool] },
    ],
  });
  const mk = (s: number) => (POLICY === 'search'
    ? makeSearchPolicy({ seed: s, beamWidth: 6, nodeBudget: 6000 })
    : makeGreedyPolicy({ seed: s }));
  const p0 = mk(seed * 2 + 1);
  const p1 = mk(seed * 2 + 2);

  let turns = 0;
  while (cur.phase !== 'gameover' && turns < 120) {
    const seat = cur.active;
    const policy = seat === 0 ? p0 : p1;
    for (let i = 0; i < 200; i++) {
      if (cur.phase === 'gameover') break;
      const action: Action = policy(cur, seat);
      const after = applyAction(cur, action);
      if (action.t === 'CastSpell') rec(action.card).cast++;
      if (action.t === 'SetCard' && defs[action.card] && defs[action.card]!.kind !== 'unit') {
        rec(action.card).set++;
      }
      segment(after.log.slice(cur.log.length));
      cur = after;
      if (action.t === 'EndTurn') break;
    }
    for (const u of Object.values(cur.units)) if (!u.isLeader) census.push(effectiveAtk(cur, u));
    turns++;
  }
}

let games = 0;
for (const a of decks) {
  for (const b of DECKS) {
    for (let i = 0; i < SEEDS; i++) { runGame(a, b, i); games++; }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const rows = [...recs.values()].filter((r) => r.copies > 0).sort((x, y) => x.dc - y.dc || x.id.localeCompare(y.id));
const pad = (v: string | number, n = 6): string => String(v).padEnd(n);

console.log(`\n${games} games — ${POLICY}, ${BOARD_ID}, ${SEEDS} seeds${FOCUS ? `, focus ${FOCUS}` : ''}\n`);
console.log(
  pad('card', 22) + ['kind', 'DC', 'SP', 'cop', 'cast', 'set', 'res', 'res/g', 'kills', 'k/res',
    'lpDmg', 'surv', 'stat', 'cntr', 'disp', 'paint', 'draw', 'spG', 'tok', 'neg', 'asc', 'smn', 'NIL']
    .map((h) => pad(h)).join(''),
);
for (const r of rows) {
  console.log(
    pad(r.name.slice(0, 21), 22)
    + [r.kind.slice(0, 5), r.dc, r.sp, r.copies, r.cast, r.set, r.resolved,
      (r.resolved / games).toFixed(2), r.kills, r.resolved ? (r.kills / r.resolved).toFixed(2) : '-',
      r.leaderLp, r.survives, r.statuses, r.counters, r.displaced, r.paints, r.draws,
      r.spGained, r.tokens, r.negates, r.ascends, r.summons, r.empty].map((v) => pad(v)).join(''),
  );
}

const noop = rows.filter((r) => r.resolved === 0 && (r.set > 0 || r.cast > 0));
if (noop.length) {
  console.log('\n⚠ SET OR CAST BUT NEVER RESOLVED — read the header note on the eval before concluding:');
  for (const r of noop) console.log(`  ${r.name} (set ${r.set}, cast ${r.cast})`);
}
const inert = rows.filter((r) => r.resolved > 0 && r.empty / r.resolved >= 0.5);
if (inert.length) {
  console.log('\n⚠ RESOLVED WITH NO OBSERVABLE EFFECT >= 50% OF THE TIME:');
  for (const r of inert) console.log(`  ${r.name}: ${r.empty}/${r.resolved}`);
}
const blocked = rows.filter((r) => r.anchoredNoop > 0);
if (blocked.length) {
  console.log('\nAnchored no-ops (a push/pull that hit something immovable):');
  for (const r of blocked) console.log(`  ${r.name}: ${r.anchoredNoop}`);
}

console.log('\nDAMAGE THRESHOLD — `applyDamage` destroys only when amount >= effective ATK:');
for (const n of [...dmgTable.keys()].sort((a, b) => a - b)) {
  const e = dmgTable.get(n)!;
  const t = e.kill + e.live;
  console.log(`  ${String(n).padStart(3)} dmg: ${String(e.kill).padStart(4)} kill / ${String(t).padStart(4)} hits = ${((100 * e.kill) / t).toFixed(0)}%`);
}

census.sort((a, b) => a - b);
const under = (n: number): string => ((100 * census.filter((x) => x <= n).length) / census.length).toFixed(1);
console.log(`\nEFFECTIVE-ATK CENSUS of live bodies (n=${census.length}), sampled every turn handover:`);
for (const n of [10, 15, 20, 25, 30, 35, 40, 50]) {
  console.log(`  eff ATK <= ${String(n).padStart(3)}: ${under(n).padStart(5)}%  <- what ${n} damage would kill`);
}
const mean = census.reduce((a, b) => a + b, 0) / census.length;
console.log(`  mean ${mean.toFixed(1)}, median ${census[Math.floor(census.length / 2)]}`);

// ⚠ THE DENOMINATOR TRAP. The census above is every body on the board, but a damage effect does not
// hit a random body — a zone trap catches whoever walked into your half, which is the aggressor,
// and aggressors are the big ones. Comparing a damage number against the BOARD median overestimates
// what it will kill; this is the sample that actually matters.
if (victimAtk.length > 0) {
  victimAtk.sort((a, b) => a - b);
  const vMean = victimAtk.reduce((a, b) => a + b, 0) / victimAtk.length;
  console.log(`\nEFFECTIVE ATK OF WHAT DAMAGE ACTUALLY HIT (n=${victimAtk.length}):`);
  console.log(`  mean ${vMean.toFixed(1)}, median ${victimAtk[Math.floor(victimAtk.length / 2)]}`);
  console.log(`  vs the board-wide mean ${mean.toFixed(1)} / median ${census[Math.floor(census.length / 2)]}`);
}
