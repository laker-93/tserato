import { Track } from './track';
import { sanitizeFilename, DuplicateTrackError } from '../util';

export class Crate {
  private _children: Map<string, Crate>;
  readonly name: string;
  private _tracks: Set<Track>;
  // Set membership is object identity, so it cannot answer "is this track
  // already here". Serato identifies a track by its path, so we track paths
  // alongside -- see addTrack.
  private _trackPaths: Set<string>;

  constructor(name: string, children?: Map<string, Crate>) {
    this._children = children ?? new Map();
    this.name = sanitizeFilename(name);
    this._tracks = new Set();
    this._trackPaths = new Set();
  }

  get children(): Map<string, Crate> {
    return this._children;
  }

  get tracks(): Set<Track> {
    return this._tracks;
  }

  /**
   * How many tracks are in this crate.
   *
   * `tracks` is a Set, so `crate.tracks.length` is `undefined` rather than an
   * error -- a count written that way renders as "undefined" with nothing to
   * debug. Use this instead.
   */
  get trackCount(): number {
    return this._tracks.size;
  }

  addTrack(track: Track): void {
    // Two Track objects built from the same path are distinct objects, so a
    // plain Set never rejects them and the crate silently gains a duplicate
    // entry. Compare on path, which is what identifies a track to Serato.
    if (this._trackPaths.has(track.path)) {
      throw new DuplicateTrackError(`track ${track.path} is already in the crate ${this.name}`);
    }
    this._tracks.add(track);
    this._trackPaths.add(track.path);
  }

  toString(): string {
    return `Crate<${this.name}>`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }

  equals(other: Crate): boolean {
    if (this.name !== other.name) return false;
    if (this._tracks.size !== other._tracks.size) return false;

    for (const [name, child] of this.children) {
      const otherChild = other.children.get(name);
      if (!otherChild) {
        return false;
      }
      if (!child.equals(otherChild)) {
        return false;
      }
    }

    return true;

  }
}
