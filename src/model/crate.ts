import { Track } from './track';
import { sanitizeFilename, DuplicateTrackError } from '../util';

export class Crate {
  private _children: Map<string, Crate>;
  readonly name: string;
  private _tracks: Set<Track>;

  constructor(name: string, children?: Map<string, Crate>) {
    this._children = children ?? new Map();
    this.name = sanitizeFilename(name);
    this._tracks = new Set();
  }

  get children(): Map<string, Crate> {
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
