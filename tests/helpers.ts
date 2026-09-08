import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const FIXTURE = path.join(__dirname, 'fixtures', 'analysed.mp3');

/**
 * The same track as a FLAC, carrying the same Serato payloads.
 *
 * Built from FIXTURE: ffmpeg re-encodes its audio losslessly, then metaflac
 * writes the MP3's own `Serato Markers2` and `Serato BeatGrid` GEOB bytes into
 * Vorbis comments in Serato's envelope. Neither tool is this library, so the
 * fixture is not a recording of tserato's own output.
 *
 * It also carries the things a FLAC writer can quietly destroy: a repeated
 * ARTIST, a COMMENT containing `=`, a seektable, an application block nothing
 * here parses, and padding.
 */
export const FLAC_FIXTURE = path.join(__dirname, 'fixtures', 'analysed.flac');

/** The six GEOB frames Serato writes on a track it has analysed. */
export const SERATO_GEOB = [
  'Serato Analysis',
  'Serato Autotags',
  'Serato BeatGrid',
  'Serato Markers2',
  'Serato Markers_',
  'Serato Overview',
];

/** Copy the fixture somewhere disposable -- never write to the fixture itself. */
export function scratchCopy(name = 'track.mp3'): string {
  return scratchCopyOf(FIXTURE, name);
}

/** The same, for any source file. */
export function scratchCopyOf(source: string, name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tserato-'));
  const dest = path.join(dir, name);
  fs.copyFileSync(source, dest);
  return dest;
}

export function scratchFlacCopy(name = 'track.flac'): string {
  return scratchCopyOf(FLAC_FIXTURE, name);
}

/**
 * pyserato is the reference implementation of this format and is correct on
 * every count tserato was wrong about, so the tests assert against it rather
 * than against numbers baked into the test file. Skipped when it is absent.
 */
const PYTHON = process.env.PYSERATO_PYTHON ?? path.join(os.homedir(), 'workspace/pymix/.venv/bin/python');

export function pyseratoAvailable(): boolean {
  try {
    execFileSync(PYTHON, ['-c', 'import pyserato, mutagen'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function pyseratoCues(file: string): Array<Record<string, unknown>> {
  const out = execFileSync(PYTHON, ['-c', `
import json, sys
from pyserato.encoders.v2_mp3_encoder import V2Mp3Encoder
from pyserato.model.track import Track
cues = V2Mp3Encoder().read_cues(Track(sys.argv[1]))
print(json.dumps([
    {"name": c.name, "type": c.type.name, "index": c.index, "start": c.start, "end": c.end}
    for c in cues
]))
`, file]);
  return JSON.parse(out.toString());
}

export function geobDescriptions(file: string): string[] {
  const out = execFileSync(PYTHON, ['-c', `
import json, sys
from mutagen.mp3 import MP3
tags = MP3(sys.argv[1])
print(json.dumps(sorted(f.desc for k, f in tags.items() if k.startswith("GEOB:"))))
`, file]);
  return JSON.parse(out.toString());
}

/**
 * The beatgrid encoder is newer than the released pyserato, so the cross-check
 * probes for the module itself rather than for pyserato in general. Point
 * PYSERATO_PYTHON at a checkout that has laker-93/pyserato#13 to run these;
 * they skip cleanly against a released one.
 */
export function pyseratoBeatgridAvailable(): boolean {
  try {
    execFileSync(PYTHON, ['-c', 'import pyserato.encoders.beatgrid_mp3_encoder'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function pyseratoBeatgrid(file: string): Array<Record<string, unknown>> {
  const out = execFileSync(PYTHON, ['-c', `
import json, sys
from pyserato.encoders.beatgrid_mp3_encoder import BeatgridMp3Encoder
from pyserato.model.track import Track
grid = BeatgridMp3Encoder().read_beatgrid(Track(sys.argv[1]))
print(json.dumps([
    {"position": m.position, "bpm": m.bpm, "beatsTillNext": m.beats_till_next}
    for m in grid
]))
`, file]);
  return JSON.parse(out.toString());
}

/**
 * The file's Vorbis comments, in file order, read by mutagen.
 *
 * Deliberately not read back through flac-tagger: the point of the write tests
 * is that an implementation which is not the one under test still sees what we
 * meant to write.
 */
export function flacComments(file: string): Array<[string, string]> {
  const out = execFileSync(PYTHON, [
    '-c',
    `
import json, sys
from mutagen.flac import FLAC
print(json.dumps([[k, v] for k, v in FLAC(sys.argv[1]).tags]))
`,
    file,
  ]);
  return JSON.parse(out.toString());
}

/** Metadata block types in file order: 0 STREAMINFO, 1 PADDING, 2 APPLICATION, 3 SEEKTABLE, 4 VORBIS_COMMENT, 6 PICTURE. */
export function flacBlocks(file: string): number[] {
  const out = execFileSync(PYTHON, [
    '-c',
    `
import json, sys
from mutagen.flac import FLAC
print(json.dumps([b.code for b in FLAC(sys.argv[1]).metadata_blocks]))
`,
    file,
  ]);
  return JSON.parse(out.toString());
}

/** The audio itself: STREAMINFO's md5 of the decoded samples, and the sample count. */
export function flacAudioIdentity(file: string): { md5: string; samples: number } {
  const out = execFileSync(PYTHON, [
    '-c',
    `
import json, sys
from mutagen.flac import FLAC
info = FLAC(sys.argv[1]).info
print(json.dumps({"md5": format(info.md5_signature, "032x"), "samples": info.total_samples}))
`,
    file,
  ]);
  return JSON.parse(out.toString());
}

/** Whether `flac -t` accepts the file -- decodes it and checks it against that md5. */
export function flacDecodes(file: string): boolean {
  try {
    execFileSync('flac', ['-t', '--silent', file], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function flacToolAvailable(): boolean {
  try {
    execFileSync('flac', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
