import { HotCue } from '../../../src/model/hotCue';
import { HotCueType } from '../../model/hotCueType';
import { Track } from '../../model/track';
import { BaseEncoder } from '../baseEncoder';
import { SERATO_MARKERS_V2 } from '../serato_tags';
import MP3Tag from 'mp3tag.js'
import { splitString } from '../../util';

const fs = require('fs')

/**
 * Replacement for Python's BytesIO
 */
class BufferReader {
  private offset = 0;
  constructor(private buffer: Buffer) {}

  read(n: number): Buffer {
    const chunk = this.buffer.slice(this.offset, this.offset + n);
    this.offset += n;
    return chunk;
  }

  readUInt8(): number {
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUInt32BE(): number {
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }
}

export class V2Mp3Encoder extends BaseEncoder {

  get tagName(): string {
    return SERATO_MARKERS_V2;
  }

  get tagVersion(): Buffer {
    return Buffer.from([0x01, 0x01]);
  }

  get markersName(): string {
    return "Serato Markers2";
  }

  write(track: Track): void {
    const payload = this._encode(track);
    this._write(track, payload);
  }

  readCues(track: Track): HotCue[] {

    // Read the buffer of an audio file
    const buffer = fs.readFileSync(track.path.toString())
    
    // Now, pass it to MP3Tag
    const mp3tag = new MP3Tag(buffer, true)
    
    mp3tag.read()
    
    const geob = mp3tag.tags.v2?.GEOB

    if (!geob) {
      return [];
    }

    const data = Buffer.from(geob[0].object);
    return Array.from(this._decode(data));
  }

  private *_decode(data: Buffer): IterableIterator<HotCue> {
    const fp = new BufferReader(data);

    // Expect version 0x01, 0x01
    const a = fp.readUInt8();
    const b = fp.readUInt8();
    if (a !== 0x01 || b !== 0x01) {
      throw new Error("Invalid Serato markers header");
    }

    const payload = fp.read(data.length - 2);
    let processed = this._removeNullPadding(payload);
    processed = this._padEncodedData(processed);

    const decoded = Buffer.from(processed.toString(), "base64");
    const fp2 = new BufferReader(decoded);

    const a2 = fp2.readUInt8();
    const b2 = fp2.readUInt8();
    if (a2 !== 0x01 || b2 !== 0x01) {
      throw new Error("Invalid decoded header");
    }

    while (true) {
      const entryName = this._getEntryName(fp2);
      if (entryName.length === 0) {
        break;
      }

      const structLength = fp2.readUInt32BE();
      if (structLength <= 0) throw new Error("Invalid struct length");

      const entryData = fp2.read(structLength);

      switch (entryName) {
        case "COLOR":
          // not yet implemented
          continue;
        case "CUE":
          yield HotCue.fromBytes(entryData, HotCueType.CUE);
          continue
        case "LOOP":
          yield HotCue.fromBytes(entryData, HotCueType.LOOP);
          continue
        case "BPMLOCK":
          // not yet implemented
          continue;
      }
    }
  }

  private _removeNullPadding(payload: Buffer): Buffer {
    const nullIndex = payload.indexOf(0x00);
    return nullIndex >= 0 ? payload.slice(0, nullIndex) : payload;
  }

  private _getEntryName(fp: BufferReader): string {
    const bytes: number[] = [];
    while (true) {
      const byte = fp.read(1)[0];
      if (byte === 0x00) break;
      bytes.push(byte);
    }
    return Buffer.from(bytes).toString("utf-8");
  }

  private _padEncodedData(data: Buffer): Buffer {
    const len = data.length;
    let padding: Buffer;
    if (len % 4 === 1) {
      padding = Buffer.from("A==");
    } else {
      padding = Buffer.from("=".repeat((-len % 4 + 4) % 4));
    }
    return Buffer.concat([data, padding]);
  }

  private _write(track: Track, payload: Buffer): void {
    // Read the buffer of an audio file
    const buffer = fs.readFileSync(track.path.toString())
    
    const mp3tag = new MP3Tag(buffer, true)
    
    mp3tag.read()
    
    // Write the ID3v2 tags.
    // See https://mp3tag.js.org/docs/frames.html for the list of supported ID3v2 frames
    
    const object = Array.from(payload)
    mp3tag.tags.v2!.GEOB = [
      {
        format: 'application/octet-stream',
        filename: "",
        object: object,
        description: this.markersName,
      }
    ]
    
    // Save the tags
    mp3tag.save({id3v2: {encoding: "latin1"}})
    
    // Handle error if there's any
    if (mp3tag.error !== '') throw new Error(mp3tag.error)
    
    // Read the new buffer again
    mp3tag.read()
    
    // Write the new buffer to file
    fs.writeFileSync(track.path.toString(), mp3tag.buffer)
  }

  private _encode(track: Track): Buffer {
    let payload = Buffer.alloc(0);
    for (const cue of track.hotCues) {
      payload = Buffer.concat([payload, cue.toV2Bytes()]);
    }
    for (const cue of track.cueLoops) {
      payload = Buffer.concat([payload, cue.toV2Bytes()]);
    }
    return this._pad(payload);
  }

  private _pad(payload: Buffer, entriesCount?: number): Buffer {
    // prepend tag version
    payload = Buffer.concat([this.tagVersion, payload]);

    payload = this._removeEncodedDataPad(Buffer.from(payload.toString("base64")));
    payload = this._padPayload(splitString(payload));
    payload = this._enrichPayload(payload, entriesCount);

    return payload;
  }

  private _removeEncodedDataPad(data: Buffer): Buffer {
    return Buffer.from(data.toString().replace(/=/g, "A"));
  }

  private _padPayload(payload: Buffer): Buffer {
    const length = payload.length;
    if (length < 468) {
      return Buffer.concat([payload, Buffer.alloc(468 - length)]);
    }
    return Buffer.concat([payload, Buffer.alloc(982 - length), Buffer.from([0x00])]);
  }

  private _enrichPayload(payload: Buffer, entriesCount?: number): Buffer {
    let header = this.tagVersion;
    if (entriesCount !== undefined) {
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(entriesCount, 0);
      header = Buffer.concat([header, buf]);
    }
    return Buffer.concat([header, payload]);
  }
}