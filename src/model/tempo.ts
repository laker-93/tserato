/**
 * One anchor of a Serato beat grid.
 *
 * Every anchor says "a beat falls here". What differs is what it says about the
 * tempo after it:
 *
 *   - a non-terminal anchor carries `beatsTillNext` -- the whole number of
 *     beats until the following anchor -- and the tempo of that segment is
 *     whatever the spacing implies;
 *   - the final anchor carries an explicit `bpm` and runs to the end of the
 *     track.
 *
 * So terminal vs non-terminal is a real distinction, not a position in a list,
 * and it is kept explicit for the same reason HotCue keeps its type explicit
 * rather than inferring a loop from having an end: a marker mistyped by
 * position silently loses the field that made it different (see #11).
 *
 * `position` is in seconds, which is what the frame stores.
 */
export interface Tempo {
  position?: number | null;
  bpm?: number | null;
  beatsTillNext?: number | null;
}

/** True where this anchor carries a tempo rather than a beat count. */
export function isTerminal(tempo: Tempo): boolean {
  return tempo.beatsTillNext == null;
}

/**
 * The tempo Serato infers for the segment starting at `first`.
 *
 * Non-terminal markers store a beat count, not a tempo; the tempo is implied by
 * the spacing. Exported because it is the one piece of arithmetic in the
 * format, and callers converting to a format that wants an explicit tempo per
 * anchor (Rekordbox's TEMPO) need exactly this.
 */
export function bpmBetween(first: Tempo, second: Tempo): number {
  if (first.beatsTillNext == null) {
    throw new Error("the terminal marker's bpm is stored, not derived");
  }
  const span = (second.position ?? 0) - (first.position ?? 0);
  if (span <= 0) {
    throw new Error('beatgrid markers must be strictly increasing in time');
  }
  return (first.beatsTillNext * 60.0) / span;
}
