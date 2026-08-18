// Rules Spec §6 — effectiveStats is built & tested FIRST and hardest: everything derives from it.
import { describe, expect, it } from 'vitest';
import { tileAt } from '../board';
import { effectiveAtk, terrainMod } from '../stats';
import { applyAction, debugSpawn } from '../engine';
import { freshGame, passRounds } from './helpers';

describe('terrain chart (§11: one favored +10, one weak −10, uniform)', () => {
  it('matches the locked chart', () => {
    expect(terrainMod('Beast', 'Forest')).toBe(10);
    expect(terrainMod('Beast', 'Desert')).toBe(-10);
    expect(terrainMod('Beast', 'Mountain')).toBe(0);
    expect(terrainMod('Insect', 'Desert')).toBe(10);
    expect(terrainMod('Insect', 'Sanctuary')).toBe(-10);
    expect(terrainMod('Dragon', 'Mountain')).toBe(10);
    expect(terrainMod('Dragon', 'Sea')).toBe(-10);
    expect(terrainMod('Aqua', 'Sea')).toBe(10);
    expect(terrainMod('Aqua', 'Desert')).toBe(-10);
    expect(terrainMod('Warrior', 'Grassland')).toBe(10);
    expect(terrainMod('Warrior', 'Shadow')).toBe(-10);
    expect(terrainMod('Spellcaster', 'Shadow')).toBe(10);
    expect(terrainMod('Fiend', 'Shadow')).toBe(10);
    expect(terrainMod('Fiend', 'Sanctuary')).toBe(-10);
    expect(terrainMod('Undead', 'Desert')).toBe(10);
    expect(terrainMod('Undead', 'Sanctuary')).toBe(-10);
    expect(terrainMod('Machine', 'Mountain')).toBe(10);
    expect(terrainMod('Machine', 'Sea')).toBe(-10);
    expect(terrainMod('Inferno', 'Desert')).toBe(10);
    expect(terrainMod('Inferno', 'Sea')).toBe(-10);
    expect(terrainMod('Verdant', 'Forest')).toBe(10);
    expect(terrainMod('Terra', 'Mountain')).toBe(10);
    expect(terrainMod('Terra', 'Sea')).toBe(-10);
    expect(terrainMod('Avian', 'Mountain')).toBe(10);
    expect(terrainMod('Avian', 'Sea')).toBe(-10);
  });

  it('Normal and Grassland are neutral for most types', () => {
    expect(terrainMod('Undead', 'Normal')).toBe(0);
    expect(terrainMod('Beast', 'Grassland')).toBe(0);
  });
});

describe('effectiveAtk — derived, never stored', () => {
  it('reads the unit own tile outside combat', () => {
    const s = freshGame();
    // (3,5) is Desert on the sim map; Duneshambler is Undead (Desert-favored).
    const u = debugSpawn(s, 'duneshambler', 1, { col: 3, row: 5 });
    // 30 base + 10 terrain + 10 Oskar passive (Undead on Desert) — RAW stacking.
    expect(effectiveAtk(s, u)).toBe(50);
  });

  it('terrain painted under a STATIONARY unit re-evaluates instantly (the key case)', () => {
    const s = freshGame();
    const u = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 }); // Normal tile
    expect(effectiveAtk(s, u)).toBe(30);
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Forest';
    // No move, no event — the buff flips on because stats are computed fresh.
    expect(effectiveAtk(s, u)).toBe(30 + 10 + 10); // terrain + Briar passive
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Desert';
    expect(effectiveAtk(s, u)).toBe(30 - 10); // Beast weak on Desert
  });

  it('in combat, terrain resolves on the DEFENDED tile for both combatants', () => {
    const s = freshGame();
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Sea';
    tileAt(s.board, { col: 4, row: 5 }).terrain = 'Mountain';
    // A Machine standing on Mountain attacking onto Sea fights at −10, not +10.
    const machine = debugSpawn(
      s,
      'mosshideBull', // reuse a vanilla body but check via a Machine-typed custom below
      0,
      { col: 4, row: 5 },
    );
    void machine;
    const atk = debugSpawn(s, 'duneshambler', 0, { col: 4, row: 3 });
    const def = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 4 });
    // Undead attacking onto Sea: 30 + 0 (Sea neutral for Undead).
    expect(effectiveAtk(s, atk, { role: 'attacker', battleTile: def.pos, opponentId: def.id })).toBe(30);
    // Insect defending on Sea: 15 + 0.
    expect(effectiveAtk(s, def, { role: 'defender', battleTile: def.pos, opponentId: atk.id })).toBe(15);
  });

  it('leader passive is an own-tile standing predicate: kept while attacking elsewhere', () => {
    const s = freshGame();
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Forest';
    const apex = debugSpawn(s, 'apexPredator', 0, { col: 4, row: 4 });
    const target = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 }); // Desert tile on sim map? (4,5) is Desert
    // Apex on Forest: Briar passive +10 applies regardless of where the battle resolves.
    // Battle tile (4,5) is Desert: Beast weak −10 there.
    const eff = effectiveAtk(s, apex, { role: 'attacker', battleTile: target.pos, opponentId: target.id });
    expect(eff).toBe(70 + 10 - 10);
  });

  it('Frenzy: +5 per orthogonally adjacent ALLY, max +20, continuously re-evaluated', () => {
    const s = freshGame();
    const f = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 4 }); // Normal tile
    expect(effectiveAtk(s, f)).toBe(15);
    debugSpawn(s, 'duneshambler', 1, { col: 3, row: 4 });
    expect(effectiveAtk(s, f)).toBe(20);
    debugSpawn(s, 'duneshambler', 1, { col: 5, row: 4 });
    expect(effectiveAtk(s, f)).toBe(25);
    debugSpawn(s, 'duneshambler', 1, { col: 4, row: 3 });
    expect(effectiveAtk(s, f)).toBe(30);
    debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 });
    expect(effectiveAtk(s, f)).toBe(35); // 4 allies = max +20
    // Diagonal allies do NOT count.
    debugSpawn(s, 'duneshambler', 1, { col: 3, row: 3 });
    expect(effectiveAtk(s, f)).toBe(35);
  });

  it('Frenzy does not count enemies', () => {
    const s = freshGame();
    const f = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 4 });
    debugSpawn(s, 'thornfang', 0, { col: 3, row: 4 });
    expect(effectiveAtk(s, f)).toBe(15);
  });

  it('scaling aura: Grovecaller +5 per Forest tile in its surrounding 8 (incl. own tile)', () => {
    const s = freshGame();
    const g = debugSpawn(s, 'grovecaller', 0, { col: 4, row: 4 });
    expect(effectiveAtk(s, g)).toBe(25);
    tileAt(s.board, { col: 3, row: 4 }).terrain = 'Forest';
    tileAt(s.board, { col: 5, row: 4 }).terrain = 'Forest';
    expect(effectiveAtk(s, g)).toBe(35);
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Forest'; // own tile counts; Verdant +10 + Briar +10
    expect(effectiveAtk(s, g)).toBe(25 + 15 + 10 + 10);
  });

  it('scaling aura: Sand Revenant +5 per Undead in own graveyard, re-evaluated', () => {
    const s = freshGame();
    const r = debugSpawn(s, 'sandRevenant', 1, { col: 4, row: 4 });
    expect(effectiveAtk(s, r)).toBe(35);
    s.players[1].graveyard.push('duneshambler', 'duneshambler', 'carrionSwarm');
    // Carrion Swarm is Insect — only the 2 Undead count.
    expect(effectiveAtk(s, r)).toBe(45);
    s.players[0].graveyard.push('duneshambler'); // enemy graveyard does not count
    expect(effectiveAtk(s, r)).toBe(45);
  });

  it('timed AtkMod statuses add and expire on the controller turn tick', () => {
    let s = freshGame();
    const u = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    u.statuses.push({ id: 't1', kind: 'AtkMod', amount: -20, duration: { kind: 'turns', turnsLeft: 1 } });
    expect(effectiveAtk(s, u)).toBe(10);
    s = applyAction(s, { t: 'EndTurn' }); // P2's turn — status persists (ticks on OWNER's turn)
    expect(effectiveAtk(s, s.units[u.id]!)).toBe(10);
    s = applyAction(s, { t: 'EndTurn' }); // P1's turn — ticks 1 -> 0 but stays live all turn
    expect(effectiveAtk(s, s.units[u.id]!)).toBe(10);
    s = passRounds(s, 1);                 // P1's next turn — already spent, retired
    expect(effectiveAtk(s, s.units[u.id]!)).toBe(30);
  });
});
