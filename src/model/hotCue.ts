import { HotCueType } from './hotCueType';
import { SeratoColor } from './seratoColor';
import { Buffer } from 'buffer';

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
    const parts: Buffer[] = [
      Buffer.from([0]),
      Buffer.from([this.index]),
      Buffer.alloc(4), // start
      Buffer.alloc(4), // end
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00]),
      Buffer.from([0xaa, 0xe1, 0x00]), // placeholder color
      Buffer.from([0]),
      Buffer.from([this.isLocked ? 1 : 0]),
      Buffer.from(this.name, "utf-8"),
      Buffer.from([0]),
    ];
    parts[2].writeUInt32BE(this.start ?? 0, 0);
    parts[3].writeUInt32BE(this.end ?? 0, 0);

    const data = Buffer.concat(parts);
    const header = Buffer.concat([Buffer.from("LOOP\0", "utf-8"), Buffer.alloc(4)]);
    header.writeUInt32BE(data.length, 5); // offset 5 after "LOOP\0"
    return Buffer.concat([header, data]);
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

    // name (utf-8)
    parts.push(Buffer.from(this.name, "utf8"));

    // >B 0 (null terminator after name)
    parts.push(Buffer.from([0]));

    // Join the inner payload
    const data = Buffer.concat(parts);

    // Now wrap: b"CUE" + b"\x00" + struct.pack(">I", len(data)) + data
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
    if (hotcueType !== HotCueType.CUE) {
      throw new Error("loop is unsupported. TODO implement");
    }
    let offset = 1; // skip first null
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
}
