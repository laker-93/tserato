import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const FIXTURE = path.join(__dirname, 'fixtures', 'analysed.mp3');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tserato-'));
  const dest = path.join(dir, name);
  fs.copyFileSync(FIXTURE, dest);
  return dest;
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
