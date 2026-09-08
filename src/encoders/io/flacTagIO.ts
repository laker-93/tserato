import * as fs from 'fs';

import { FlacStream, VorbisCommentBlock } from 'flac-tagger';

import {
  SERATO_ANALYSIS,
  SERATO_BEATGRID,
  SERATO_MARKERS_V2,
  SERATO_OVERVIEW,
} from '../serato_tags';
import { splitString, writeFileAtomic } from '../../util';
import { TagIO } from './tagIO';

/**
 * The Vorbis comment field each Serato tag lives in.
 *
 * Taken from Holzhaus/serato-tags (docs/fileformats.md) and corroborated
 * against a real Serato-analysed FLAC, which spells it in lower case --
 * `serato_markers_v2`. Vorbis field names are case-insensitive, so both forms
 * are the same field; `write` keeps whichever one the file already uses.
 *
 * Serato Autotags and Serato Markers_ are deliberately absent: no public
 * description records a FLAC field name for either, and guessing one would put
 * bytes in the user's file under a name Serato may not read.
 */
const VORBIS_FIELD: Readonly<Record<string, string>> = {
  [SERATO_ANALYSIS]: 'serato_analysis',
  [SERATO_BEATGRID]: 'serato_beatgrid',
  [SERATO_MARKERS_V2]: 'serato_markers_v2',
  [SERATO_OVERVIEW]: 'serato_overview',
};

/** Serato's own MIME type for the envelope; it never varies. */
const ENVELOPE_MIME = 'application/octet-stream';

/**
 * Serato tags in a FLAC's Vorbis comment block.
 *
 * The payload is the same as an MP3's, but a Vorbis comment holds text, so
 * Serato wraps the bytes in the header an ID3 GEOB frame would have carried
 * around them and base64s the result:
 *
 *     base64("application/octet-stream\0" + "\0" + "Serato Markers2\0" + payload)
 *
 * -- a null-terminated MIME type, a null-terminated (and always empty)
 * filename, a null-terminated description, then the payload. That is 42 bytes
 * of prefix for Markers2, though nothing here counts it: the fields are read
 * back by their terminators, and the description is checked rather than
 * assumed.
 *
 * Serato writes the base64 without `=` padding and breaks it with a newline
 * every 72 characters, which is what this writes too. Reading accepts either
 * form.
 *
 * Everything else in the file is left exactly as it was -- the other comments
 * with their original spelling and duplicates, the vendor string, and the
 * seektable, picture, application and padding blocks. This is the same rule the
 * MP3 side follows for its sibling GEOB frames (laker-93/tserato#9): a FLAC in
 * a DJ library carries analysis nobody can regenerate cheaply, and a tag writer
 * that rewrites what it does not understand is how that gets lost.
 */
export class FlacTagIO implements TagIO {
  constructor(
    private readonly file: string,
    /** Bytes before `fLaC` -- an ID3v2 tag some taggers prepend. Kept, not parsed. */
    private readonly offset = 0
  ) {}

  read(description: string): Buffer | null {
    const field = fieldFor(description);
    const stream = this.load().stream;
    const comment = findComment(stream.vorbisCommentBlock?.commentList, field);
    if (comment === undefined) {
      return null;
    }
    return unwrap(valueOf(comment), description, field);
  }

  write(description: string, payload: Buffer): void {
    const field = fieldFor(description);
    const { prefix, stream } = this.load();

    let block = stream.vorbisCommentBlock;
    if (!block) {
      block = new VorbisCommentBlock({ commentList: [] });
      // STREAMINFO has to stay first; after it the order is ours to choose.
      stream.metadataBlocks.splice(1, 0, block);
    }

    const at = block.commentList.findIndex((c) => keyOf(c).toLowerCase() === field);
    // Keep whatever spelling the file already uses. Writing SERATO_MARKERS_V2
    // into a file that says serato_markers_v2 would leave two comments naming
    // the same case-insensitive field, and no reader is obliged to prefer ours.
    const key = at >= 0 ? keyOf(block.commentList[at]) : field;
    const entry = `${key}=${wrap(description, payload)}`;

    if (at >= 0) {
      block.commentList[at] = entry;
    } else {
      block.commentList.push(entry);
    }

    writeFileAtomic(this.file, Buffer.concat([prefix, stream.toBuffer()]));
  }

  private load(): { prefix: Buffer; stream: FlacStream } {
    const buffer = fs.readFileSync(this.file);
    return {
      prefix: buffer.subarray(0, this.offset),
      stream: FlacStream.fromBuffer(buffer.subarray(this.offset)),
    };
  }
}

function fieldFor(description: string): string {
  const field = VORBIS_FIELD[description];
  if (!field) {
    throw new Error(`no FLAC field name is known for ${JSON.stringify(description)}`);
  }
  return field;
}

/** Comments are `NAME=value`, and NAME is case-insensitive per the Vorbis spec. */
function keyOf(comment: string): string {
  const at = comment.indexOf('=');
  return at === -1 ? comment : comment.slice(0, at);
}

function valueOf(comment: string): string {
  const at = comment.indexOf('=');
  // Only the first `=` separates; the rest belongs to the value. base64 padding
  // and URLs in ordinary tags both depend on that.
  return at === -1 ? '' : comment.slice(at + 1);
}

function findComment(commentList: string[] | undefined, field: string): string | undefined {
  return commentList?.find((c) => keyOf(c).toLowerCase() === field);
}

function wrap(description: string, payload: Buffer): string {
  const envelope = Buffer.concat([
    Buffer.from(`${ENVELOPE_MIME}\0\0${description}\0`, 'latin1'),
    payload,
  ]);
  const b64 = envelope.toString('base64').replace(/=+$/, '');
  return splitString(Buffer.from(b64, 'latin1')).toString('latin1');
}

function unwrap(value: string, description: string, field: string): Buffer {
  // Serato's line breaks are formatting, not data. Buffer's base64 decoder is
  // happy without the `=` padding Serato omits, so nothing needs adding back.
  const raw = Buffer.from(value.replace(/\s/g, ''), 'base64');

  let at = 0;
  const next = (): string => {
    const end = raw.indexOf(0x00, at);
    if (end === -1) {
      throw new Error(`${field} is not a Serato envelope: no terminator after byte ${at}`);
    }
    const s = raw.subarray(at, end).toString('latin1');
    at = end + 1;
    return s;
  };

  next(); // MIME type
  next(); // filename, always empty
  const desc = next();
  if (desc !== description) {
    // The envelope names what it carries, so a mismatch means this is some
    // other tag under a name we expected -- not something to decode as cues.
    throw new Error(
      `${field} carries ${JSON.stringify(desc)}, not ${JSON.stringify(description)}`
    );
  }
  return Buffer.from(raw.subarray(at));
}
