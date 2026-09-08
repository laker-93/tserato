import { describe, expect, it } from 'vitest';
import * as fs from 'fs';

import { V2Encoder } from '../src/encoders/v2/v2Encoder';
import { HotCue } from '../src/model/hotCue';
import { HotCueType } from '../src/model/hotCueType';
import { Track } from '../src/model/track';
import { unpooledBuffer } from '../src/util';
import {
  FIXTURE,
  SERATO_GEOB,
  geobDescriptions,
  pyseratoAvailable,
  pyseratoCues,
  scratchCopy,
} from './helpers';

const withPyserato = pyseratoAvailable() ? describe : describe.skip;

describe('readCues on a Serato-analysed file', () => {
  it('finds the cues even though Markers2 is not the first GEOB frame', () => {
    const cues = new V2Encoder().readCues(new Track(FIXTURE));

    expect(cues.map((c) => c.name)).toEqual([
      'CUE 1s',
      'CUE 5s',
      'CUE 12s',
      'LOOP 20 to 24s',
    ]);
  });

  it('reads a loop back as a loop, with its end point', () => {
    const cues = new V2Encoder().readCues(new Track(FIXTURE));
    const loop = cues.find((c) => c.name === 'LOOP 20 to 24s')!;

    expect(loop.type).toBe(HotCueType.LOOP);
    expect(loop.start).toBe(20000);
    expect(loop.end).toBe(24000);
  });

  it('returns [] for a file with no Serato frames at all', () => {
    const copy = scratchCopy();
    stripAllGeob(copy);

    expect(new V2Encoder().readCues(new Track(copy))).toEqual([]);
  });

  it('returns [] for a file that has GEOB frames but no Markers2', () => {
    const copy = scratchCopy();
    stripGeob(copy, 'Serato Markers2');

    expect(new V2Encoder().readCues(new Track(copy))).toEqual([]);
  });

  it('does not hang or abort the process on a truncated Markers2 frame', () => {
    const copy = scratchCopy();
    truncateMarkers2(copy);

    // The failure this guards against is not an exception -- it is an infinite
    // loop that grows an array until V8 aborts the whole process, which in the
    // client would take the Electron main process down with it.
    expect(() => new V2Encoder().readCues(new Track(copy))).not.toThrow();
  });
  it('decodes the file it was given, not whatever shares its read buffer', () => {
    // Node 24's fs.readFileSync serves files out of a shared 64 KiB pool, so
    // the Buffer is a window at a non-zero offset. mp3tag.js ignores that
    // offset and decoded whichever file sat at the start of the pool instead
    // -- no error, just another track's cues. Only some reads land mid-pool,
    // so alternate enough times to cover a whole cycle of it.
    const stripped = scratchCopy();
    stripGeob(stripped, 'Serato Markers2');
    const encoder = new V2Encoder();

    for (let i = 0; i < 6; i++) {
      expect(encoder.readCues(new Track(stripped))).toEqual([]);
      expect(encoder.readCues(new Track(FIXTURE))).toHaveLength(4);
    }
  });
});

describe('write', () => {
  it('keeps the other five Serato frames', () => {
    const copy = scratchCopy();
    const track = new Track(copy);
    track.addHotCue(new HotCue({ name: 'roundtrip', type: HotCueType.CUE, index: 0, start: 3000 }));

    new V2Encoder().write(track);

    expect(readGeobDescriptions(copy).sort()).toEqual([...SERATO_GEOB].sort());
  });

  it('round-trips the cue it just wrote', () => {
    const copy = scratchCopy();
    const track = new Track(copy);
    track.addHotCue(new HotCue({ name: 'roundtrip', type: HotCueType.CUE, index: 0, start: 3000 }));

    const encoder = new V2Encoder();
    encoder.write(track);

    const cues = encoder.readCues(new Track(copy));
    expect(cues.map((c) => [c.name, c.start])).toEqual([['roundtrip', 3000]]);
  });
});

withPyserato('agreement with pyserato', () => {
  it('decodes the fixture to the same cues', () => {
    const mine = new V2Encoder().readCues(new Track(FIXTURE));
    const theirs = pyseratoCues(FIXTURE);

    expect(mine.map((c) => ({ name: c.name, type: HotCueType[c.type], start: c.start, end: c.end })))
      .toEqual(theirs.map((c) => ({ name: c.name, type: c.type, start: c.start, end: c.end })));
  });

  it('leaves a file pyserato still reads, with every frame intact', () => {
    const copy = scratchCopy();
    const track = new Track(copy);
    track.addHotCue(new HotCue({ name: 'roundtrip', type: HotCueType.CUE, index: 0, start: 3000 }));

    new V2Encoder().write(track);

    expect(geobDescriptions(copy)).toEqual([...SERATO_GEOB].sort());
    expect(pyseratoCues(copy).map((c) => [c.name, c.start])).toEqual([['roundtrip', 3000]]);
  });
});

// --- fixture surgery, done with mp3tag.js so the tests need no python ---

const MP3Tag = require('mp3tag.js');

function editTags(file: string, fn: (geob: any[]) => any[]): void {
  const mp3tag = new MP3Tag(unpooledBuffer(fs.readFileSync(file)), true);
  mp3tag.read();
  mp3tag.tags.v2.GEOB = fn(mp3tag.tags.v2.GEOB ?? []);
  mp3tag.save({ id3v2: { encoding: 'latin1' } });
  if (mp3tag.error !== '') throw new Error(mp3tag.error);
  fs.writeFileSync(file, mp3tag.buffer);
}

function readGeobDescriptions(file: string): string[] {
  const mp3tag = new MP3Tag(unpooledBuffer(fs.readFileSync(file)), true);
  mp3tag.read();
  return (mp3tag.tags.v2?.GEOB ?? []).map((f: any) => f.description);
}

function stripAllGeob(file: string): void {
  editTags(file, () => []);
}

function stripGeob(file: string, description: string): void {
  editTags(file, (geob) => geob.filter((f) => f.description !== description));
}

function truncateMarkers2(file: string): void {
  editTags(file, (geob) =>
    geob.map((f) =>
      f.description === 'Serato Markers2'
        ? { ...f, object: Array.from(f.object).slice(0, 40) }
        : f,
    ),
  );
}
