import * as path from 'path';
import { HotCue } from './hotCue';
import { HotCueType } from './hotCueType';
import { Tempo } from './tempo';

export class Track {
  path: string;
  trackId: string;
  averageBpm: number;
  dateAdded: string;
  playCount: string;
  tonality: string;
  totalTime: number;

  beatgrid: Tempo[];
  hotCues: HotCue[];
  cueLoops: HotCue[];

  constructor(
    trackPath: string,
    params: {
      trackId?: string;
      averageBpm?: number;
      dateAdded?: string;
      playCount?: string;
      tonality?: string;
      totalTime?: number;
      beatgrid?: Tempo[];
      hotCues?: HotCue[];
      cueLoops?: HotCue[];
    } = {}
  ) {
    this.path = trackPath;
    this.trackId = params.trackId ?? "";
    this.averageBpm = params.averageBpm ?? 0.0;
    this.dateAdded = params.dateAdded ?? "";
    this.playCount = params.playCount ?? "";
    this.tonality = params.tonality ?? "";
    this.totalTime = params.totalTime ?? 0.0;

    this.beatgrid = params.beatgrid ?? [];
    this.hotCues = params.hotCues ?? [];
    this.cueLoops = params.cueLoops ?? [];
  }

  static fromPath(trackPath: string, userRoot?: string): Track {
    const resolved = userRoot ? path.resolve(userRoot, trackPath) : path.resolve(trackPath);
    return new Track(resolved);
  }

  addBeatgridMarker(tempo: Tempo): void {
    this.beatgrid.push(tempo);
  }

  addHotCue(hotCue: HotCue): void {
    if (this.hotCues.length >= 8) {
      throw new Error("cannot have more than 8 hot cues on a track");
    }
    if (this.cueLoops.length >= 4) {
      throw new Error("cannot have more than 4 loops on a track");
    }

    const atIndex = hotCue.index;
    if (hotCue.type === HotCueType.LOOP) {
      this.cueLoops.splice(atIndex, 0, hotCue);
    } else {
      this.hotCues.splice(atIndex, 0, hotCue);
    }
  }
}
