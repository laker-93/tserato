import { Track } from './track';
import { sanitizeFilename, DuplicateTrackError } from '../util';

export class Crate {
  private _children: Crate[];
  readonly name: string;
  private _tracks: Set<Track>;

  constructor(name: string, children: Crate[] = []) {
    this._children = [...children];
    this.name = sanitizeFilename(name);
    this._tracks = new Set();
  }

  get children(): Crate[] {
    return this._children;
  }

  get tracks(): Set<Track> {
    return this._tracks;
  }

  addTrack(track: Track): void {
    if (this._tracks.has(track)) {
      throw new DuplicateTrackError(`track ${track} is already in the crate ${this.name}`);
    }
    this._tracks.add(track);
  }

  toString(): string {
    return `Crate<${this.name}>`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }

  plus(other: Crate): Crate {
    if (this.name !== other.name) {
      throw new Error("Cannot merge crates with different names");
    }
    const childrenCopy = [...this._children, ...other._children].map((c) => c.deepCopy());
    const merged = new Crate(this.name, childrenCopy);
    const allTracks = new Set<Track>([...this._tracks, ...other._tracks]);
    for (const track of allTracks) {
      merged.addTrack(track);
    }
    return merged;
  }

  deepCopy(memodict = new Map<any, any>()): Crate {
    if (memodict.has(this)) {
      return memodict.get(this);
    }
    const childrenCopy = this._children.map((c) => c.deepCopy(memodict));
    const copy = new Crate(this.name, childrenCopy);
    memodict.set(this, copy);
    for (const track of this._tracks) {
      copy.addTrack(track);
    }
    return copy;
  }

  equals(other: Crate): boolean {
    if (this.name !== other.name) return false;
    if (this._tracks.size !== other._tracks.size) return false;

    // compare tracks by reference equality (like Python set)
    for (const track of this._tracks) {
      if (!other._tracks.has(track)) return false;
    }

    if (this._children.length || other._children.length) {
      const sortedChildren = [...this._children].sort((a, b) => a._tracks.size - b._tracks.size);
      const sortedOtherChildren = [...other._children].sort((a, b) => a._tracks.size - b._tracks.size);

      if (sortedChildren.length !== sortedOtherChildren.length) return false;

      for (let i = 0; i < sortedChildren.length; i++) {
        if (!sortedChildren[i].equals(sortedOtherChildren[i])) return false;
      }
    }
    return true;
  }
}
