import { Buffer } from 'buffer';

const INVALID_CHARACTERS_REGEX = /[^A-Za-z0-9_ ]/i;

export function splitString(input: Buffer, after: number = 72, delimiter: Buffer = Buffer.from('\n')): Buffer {
  const pieces: Buffer[] = [];
  let buf = Buffer.from(input);
  while (buf.length > 0) {
    pieces.push(buf.slice(0, after));
    buf = buf.slice(after);
  }
  return Buffer.concat(pieces.reduce<Buffer[]>((acc, p, i) => {
    if (i) acc.push(delimiter);
    acc.push(p);
    return acc;
  }, []));
}


export function seratoDecode(buffer: Buffer): string {
  let result = "";

  for (let i = 0; i + 1 < buffer.length; i += 2) {
    // Take 2 bytes
    const chunk = buffer.slice(i, i + 2);

    // Reverse bytes (Python: chunk[::-1])
    const reversed = Buffer.from([chunk[1], chunk[0]]);

    // Decode as UTF-16LE (Node uses LE explicitly)
    result += reversed.toString("utf16le");
  }

  return result;
}


export function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

export function latin1Encode(str: string): Uint8Array {
  return Uint8Array.from(Buffer.from(str, "latin1"));
}

export function intToBytes(value: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    // big-endian
    bytes[length - 1 - i] = (value >> (8 * i)) & 0xff;
  }
  return bytes;
}

export function seratoEncode(s: string): Uint8Array {
  const result: number[] = [];

  for (const c of s) {
    const codePoint = c.charCodeAt(0); // UTF-16 code unit
    // Big-endian: high byte first, then low byte
    result.push((codePoint >> 8) & 0xff);
    result.push(codePoint & 0xff);
  }

  return Uint8Array.from(result);
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(INVALID_CHARACTERS_REGEX, '-');
}

export class DuplicateTrackError extends Error {}

/**
 * Return a Buffer that owns its whole ArrayBuffer, copying only if it does not.
 *
 * mp3tag.js parses through the underlying ArrayBuffer and ignores the view's
 * byteOffset, so a Buffer that is a window into a larger allocation decodes
 * from the wrong bytes. Node 24's fs.readFileSync serves files out of a shared
 * 64 KiB pool, so every read after the first is such a window and the tags
 * come back from whichever file happens to sit at the start of the pool --
 * silently, with no error. Node 22, which is what Electron 39 ships, does not
 * pool, which is why this only shows up on newer runtimes.
 */
export function unpooledBuffer(buf: Buffer): Buffer {
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) return buf;
  return Buffer.from(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
