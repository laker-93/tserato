import { HotCue } from '../../model/hotCue';
import { HotCueType } from '../../model/hotCueType';
import { Track } from '../../model/track';
import { BaseEncoder } from '../baseEncoder';
import { SERATO_MARKERS_V2 } from '../serato_tags';
import { splitString } from '../../util';
import { openTrack } from '../geob';
import { probeContainer, tagIOFor, UnsupportedContainerError } from '../io';
import { TrackMeta } from '../../model/trackMeta';

/**
 * Replacement for Python's BytesIO
 *
 * Reads past the end of the buffer return short (or empty) rather than
 * throwing, so callers must check `remaining` before reading a fixed-width
 * field. A truncated frame has to terminate the decode loop, not run it
 * forever -- this runs in Electron's main process, where a hang is fatal to
 * the whole app.
 */
class BufferReader {
  private offset = 0;
  constructor(private buffer: Buffer) {}

  get remaining(): number {
    return Math.max(0, this.buffer.length - this.offset);
  }

  read(n: number): Buffer {
    const chunk = this.buffer.slice(this.offset, this.offset + n);
    this.offset += chunk.length;
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

export class V2Encoder extends BaseEncoder {

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

  /**
   * Still MP3-only: these are ordinary ID3 text frames, not Serato tags, so
   * they are outside what TagIO covers. Nothing in subbox calls it.
   */
  readMetaData(track: Track): TrackMeta {
    const file = track.path.toString();
    const { container } = probeContainer(file);
    if (container !== 'MP3') {
      throw new UnsupportedContainerError(container, file);
    }
    const mp3tag = openTrack(file)
    const v2 = mp3tag.tags.v2
    return {
      title: v2?.TIT2,
      artist: v2?.TPE1,
      album: v2?.TALB
    }
  }

  /**
   * The track's cues, or [] where it has none.
   *
   * Throws UnsupportedContainerError for a container tserato cannot read yet.
   * That is deliberately not an empty list: a caller cannot tell "no cues" from
   * "not looked at" if both come back the same, and downstream that difference
   * is the difference between keeping the user's cues and dropping them.
   */
  readCues(track: Track): HotCue[] {
    const data = tagIOFor(track.path.toString()).read(this.markersName);

    if (!data) {
      // Either the file has no Serato tags at all, or it was analysed by
      // something that did not write cues. Neither is an error.
      return [];
    }

    return Array.from(this._decode(data));
  }

  private *_decode(data: Buffer): IterableIterator<HotCue> {
    if (data.length < 2) {
      return;
    }

    const fp = new BufferReader(data);

    // Expect version 0x01, 0x01
    const a = fp.readUInt8();
    const b = fp.readUInt8();
    if (a !== 0x01 || b !== 0x01) {
      throw new Error("Invalid Serato markers header");
    }

    const payload = fp.read(data.length - 2);
    let processed = this._removeNullPadding(payload);
    // Serato splits the base64 at 72 characters with newlines; they are not
    // part of the encoded data and must come out before the length-derived
    // padding is computed.
    processed = Buffer.concat(processed.toString("latin1").split("\n").map((s) => Buffer.from(s, "latin1")));
    processed = this._padEncodedData(processed);

    const decoded = Buffer.from(processed.toString(), "base64");
    if (decoded.length < 2) {
      return;
    }
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

      // A truncated frame leaves fewer than four bytes for the length field.
      if (fp2.remaining < 4) {
        break;
      }
      const structLength = fp2.readUInt32BE();
      if (structLength <= 0) throw new Error("Invalid struct length");

      const entryData = fp2.read(structLength);
      if (entryData.length < structLength) {
        // The frame claims more data than it carries; stop rather than decode
        // a short buffer.
        break;
      }

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
      const chunk = fp.read(1);
      // End of buffer. Without this the loop pushes `undefined` forever and
      // grows `bytes` until V8 aborts the process outright -- an uncatchable
      // crash, not an exception.
      if (chunk.length === 0) return "";
      const byte = chunk[0];
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
    // Replaces only our own tag; see writeGeobFrame and FlacTagIO for why that
    // matters.
    tagIOFor(track.path.toString()).write(this.markersName, payload);
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
