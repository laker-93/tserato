import * as fs from 'fs';

/** The audio containers Serato writes its tags into. */
export type Container = 'MP3' | 'FLAC' | 'WAV' | 'AIFF' | 'M4A' | 'Ogg';

export interface Probe {
  container: Container;
  /**
   * Where the container's own bytes begin. Non-zero only for a FLAC carrying a
   * leading ID3v2 tag, which is not part of the FLAC stream and has to be kept
   * to one side and put back.
   */
  offset: number;
}

const SNIFF_BYTES = 16;

/**
 * What this file actually is, from its bytes rather than its extension.
 *
 * A DJ library is full of files whose extension lies -- an AIFF saved as .wav,
 * a FLAC named .mp3 by a download tool. Dispatching on the extension sends
 * those to the wrong reader, which does not fail so much as quietly answer
 * "no cues": the outcome this whole issue is about. The magic bytes cost one
 * 16-byte read and cannot lie in the same way.
 */
export function probeContainer(file: string): Probe {
  const head = readHead(file);

  if (head.subarray(0, 4).toString('latin1') === 'fLaC') {
    return { container: 'FLAC', offset: 0 };
  }

  if (head.subarray(0, 3).toString('latin1') === 'ID3') {
    // Usually an MP3 -- but some taggers put an ID3v2 tag in front of a FLAC,
    // and mp3tag.js would read that tag quite happily and report no Serato
    // frames, which is a wrong answer rather than an error. So look past it.
    const after = id3TagLength(head);
    if (after !== null && readHead(file, after).subarray(0, 4).toString('latin1') === 'fLaC') {
      return { container: 'FLAC', offset: after };
    }
    return { container: 'MP3', offset: 0 };
  }

  const magic = head.subarray(0, 4).toString('latin1');
  if (magic === 'RIFF') return { container: 'WAV', offset: 0 };
  if (magic === 'FORM') return { container: 'AIFF', offset: 0 };
  if (magic === 'OggS') return { container: 'Ogg', offset: 0 };
  if (head.subarray(4, 8).toString('latin1') === 'ftyp') return { container: 'M4A', offset: 0 };

  // Anything not positively identified is handed to the MP3 reader, which is
  // where it went before this function existed. A bare MPEG stream begins with
  // a frame sync, but plenty of real files begin with neither that nor an ID3
  // tag -- leading junk, an APE tag -- and refusing those would break reads
  // that work today. Nothing is lost by trying: Serato keeps its tags in an
  // ID3v2 tag, so a file without one has no cues to find whatever it is.
  return { container: 'MP3', offset: 0 };
}

function readHead(file: string, from = 0): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const read = fs.readSync(fd, buf, 0, SNIFF_BYTES, from);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/** Total bytes of the ID3v2 tag at the start of `head`, or null if malformed. */
function id3TagLength(head: Buffer): number | null {
  if (head.length < 10) return null;
  const flags = head[5];
  let size = 0;
  for (let i = 6; i < 10; i += 1) {
    // Syncsafe: seven bits per byte, so a size byte can never look like a frame
    // sync. A set top bit means this is not a size field we understand.
    if (head[i] & 0x80) return null;
    size = (size << 7) | head[i];
  }
  const footer = (flags & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}
