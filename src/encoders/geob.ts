import MP3Tag from 'mp3tag.js';
import { unpooledBuffer } from '../util';

const fs = require('fs');

export interface Geob {
  format: string;
  filename: string;
  object: number[];
  description: string;
}

/**
 * Every buffer handed to mp3tag.js has to own its ArrayBuffer -- see
 * unpooledBuffer. Reading a track any other way decodes the wrong file.
 */
export function readTrackFile(path: string): Buffer {
  return unpooledBuffer(fs.readFileSync(path));
}

export function openTrack(path: string): MP3Tag {
  const mp3tag = new MP3Tag(readTrackFile(path), true);
  mp3tag.read();
  return mp3tag;
}

/**
 * A track Serato has analysed carries six GEOB frames -- Analysis, BeatGrid,
 * Autotags, Markers_, Markers2 and Overview -- in no guaranteed order. Each
 * encoder owns exactly one of them, so it has to be found by description;
 * taking GEOB[0] reads whichever frame happens to come first and fails the
 * version check on every real Serato library.
 */
export function findGeobFrame(
  geob: Geob[] | undefined,
  description: string
): Geob | undefined {
  return geob?.find((f) => f.description === description);
}

/**
 * Write `payload` into the file's GEOB frame named `description`, leaving every
 * other frame exactly as it was.
 *
 * This is the whole reason the helper exists rather than each encoder rolling
 * its own save. Assigning the whole GEOB array discards the five frames Serato
 * owns -- the beatgrid, the waveform overview and the BPM/key analysis it spent
 * minutes computing -- which the user cannot get back without re-analysing,
 * losing any manual gridding with it (laker-93/tserato#9). Every encoder that
 * writes goes through here so that fix cannot be reintroduced one encoder at a
 * time.
 */
export function writeGeobFrame(
  path: string,
  description: string,
  payload: Buffer
): void {
  const mp3tag = openTrack(path);

  const frame: Geob = {
    format: 'application/octet-stream',
    filename: '',
    object: Array.from(payload),
    description,
  };

  const existing: Geob[] = mp3tag.tags.v2!.GEOB ?? [];
  const at = existing.findIndex((f) => f.description === description);
  mp3tag.tags.v2!.GEOB =
    at >= 0 ? existing.map((f, i) => (i === at ? frame : f)) : [...existing, frame];

  mp3tag.save({ id3v2: { encoding: 'latin1' } });
  if (mp3tag.error !== '') throw new Error(mp3tag.error);

  mp3tag.read();
  fs.writeFileSync(path, mp3tag.buffer);
}
