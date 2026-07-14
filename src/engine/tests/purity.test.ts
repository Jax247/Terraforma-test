// The one inviolable rule: the engine never imports React or touches the DOM.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as engine from '../index';

function engineSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'tests') continue; // tests may import whatever they like
      out.push(...engineSourceFiles(p));
    } else if (p.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('engine purity', () => {
  it('imports cleanly under a bare node environment (no DOM present)', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof engine.applyAction).toBe('function');
    expect(typeof engine.effectiveAtk).toBe('function');
    expect(typeof engine.legalActions).toBe('function');
  });

  it('no engine source file imports react or references the DOM', () => {
    const dir = fileURLToPath(new URL('..', import.meta.url));
    for (const file of engineSourceFiles(dir)) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file} must not import react`).not.toMatch(/from\s+['"]react/);
      expect(src, `${file} must not touch the DOM`).not.toMatch(/\b(document|window)\s*\./);
    }
  });
});
