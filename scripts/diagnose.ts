// Per-deck diagnostic: WHY is a deck winning or losing, beyond its win rate?
//
// Written 2026-08-03 after the first blueprint deck (The Red Mark) placed last and the A/B ladder
// could say only "it loses". A ladder tells you THAT; this tells you WHY. It pairs a static read of
// what the deck fields against the field average with a dynamic read of whether its signature
// ability actually fires in real games.
//
//   npm run diagnose -- redmark [--games 6]
//
// The Red Mark case it was built for: 18% of that deck's budget bought exact-range shooting, and
// the archers turned out to have a legal shot only 25% of the time — so the premium was paid for an
// ability that mostly could not fire, and the deck fielded the lowest ATK curve in the game.

import {
  initGame, applyAction, makeArenaBoard, DECKS, DECK_CARDS, DECK_TOKENS,
  rangedTargets, unitAt, hasKeyword, mulberry32, shuffled, orthAdjacent, deckCost,
} from '../src/engine/index.ts';
import { makeGreedyPolicy } from '../src/ai/index.ts';
import type { GameState, UnitCardDef } from '../src/engine/index.ts';

const argv = process.argv.slice(2);
const deckId = argv.find((a) => !a.startsWith('--')) ?? '';
const games = Number(argv[argv.indexOf('--games') + 1]) || 6;
const target = DECKS.find((d) => d.id === deckId);
if (!target) {
  console.error(`unknown deck '${deckId}'. Known: ${DECKS.map((d) => d.id).join(', ')}`);
  process.exit(1);
}
const field = DECKS.filter((d) => d.id !== target.id);

// --- static: what does it field, against the field average? -----------------
const curve = (d: typeof target) => {
  const units = d.list.map((id) => d.cards[id]!).filter((x): x is UnitCardDef => x.kind === 'unit');
  const atk = units.reduce((a, u) => a + u.atk, 0);
  return {
    dc: deckCost(d), units: units.length,
    meanAtk: atk / units.length, topAtk: Math.max(...units.map((u) => u.atk)),
    atkPerDc: atk / deckCost(d),
    topEnd: units.filter((u) => u.level >= 5).length,
    ranged: units.filter((u) => u.keywords.includes('Ranged')).length,
  };
};
const me = curve(target);
const avg = (pick: (c: ReturnType<typeof curve>) => number) =>
  field.map((d) => pick(curve(d))).reduce((a, b) => a + b, 0) / field.length;

const row = (label: string, mine: number, fieldAvg: number, dp = 1) => {
  const d = mine - fieldAvg;
  const flag = Math.abs(d) / (Math.abs(fieldAvg) || 1) > 0.15 ? (d < 0 ? '  <-- LOW' : '  <-- HIGH') : '';
  console.log(`  ${label.padEnd(18)} ${mine.toFixed(dp).padStart(7)} ${fieldAvg.toFixed(dp).padStart(9)}${flag}`);
};

console.log(`\n=== ${target.name} (${target.id}) ===`);
console.log(`\n  STATIC — what it fields${' '.repeat(4)}    this  field avg`);
row('deck cost', me.dc, avg((c) => c.dc), 0);
row('unit count', me.units, avg((c) => c.units), 0);
row('mean ATK', me.meanAtk, avg((c) => c.meanAtk));
row('top ATK', me.topAtk, avg((c) => c.topAtk), 0);
row('ATK per DC', me.atkPerDc, avg((c) => c.atkPerDc), 2);
row('level 5+ bodies', me.topEnd, avg((c) => c.topEnd), 1);
console.log(`  leader             ATK ${target.leader.atk}${target.leader.range ? `, range ${target.leader.range}` : ''}`);

// --- dynamic: does its signature actually fire? -----------------------------
const policy = makeGreedyPolicy();
let obs = 0, withShot = 0, engaged = 0, shotsTaken = 0, shotKills = 0, melee = 0, played = 0;

for (const opp of field) {
  for (let seed = 0; seed < games; seed++) {
    const rand = mulberry32(seed * 7919 + 13);
    let s: GameState = initGame({
      board: makeArenaBoard(),
      cardDefs: { ...DECK_CARDS }, tokenDefs: { ...DECK_TOKENS },
      players: [
        { leader: target.leader, deck: shuffled(target.list, rand), fusionPool: target.fusionPool },
        { leader: opp.leader, deck: shuffled(opp.list, rand), fusionPool: opp.fusionPool },
      ],
    });
    played++;
    for (let i = 0; i < 400 && s.phase !== 'gameover'; i++) {
      if (s.active === 0) {
        for (const u of Object.values(s.units)) {
          if (u.owner !== 0 || u.isLeader || !hasKeyword(u, 'Ranged')) continue;
          obs++;
          if (rangedTargets(s, u).some((c) => { const t = unitAt(s, c); return t && t.owner !== 0; })) withShot++;
          if (orthAdjacent(u.pos).some((c) => { const t = unitAt(s, c); return t && t.owner !== 0; })) engaged++;
        }
      }
      const a = policy(s, s.active);
      if (s.active === 0) {
        if (a.t === 'RangedAttack') {
          shotsTaken++;
          const before = Object.keys(s.units).length;
          s = applyAction(s, a);
          if (Object.keys(s.units).length < before) shotKills++;
          continue;
        }
        if (a.t === 'Move' && unitAt(s, a.to) && unitAt(s, a.to)!.owner !== 0) melee++;
      }
      s = applyAction(s, a);
    }
  }
}

const pct = (n: number, d: number) => (d ? `${(100 * n / d).toFixed(1)}%` : 'n/a');
console.log(`\n  DYNAMIC — ${played} games vs the field`);
if (me.ranged > 0) {
  console.log(`  shooter-turns observed        ${obs}`);
  console.log(`    ...HAD a legal shot         ${pct(withShot, obs)}   <- the payoff's real uptime`);
  console.log(`    ...were engaged (no bonus)  ${pct(engaged, obs)}`);
  console.log(`  ranged attacks taken          ${(shotsTaken / played).toFixed(2)}/game`);
  console.log(`    ...that killed              ${pct(shotKills, shotsTaken)}`);
} else {
  console.log('  (no Ranged bodies — shooter telemetry skipped)');
}
console.log(`  melee attacks                 ${(melee / played).toFixed(2)}/game\n`);
