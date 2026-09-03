import { describe, expect, it } from 'vitest';
import * as fs from 'fs';

import MP3Tag from 'mp3tag.js';

import { BeatgridMp3Encoder } from '../src/encoders/beatgrid/beatgridMp3Encoder';
import { writeGeobFrame } from '../src/encoders/geob';
import { unpooledBuffer } from '../src/util';
import { Track } from '../src/model/track';
import { Tempo, bpmBetween, isTerminal } from '../src/model/tempo';
import {
  FIXTURE,
  SERATO_GEOB,
  geobDescriptions,
  pyseratoAvailable,
  pyseratoBeatgrid,
  pyseratoBeatgridAvailable,
  scratchCopy,
} from './helpers';

/**
 * n=1, position=0.045958050s, bpm=175.0 -- lifted from a real analysed file.
 * The golden case: it is the only assertion here that shows the format was read
 * correctly rather than merely read consistently with itself.
 */
const ZENITH = Buffer.from('0100000000013d3c3e82432f000000', 'hex');
/** Analysed, never gridded. Common, and not an error. */
const UNGRIDDED = Buffer.from('01000000000000', 'hex');

const encoder = new BeatgridMp3Encoder();

describe('the frame itself', () => {
  it('encodes to the bytes Serato itself wrote', () => {
    expect(encoder._encode([{ position: 0.04595804959535599, bpm: 175.0 }])).toEqual(ZENITH);
  });

  it('reads that frame back', () => {
    const [marker] = encoder._decode(ZENITH);
    expect(marker.position).toBeCloseTo(0.045958, 6);
    expect(marker.bpm).toBe(175.0);
    expect(marker.beatsTillNext).toBeNull();
    expect(isTerminal(marker)).toBe(true);
  });

  it('treats an analysed but ungridded track as an empty grid', () => {
    expect(encoder._decode(UNGRIDDED)).toEqual([]);
    expect(encoder._encode([])).toEqual(UNGRIDDED);
  });

  it('round-trips a variable-tempo grid', () => {
    // NOTE: nothing anywhere exercises this against real Serato output -- all
    // 30 gridded files on the QA machine have n_markers of 0 or 1
    // (laker-93/pymix#153). This shows the encoder is self-consistent and
    // matches the documented layout; it does not show that Serato agrees.
    const grid: Tempo[] = [
      { position: 0.5, beatsTillNext: 16 },
      { position: 8.0, beatsTillNext: 32 },
      { position: 21.5, bpm: 142.5 },
    ];
    const payload = encoder._encode(grid);
    expect(payload.length).toBe(31); // 2 version + 4 count + 3 x 8 + 1 footer

    const decoded = encoder._decode(payload);
    expect(decoded.map((m) => m.beatsTillNext)).toEqual([16, 32, null]);
    expect(decoded.map(isTerminal)).toEqual([false, false, true]);
    decoded.forEach((m, i) => expect(m.position).toBeCloseTo(grid[i].position!, 5));
    expect(decoded[2].bpm).toBeCloseTo(142.5, 3);
  });
});

describe('refusing what it cannot represent', () => {
  // The two marker shapes are the same width: a uint32 beat count sits exactly
  // where a float32 bpm does. A marker mistyped by position encodes to
  // plausible garbage nothing downstream can detect, so it is refused here.
  it.each([
    [[{ position: 1.0 }], /must carry a bpm/],
    [[{ position: 1.0, beatsTillNext: 4 }], /must carry a bpm/],
    [[{ position: 1.0, bpm: 128 }, { position: 2.0, bpm: 130 }], /must carry beatsTillNext/],
    [[{ bpm: 128 }], /no position/],
  ])('refuses %j', (grid, match) => {
    expect(() => encoder._encode(grid as Tempo[])).toThrow(match as RegExp);
  });

  it('refuses the wrong version', () => {
    // (1, 1) is Markers2. Reading it as a grid would yield plausible garbage.
    expect(() => encoder._decode(Buffer.from('010100000000 00'.replace(/ /g, ''), 'hex')))
      .toThrow(/version/);
  });

  it('refuses a truncated grid', () => {
    expect(() => encoder._decode(Buffer.from('010000000003' + '00'.repeat(8), 'hex')))
      .toThrow(/too short/);
  });
});

describe('bpmBetween', () => {
  it('derives the tempo Serato infers from the spacing', () => {
    // 16 beats in 7.5 seconds is 128 BPM.
    expect(bpmBetween({ position: 0.5, beatsTillNext: 16 }, { position: 8.0, bpm: 140 }))
      .toBeCloseTo(128.0);
  });

  it('refuses to derive what is stored, or to divide by a non-advancing span', () => {
    expect(() => bpmBetween({ position: 0.5, bpm: 140 }, { position: 8.0, bpm: 140 }))
      .toThrow(/stored, not derived/);
    expect(() => bpmBetween({ position: 8.0, beatsTillNext: 4 }, { position: 0.5, bpm: 140 }))
      .toThrow(/strictly increasing/);
  });
});

describe('against a real analysed file', () => {
  it('reads the fixture without throwing, and finds it ungridded', () => {
    // The fixture carries the frame with zero markers -- analysed, never
    // gridded. Exercises the state that is neither "no frame" nor "a grid".
    expect(encoder.readBeatgrid(Track.fromPath(FIXTURE))).toEqual([]);
  });

  it('gives an empty grid rather than throwing on a corrupt frame', () => {
    const file = scratchCopy();
    // Deliberately not through _encode, which would refuse this.
    writeGeobFrame(file, 'Serato BeatGrid', Buffer.from('0909nonsense'));

    expect(encoder.readBeatgrid(Track.fromPath(file))).toEqual([]);
  });

  it('writes a grid and reads it back', () => {
    const file = scratchCopy();
    const track = Track.fromPath(file);
    track.addBeatgridMarker({ position: 1.25, bpm: 128.0 });
    encoder.write(track);

    const [marker] = encoder.readBeatgrid(Track.fromPath(file));
    expect(marker.position).toBeCloseTo(1.25, 5);
    expect(marker.bpm).toBe(128.0);
  });

  it.skipIf(!pyseratoAvailable())(
    'leaves every sibling GEOB frame alone',
    () => {
      // The damage that cannot be undone: Analysis, Autotags, Overview,
      // Markers_ and Markers2 are minutes of analysis plus any manual
      // gridding, and assigning the whole GEOB array takes all of them (#9).
      const file = scratchCopy();
      const before = readGeobBytes(file);
      expect(geobDescriptions(file)).toEqual(SERATO_GEOB);

      const track = Track.fromPath(file);
      track.addBeatgridMarker({ position: 2.5, bpm: 174.0 });
      encoder.write(track);

      expect(geobDescriptions(file)).toEqual(SERATO_GEOB);
      for (const [name, bytes] of Object.entries(before)) {
        if (name !== 'Serato BeatGrid') {
          expect(readGeobBytes(file)[name], `${name} was modified`).toEqual(bytes);
        }
      }
    }
  );

  it.skipIf(!pyseratoBeatgridAvailable())(
    'writes bytes that pyserato reads back identically',
    () => {
      // The strongest check available: tserato's writer against an independent
      // implementation's reader, rather than against itself.
      const file = scratchCopy();
      const track = Track.fromPath(file);
      track.addBeatgridMarker({ position: 0.5, beatsTillNext: 16 });
      track.addBeatgridMarker({ position: 8.0, bpm: 128.0 });
      encoder.write(track);

      const theirs = pyseratoBeatgrid(file);
      const ours = encoder.readBeatgrid(Track.fromPath(file));

      expect(theirs.length).toBe(2);
      expect(theirs.map((m) => m.beatsTillNext)).toEqual([16, null]);
      theirs.forEach((m, i) => {
        expect(m.position as number).toBeCloseTo(ours[i].position!, 6);
        if (ours[i].bpm == null) {
          expect(m.bpm ?? null).toBeNull();
        } else {
          expect(m.bpm as number).toBeCloseTo(ours[i].bpm!, 3);
        }
      });
    }
  );
});

/** GEOB frame bytes by description, read through mp3tag.js. */
function readGeobBytes(file: string): Record<string, number[]> {
  const mp3tag = new MP3Tag(unpooledBuffer(fs.readFileSync(file)), true);
  mp3tag.read();
  return Object.fromEntries(
    (mp3tag.tags.v2?.GEOB ?? []).map((f: { description: string; object: number[] }) => [
      f.description,
      f.object,
    ])
  );
}
