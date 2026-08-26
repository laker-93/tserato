import { describe, expect, it } from 'vitest';

import { Crate } from '../src/model/crate';
import { Track } from '../src/model/track';
import { DuplicateTrackError } from '../src/util';

describe('Crate', () => {
  it('reports a track count', () => {
    const crate = new Crate('Deep Cuts');
    crate.addTrack(Track.fromPath('/music/a.mp3'));
    crate.addTrack(Track.fromPath('/music/b.mp3'));

    expect(crate.trackCount).toBe(2);
  });

  it('rejects a second track with the same path', () => {
    const crate = new Crate('Deep Cuts');
    crate.addTrack(Track.fromPath('/music/a.mp3'));

    // a distinct object, same path -- Serato identifies tracks by path
    expect(() => crate.addTrack(Track.fromPath('/music/a.mp3'))).toThrow(DuplicateTrackError);
    expect(crate.trackCount).toBe(1);
  });
});
