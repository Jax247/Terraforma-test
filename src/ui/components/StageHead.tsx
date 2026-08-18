import type { ReactNode } from 'react';

/**
 * Stage heading: a numbered step, a title, and an optional right-aligned note.
 * Shared by the hotseat setup screen and the online lobby, which present the same
 * ordered choices.
 */
export function StageHead({ step, title, note }: { step: number; title: string; note?: ReactNode }) {
  return (
    <div className="stage-head">
      <span className="stage-step">{step}</span>
      <span className="stage-title">{title}</span>
      {note && <span className="stage-note">{note}</span>}
    </div>
  );
}
