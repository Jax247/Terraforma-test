import { useEffect, useRef } from 'react';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';

const TURN_HEADER = /^— player (\d+) turn (\d+) \(round (\d+)\): (.+)$/;

/** Splits the flat engine log into per-turn sections at each "— player N turn ..." marker. */
export function groupLogByTurn(log: readonly string[]): { header: string; lines: string[] }[] {
  const groups: { header: string; lines: string[] }[] = [];
  let current: { header: string; lines: string[] } | undefined;
  for (const line of log) {
    const m = TURN_HEADER.exec(line);
    if (m) {
      const [, p, turn, round, rest] = m;
      current = { header: `P${Number(p) + 1} · Turn ${turn} (Round ${round}) · ${rest}`, lines: [] };
      groups.push(current);
    } else if (!current) {
      current = { header: '', lines: [line] };
      groups.push(current);
    } else {
      current.lines.push(line);
    }
  }
  return groups;
}

export function LogPanel({ log, onOpenFull }: { log: readonly string[]; onOpenFull: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const recent = log.slice(-14);

  // Follow the tail — the newest line is the one you want to read.
  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log.length]);

  return (
    <Panel
      title="Log"
      aside={
        <Button size="sm" variant="ghost" onClick={onOpenFull}>
          Full log
        </Button>
      }
    >
      {/*
        A live region: the log is where the engine narrates what happened, and a
        screen-reader user otherwise gets no account of the opponent's turn.
        `polite` so it never interrupts.
      */}
      <div className="log" ref={boxRef} role="log" aria-live="polite" aria-relevant="additions">
        {recent.map((line, i) => (
          <div className="log-line" key={`${log.length - recent.length + i}`}>
            {line}
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function FullLog({ turns }: { turns: { header: string; lines: string[] }[] }) {
  return (
    <div className="log log-full">
      {turns.map((turn, i) => (
        <div className="log-turn" key={i}>
          {turn.header && <div className="log-turn-head">{turn.header}</div>}
          {turn.lines.map((line, j) => (
            <div className="log-line" key={j}>
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
