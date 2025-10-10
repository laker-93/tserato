import { HotCueType } from './hotCueType';
import { SeratoColor } from './seratoColor';
import { Buffer } from 'buffer';

function writeNullTerminatedString(str: string): Uint8Array {
    const encoder = new TextEncoder();
    const strBytes = encoder.encode(str);
    const result = new Uint8Array(strBytes.length + 1); // +1 for null terminator
    result.set(strBytes, 0);
    result[strBytes.length] = 0;
    return result;
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    let totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    let result = new Uint8Array(totalLength);
    let offset = 0;
    arrays.forEach(arr => {
        result.set(arr, offset);
        offset += arr.length;
    });
    return result;
}

function encodeElement(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = writeNullTerminatedString(name);
    const lengthBytes = new Uint8Array(4);
    new DataView(lengthBytes.buffer).setUint32(0, data.length, false); // big endian
    return concatUint8Arrays([nameBytes, lengthBytes, data]);
}

export interface HotCueData {
  name: string;
  type: HotCueType;
  start: number;
  index: number;
  end?: number | null;
  isLocked?: boolean;
  color?: SeratoColor;
}

export class HotCue implements HotCueData {
  name: string;
  type: HotCueType;
  start: number;
  index: number;
  end?: number | null;
  isLocked?: boolean;
  color: SeratoColor;

  constructor(data: HotCueData) {
    this.name = data.name;
    this.type = data.type;
    this.start = data.start;
    this.index = data.index;
    this.end = data.end ?? null;
    this.isLocked = data.isLocked ?? false;
    this.color = data.color ?? SeratoColor.RED;
  }

  toString(): string {
    const startStr = `${this.start}ms`;
    const endStr = this.end != null ? ` | End: ${this.end}ms` : '';
    return `Start: ${startStr}${endStr} | Index: ${String(this.index).padStart(2)} | Name: ${this.name} | Color: ${this.color}`;
  }

  toV2Bytes(): Buffer {
    if (this.type === HotCueType.CUE) return this.cueToV2Bytes();
    if (this.type === HotCueType.LOOP) return this.loopToV2Bytes();
    throw new Error(`unsupported hotcue type ${this.type}`);
  }

  private loopToV2Bytes(): Buffer {
    let nameBytes = writeNullTerminatedString(this.name);
    let buf = new Uint8Array(0x14 + nameBytes.length);
    let dv = new DataView(buf.buffer);

    buf[0x0] = 0x00; // flags? (unused in parse)
    buf[0x1] = this.index;
    dv.setUint32(0x02, this.start, false);
    dv.setUint32(0x06, this.end!, false);
    buf[0x0e] = 0;
    buf[0x0f] = 0;
    buf[0x10] = 255;
    buf[0x11] = 255;
    buf[0x13] = 1;
    buf.set(nameBytes, 0x14);

    return Buffer.from(encodeElement("LOOP", buf));
  }

  private cueToV2Bytes(): Buffer {
    const parts: Buffer[] = [];

    // >B (unsigned char, big-endian)
    parts.push(Buffer.from([0]));

    // >B self.index
    parts.push(Buffer.from([this.index]));

    // >I self.start (4-byte big-endian unsigned int)
    const startBuf = Buffer.alloc(4);
    startBuf.writeUInt32BE(this.start, 0);
    parts.push(startBuf);

    // >B 0
    parts.push(Buffer.from([0]));

    // >3s color (3 raw bytes from hex string)
    const colorBuf = Buffer.from(this.color, "hex");
    if (colorBuf.length !== 3) {
      throw new Error(`Color must be 3 bytes (e.g. "ff0000"), got ${this.color}`);
    }
    parts.push(colorBuf);

    // >B 0
    parts.push(Buffer.from([0]));

    parts.push(Buffer.from([1]));

    parts.push(Buffer.from(this.name, "utf8"));

    // >B 0 (null terminator after name)
    parts.push(Buffer.from([0]));

    const data = Buffer.concat(parts);

    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);

    const payload = Buffer.concat([
      Buffer.from("CUE", "ascii"),
      Buffer.from([0]),
      lenBuf,
      data,
    ]);

    return payload;
  }

  static fromBytes(data: Buffer, hotcueType: HotCueType): HotCue {
    let offset = 1; // skip first null
    if (hotcueType === HotCueType.CUE) {
        const index = data.readUInt8(offset);
        offset += 1;
        const start = data.readUInt32BE(offset);
        offset += 4;
        offset += 1; // skip null / position end
        offset += 0; // skip placeholder
        const colorBytes = data.slice(offset, offset + 3);
        offset += 3;
        offset += 1; // skip null
        const locked = data.readUInt8(offset) !== 0;
        offset += 1;
        const nameBuf = data.slice(offset).subarray(0, data.slice(offset).indexOf(0));
        const name = nameBuf.toString("utf-8");

        const colorHex = colorBytes.toString("hex").toUpperCase();
        const color = (Object.values(SeratoColor).includes(colorHex as SeratoColor)
          ? (colorHex as SeratoColor)
          : SeratoColor.RED);

        return new HotCue({
          name,
          type: HotCueType.CUE,
          index,
          start,
          color,
          isLocked: locked,
        });
    }
    else if (hotcueType === HotCueType.LOOP) {
        const index = data.readUInt8(offset); offset += 1;
        const start = data.readUInt32BE(offset); offset += 4;
        const end = data.readUInt32BE(offset); offset += 4;

        // Skip to offset 0x0E
        offset = 0x0E;

        // skip color placeholder bytes (0x0E–0x11)
        offset += 2; // 0x0E, 0x0F
        offset += 2; // 0x10, 0x11
        offset += 1; // 0x12 (padding)

        const isLocked = Boolean(data.readUInt8(offset)); offset += 1;

        // read null-terminated name
        const nameEnd = data.indexOf(0x00, offset);
        const name = data.toString("utf8", offset, nameEnd === -1 ? data.length : nameEnd);
        return new HotCue({
          name,
          type: HotCueType.CUE,
          index,
          start,
          end: end,
          color: SeratoColor.RED,
          isLocked: isLocked,
        });
  }

  else {
    throw new Error(`Unknown hotcue type: ${hotcueType}`);
  }

  }
}
