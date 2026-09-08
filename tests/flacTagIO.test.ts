import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FlacStream, VorbisCommentBlock } from 'flac-tagger';

import { BeatgridEncoder } from '../src/encoders/beatgrid/beatgridEncoder';
import { V2Encoder } from '../src/encoders/v2/v2Encoder';
import { FlacTagIO } from '../src/encoders/io/flacTagIO';
import { probeContainer } from '../src/encoders/io/container';
import { tagIOFor } from '../src/encoders/io';
import { UnsupportedContainerError } from '../src/encoders/io/tagIO';
import { HotCue } from '../src/model/hotCue';
import { HotCueType } from '../src/model/hotCueType';
import { Track } from '../src/model/track';
import {
  FIXTURE,
  FLAC_FIXTURE,
  flacAudioIdentity,
  flacBlocks,
  flacComments,
  flacDecodes,
  flacToolAvailable,
  pyseratoAvailable,
  scratchCopyOf,
  scratchFlacCopy,
} from './helpers';

const MARKERS2 = 'Serato Markers2';
const BEATGRID = 'Serato BeatGrid';

const withPython = pyseratoAvailable() ? describe : describe.skip;

describe('reading a Serato-analysed FLAC', () => {
  it('gives the same cues the same track gives as an MP3', () => {
    // The claim this whole change rests on is that the payload does not depend
    // on the container. This is that claim, tested: one decoder, two files,
    // and the FLAC's bytes were put there by metaflac rather than by us.
    const fromFlac = new V2Encoder().readCues(Track.fromPath(FLAC_FIXTURE));
    const fromMp3 = new V2Encoder().readCues(Track.fromPath(FIXTURE));

    expect(fromFlac.map((c) => [c.name, c.type, c.start, c.end])).toEqual(
      fromMp3.map((c) => [c.name, c.type, c.start, c.end])
    );
    expect(fromFlac.map((c) => c.name)).toEqual([
      'CUE 1s',
      'CUE 5s',
      'CUE 12s',
      'LOOP 20 to 24s',
    ]);
  });

  it('retrieves the payload byte for byte', () => {
    expect(new FlacTagIO(FLAC_FIXTURE).read(MARKERS2)).toEqual(
      tagIOFor(FIXTURE).read(MARKERS2)
    );
  });

  it('reads the beatgrid frame, and finds this track analysed but ungridded', () => {
    expect(new BeatgridEncoder().readBeatgrid(Track.fromPath(FLAC_FIXTURE))).toEqual([]);
    // Not the same as having no frame: the frame is there, with zero markers.
    expect(new FlacTagIO(FLAC_FIXTURE).read(BEATGRID)?.toString('hex')).toBe('01000000000000');
  });

  it('gives null for a tag the file does not carry', () => {
    expect(new FlacTagIO(FLAC_FIXTURE).read('Serato Overview')).toBeNull();
  });

  it('accepts base64 that is padded and unwrapped', () => {
    // Serato writes it without `=` and broken every 72 characters. Other
    // writers do neither, and the bytes are the same either way.
    const file = scratchFlacCopy('plain.flac');
    const payload = new FlacTagIO(FLAC_FIXTURE).read(MARKERS2)!;
    const plain = Buffer.concat([
      Buffer.from(`application/octet-stream\0\0${MARKERS2}\0`, 'latin1'),
      payload,
    ]).toString('base64');
    expect(plain).toMatch(/=$/);

    setComment(file, 'serato_markers_v2', plain);

    expect(new FlacTagIO(file).read(MARKERS2)).toEqual(payload);
  });

  it('refuses an envelope that names a different tag', () => {
    // Rather than hand 'Serato Overview' bytes to the cue decoder, which would
    // fail the version check somewhere less obvious -- or, worse, not fail.
    const file = scratchFlacCopy('mislabelled.flac');
    setComment(
      file,
      'serato_markers_v2',
      Buffer.concat([
        Buffer.from('application/octet-stream\0\0Serato Overview\0', 'latin1'),
        Buffer.from([0x01, 0x01]),
      ]).toString('base64')
    );

    expect(() => new FlacTagIO(file).read(MARKERS2)).toThrow(/Serato Overview/);
  });

  it('refuses a value that is not an envelope at all', () => {
    const file = scratchFlacCopy('garbage.flac');
    setComment(file, 'serato_markers_v2', Buffer.from('no terminators here').toString('base64'));

    expect(() => new FlacTagIO(file).read(MARKERS2)).toThrow(/not a Serato envelope/);
  });
});

describe('writing a FLAC', () => {
  it('round-trips the cue it just wrote', () => {
    const file = scratchFlacCopy();
    const track = Track.fromPath(file);
    track.addHotCue(new HotCue({ name: 'roundtrip', type: HotCueType.CUE, index: 0, start: 3000 }));

    const encoder = new V2Encoder();
    encoder.write(track);

    expect(encoder.readCues(Track.fromPath(file)).map((c) => [c.name, c.start])).toEqual([
      ['roundtrip', 3000],
    ]);
  });

  it('round-trips a beat grid, and carries the footer byte through', () => {
    const file = scratchFlacCopy('grid.flac');
    const track = Track.fromPath(file);
    const encoder = new BeatgridEncoder();

    // 0x2a is not the 0x00 every observed file carries, so this fails against
    // an encoder that writes the default rather than copying what is there.
    new FlacTagIO(file).write(BEATGRID, encoder._encode([{ position: 0.5, bpm: 128 }], 0x2a));

    track.beatgrid = [
      { position: 0.25, bpm: null, beatsTillNext: 4 },
      { position: 2.25, bpm: 120.0, beatsTillNext: null },
    ];
    encoder.write(track);

    const grid = encoder.readBeatgrid(Track.fromPath(file));
    expect(grid).toHaveLength(2);
    expect(grid[1].bpm).toBeCloseTo(120.0, 3);
    expect(encoder.readFooter(Track.fromPath(file))).toBe(0x2a);
  });

  it('writes it the way Serato does: no padding, wrapped at 72', () => {
    const file = scratchFlacCopy('shape.flac');
    new FlacTagIO(file).write(BEATGRID, Buffer.from('01000000000000', 'hex'));

    const value = comment(file, 'serato_beatgrid');
    expect(value).not.toMatch(/=/);
    expect(value.split('\n').every((line) => line.length <= 72)).toBe(true);
  });

  it('adds the comment block to a FLAC that has none', () => {
    const file = scratchFlacCopy('bare.flac');
    stripComments(file);
    expect(flacBlocks(file)).not.toContain(4);

    new FlacTagIO(file).write(BEATGRID, Buffer.from('01000000000000', 'hex'));

    expect(new FlacTagIO(file).read(BEATGRID)?.toString('hex')).toBe('01000000000000');
    // STREAMINFO has to stay first, whatever else moves.
    expect(flacBlocks(file)[0]).toBe(0);
  });

  it('is idempotent', () => {
    const file = scratchFlacCopy('twice.flac');
    const payload = Buffer.from('01000000000000', 'hex');

    new FlacTagIO(file).write(BEATGRID, payload);
    const once = fs.readFileSync(file);
    new FlacTagIO(file).write(BEATGRID, payload);

    expect(fs.readFileSync(file)).toEqual(once);
  });
});

describe('what a write must not touch', () => {
  it('leaves the other comments exactly as they were', () => {
    // The failure to guard against is a tag writer that "normalises" the file
    // on the way past: uppercasing every key, collapsing the repeated ARTIST
    // into one, or cutting COMMENT off at its first `=`.
    const file = scratchFlacCopy('others.flac');
    const before = flacComments(file).filter(([k]) => !k.toLowerCase().startsWith('serato_'));

    new FlacTagIO(file).write(MARKERS2, Buffer.from([0x01, 0x01]));

    const after = flacComments(file).filter(([k]) => !k.toLowerCase().startsWith('serato_'));
    expect(after).toEqual(before);
    expect(after.filter(([k]) => k === 'ARTIST')).toHaveLength(2);
    expect(after.find(([k]) => k === 'COMMENT')?.[1]).toBe('see https://example.test/?a=1&b=2');
  });

  it('leaves the sibling Serato tag alone', () => {
    // Same rule as the MP3 side's five other GEOB frames (laker-93/tserato#9).
    const file = scratchFlacCopy('sibling.flac');
    const grid = comment(file, 'serato_beatgrid');

    new FlacTagIO(file).write(MARKERS2, Buffer.from([0x01, 0x01]));

    expect(comment(file, 'serato_beatgrid')).toBe(grid);
  });

  it('keeps the spelling the file already used', () => {
    // Vorbis field names are case-insensitive, so writing our own spelling
    // would leave two comments claiming the same field and no rule about which
    // one Serato reads.
    const file = scratchFlacCopy('upper.flac');
    renameComment(file, 'serato_markers_v2', 'SERATO_MARKERS_V2');

    new FlacTagIO(file).write(MARKERS2, Buffer.from([0x01, 0x01]));

    const keys = flacComments(file).map(([k]) => k);
    expect(keys.filter((k) => k.toLowerCase() === 'serato_markers_v2')).toEqual([
      'SERATO_MARKERS_V2',
    ]);
  });

  it('leaves every other metadata block, and the audio, as they were', () => {
    const file = scratchFlacCopy('blocks.flac');
    const blocks = flacBlocks(file);
    const audio = flacAudioIdentity(file);
    expect(blocks).toEqual(expect.arrayContaining([0, 2, 3, 4]));

    new FlacTagIO(file).write(MARKERS2, Buffer.from([0x01, 0x01]));

    expect(flacBlocks(file)).toEqual(blocks);
    expect(flacAudioIdentity(file)).toEqual(audio);
  });

  it.skipIf(!flacToolAvailable())('leaves a file the reference decoder accepts', () => {
    const file = scratchFlacCopy('valid.flac');
    new FlacTagIO(file).write(MARKERS2, Buffer.from([0x01, 0x01]));

    // `flac -t` decodes the whole stream and checks it against STREAMINFO's
    // md5, so this catches a block length we got wrong by one.
    expect(flacDecodes(file)).toBe(true);
  });
});

describe('choosing a reader', () => {
  it.each([
    ['fLaC\0\0\0\0\0\0\0\0\0\0\0\0', 'FLAC'],
    ['RIFF....WAVEfmt ', 'WAV'],
    ['FORM....AIFFCOMM', 'AIFF'],
    ['....ftypM4A ....', 'M4A'],
    ['OggS\0\0\0\0\0\0\0\0\0\0\0\0', 'Ogg'],
    ['ID3\x04\0\0\0\0\0\0stuff', 'MP3'],
    ['\xff\xfb\x90\0\0\0\0\0\0\0\0\0\0\0\0\0', 'MP3'],
  ])('reads %j as %s', (head, container) => {
    expect(probeContainer(stub(head)).container).toBe(container);
  });

  it('still hands anything it cannot identify to the MP3 reader', () => {
    // Where it went before there was a probe. A file with leading junk and no
    // ID3 tag is not a container we support -- it is an MP3 that reads fine.
    expect(probeContainer(stub('junk before the frames')).container).toBe('MP3');
  });

  it('goes by the bytes, not the extension', () => {
    // Common in a real library, and the case that silently returns "no cues"
    // if the extension is trusted.
    const flac = scratchCopyOf(FLAC_FIXTURE, 'actually-a-flac.mp3');
    expect(probeContainer(flac).container).toBe('FLAC');
    expect(new V2Encoder().readCues(Track.fromPath(flac))).toHaveLength(4);
  });

  it('sees past an ID3 tag some tagger left on the front of a FLAC', () => {
    const file = withId3Prefix(scratchFlacCopy('id3.flac'));
    const probe = probeContainer(file);
    expect(probe.container).toBe('FLAC');
    expect(probe.offset).toBe(ID3_PREFIX.length);

    expect(new V2Encoder().readCues(Track.fromPath(file))).toHaveLength(4);
  });

  it('puts that ID3 tag back when it writes', () => {
    const file = withId3Prefix(scratchFlacCopy('id3-write.flac'));
    new FlacTagIO(file, ID3_PREFIX.length).write(BEATGRID, Buffer.from('01000000000000', 'hex'));

    expect(fs.readFileSync(file).subarray(0, ID3_PREFIX.length)).toEqual(ID3_PREFIX);
    expect(probeContainer(file).container).toBe('FLAC');
  });

  it.each(['RIFF....WAVEfmt ', 'FORM....AIFFCOMM', '....ftypM4A ....'])(
    'refuses %j by name rather than pretending it has no cues',
    (head) => {
      const file = stub(head);
      expect(() => tagIOFor(file)).toThrow(UnsupportedContainerError);
      // The distinction the caller needs: not an empty list (tserato#17).
      expect(() => new V2Encoder().readCues(Track.fromPath(file))).toThrow(
        UnsupportedContainerError
      );
    }
  );
});

describe('the dependency itself', () => {
  it('can be required from CommonJS, which is what the built package is', () => {
    // vitest loads ESM, so nothing else here would notice: flac-tagger 2.x
    // publishes an exports map with no `require` condition, and a consumer
    // requiring the built tserato gets ERR_PACKAGE_PATH_NOT_EXPORTED at
    // runtime with the tests all green. This is why the dependency is pinned
    // to 1.x, and this is what would catch an upgrade past it.
    const out = execFileSync(process.execPath, [
      '-e',
      "const ft = require('flac-tagger'); console.log(typeof ft.FlacStream);",
    ], { cwd: path.join(__dirname, '..') });

    expect(out.toString().trim()).toBe('function');
  });

  it('does not stop where the spec says, so a file with no audio is refused first', () => {
    // flac-tagger computes isLast as `(lastAndType & 0b10000000) === 1`, which
    // is never true. Its parse loop runs on until it meets a byte decoding to
    // block type 127, and it only ever meets one because every FLAC audio frame
    // starts with 0xFF. Cut the audio off and it reads past the end of the
    // buffer and throws ERR_BUFFER_OUT_OF_BOUNDS from inside Buffer.readUint8.
    const file = scratchFlacCopy('metadata-only.flac');
    fs.writeFileSync(file, fs.readFileSync(file).subarray(0, metadataEnd(file)));

    expect(() => new FlacTagIO(file).read(MARKERS2)).toThrow(/no audio after/);
    // And specifically not the dependency's out-of-bounds read.
    expect(() => new FlacTagIO(file).read(MARKERS2)).not.toThrow(/out of/i);
  });

  it('refuses a file whose metadata runs off the end, which is what a cut-short download looks like', () => {
    const file = scratchFlacCopy('truncated.flac');
    fs.writeFileSync(file, fs.readFileSync(file).subarray(0, metadataEnd(file) - 40));

    expect(() => new FlacTagIO(file).read(MARKERS2)).toThrow(/truncated/);
  });
});

describe('replacing the file', () => {
  it('leaves nothing behind', () => {
    const file = scratchFlacCopy('tidy.flac');
    new FlacTagIO(file).write(MARKERS2, Buffer.from([0x01, 0x01]));

    expect(fs.readdirSync(path.dirname(file))).toEqual(['tidy.flac']);
  });

  it('refuses a read-only track, and does not damage it', () => {
    // Writing in place would have failed on the open; renaming into the
    // directory would not, so this has to be refused deliberately.
    const file = scratchFlacCopy('readonly.flac');
    const before = fs.readFileSync(file);
    fs.chmodSync(file, 0o444);

    expect(() => new FlacTagIO(file).write(MARKERS2, Buffer.from([0x01, 0x01]))).toThrow();

    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['readonly.flac']);
  });

  it('keeps the file mode', () => {
    const file = scratchFlacCopy('mode.flac');
    fs.chmodSync(file, 0o640);

    new FlacTagIO(file).write(MARKERS2, Buffer.from([0x01, 0x01]));

    expect(fs.statSync(file).mode & 0o777).toBe(0o640);
  });
});

withPython('agreement with mutagen', () => {
  it('writes a comment mutagen reads back as the same bytes', () => {
    // flac-tagger reading its own output would prove very little.
    const file = scratchFlacCopy('mutagen.flac');
    const payload = Buffer.from('0101cafebabe', 'hex');

    new FlacTagIO(file).write(MARKERS2, payload);

    const value = flacComments(file).find(([k]) => k === 'serato_markers_v2')![1];
    const raw = Buffer.from(value.replace(/\s/g, ''), 'base64');
    expect(raw.subarray(0, 42).toString('latin1')).toBe(
      `application/octet-stream\0\0${MARKERS2}\0`
    );
    expect(raw.subarray(42)).toEqual(payload);
  });
});

// --- fixture surgery, done with flac-tagger so the tests need no python -----

/** A 10-byte ID3v2.4 header declaring an empty tag. */
const ID3_PREFIX = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function withId3Prefix(file: string): string {
  fs.writeFileSync(file, Buffer.concat([ID3_PREFIX, fs.readFileSync(file)]));
  return file;
}

/** A file that is only its first bytes -- enough for the container probe. */
function stub(head: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tserato-'));
  const file = path.join(dir, 'stub.bin');
  fs.writeFileSync(file, Buffer.from(head, 'latin1'));
  return file;
}

function editComments(file: string, fn: (list: string[]) => string[]): void {
  const stream = FlacStream.fromBuffer(fs.readFileSync(file));
  const block = stream.vorbisCommentBlock;
  if (block) {
    block.commentList = fn(block.commentList);
  } else {
    stream.metadataBlocks.splice(1, 0, new VorbisCommentBlock({ commentList: fn([]) }));
  }
  fs.writeFileSync(file, stream.toBuffer());
}

function setComment(file: string, key: string, value: string): void {
  editComments(file, (list) => [
    ...list.filter((c) => !c.toLowerCase().startsWith(`${key.toLowerCase()}=`)),
    `${key}=${value}`,
  ]);
}

function renameComment(file: string, from: string, to: string): void {
  editComments(file, (list) =>
    list.map((c) =>
      c.toLowerCase().startsWith(`${from.toLowerCase()}=`) ? `${to}=${c.slice(from.length + 1)}` : c
    )
  );
}

function stripComments(file: string): void {
  const stream = FlacStream.fromBuffer(fs.readFileSync(file));
  stream.metadataBlocks = stream.metadataBlocks.filter((b) => b !== stream.vorbisCommentBlock);
  fs.writeFileSync(file, stream.toBuffer());
}

/** Where the file's FLAC metadata ends and its audio frames begin. */
function metadataEnd(file: string): number {
  const flac = fs.readFileSync(file);
  let at = 4;
  for (;;) {
    const last = (flac[at] & 0x80) !== 0;
    at += 4 + flac.readUIntBE(at + 1, 3);
    if (last) return at;
  }
}

function comment(file: string, key: string): string {
  const stream = FlacStream.fromBuffer(fs.readFileSync(file));
  const found = stream.vorbisCommentBlock?.commentList.find((c) =>
    c.toLowerCase().startsWith(`${key.toLowerCase()}=`)
  );
  if (found === undefined) throw new Error(`no ${key} comment in ${file}`);
  return found.slice(key.length + 1);
}
