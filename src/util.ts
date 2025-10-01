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

export function seratoDecode(s: Buffer): string {
  // Decodes Serato 4-byte blocks into UTF-16-encoded string
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const block = s.slice(i, i + 4);
    if (block.length < 4) break;
    const w = block.readUInt8(0);
    const x = block.readUInt8(1);
    const y = block.readUInt8(2);
    const z = block.readUInt8(3);
    const c = (z & 0x7F) | ((y & 0x01) << 7);
    const b = ((y & 0x7F) >> 1) | ((x & 0x03) << 6);
    const a = ((x & 0x7F) >> 2) | ((w & 0x07) << 5);
    out.push(a, b, c);
  }
  // Interpret as UTF-16-BE pairs
  // Convert bytes to string by grouping into 2-byte code units
  const bytes = Buffer.from(out);
  let str = '';
  for (let i = 0; i < bytes.length; i += 2) {
    const hi = bytes[i];
    const lo = (i + 1) < bytes.length ? bytes[i+1] : 0;
    const code = (hi << 8) | lo;
    if (code === 0) break;
    str += String.fromCharCode(code);
  }
  return str;
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
