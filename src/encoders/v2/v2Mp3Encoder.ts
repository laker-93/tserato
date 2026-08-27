import { HotCue } from '../../model/hotCue';
import { HotCueType } from '../../model/hotCueType';
import { Track } from '../../model/track';
import { BaseEncoder } from '../baseEncoder';
import { SERATO_MARKERS_V2 } from '../serato_tags';
import MP3Tag from 'mp3tag.js'
import { splitString, unpooledBuffer } from '../../util';
import { TrackMeta } from '../../model/trackMeta';

const fs = require('fs')

/**
 * Every buffer handed to mp3tag.js has to own its ArrayBuffer -- see
 * unpooledBuffer. Reading a track any other way decodes the wrong file.
 */
function readTrackFile(path: string): Buffer {
  return unpooledBuffer(fs.readFileSync(path))
}

interface Geob {
  format: string;
  filename: string;
  object: number[];
  description: string;
}

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

  readMetaData(track: Track): TrackMeta {
    const buffer = readTrackFile(track.path.toString())
    
    const mp3tag = new MP3Tag(buffer, true)
    
    mp3tag.read();
    const v2 = mp3tag.tags.v2
    return {
      title: v2?.TIT2,
      artist: v2?.TPE1,
      album: v2?.TALB
    }
  }

  readCues(track: Track): HotCue[] {

    // Read the buffer of an audio file
    const buffer = readTrackFile(track.path.toString())
    
    // Now, pass it to MP3Tag
    const mp3tag = new MP3Tag(buffer, true)
    
    mp3tag.read()

    // A track Serato has analysed carries six GEOB frames -- Analysis,
    // BeatGrid, Autotags, Markers_, Markers2 and Overview -- in no guaranteed
    // order. Only Markers2 holds the cues, so it has to be found by
    // description; taking GEOB[0] reads whichever frame happens to come first
    // and fails the version check on every real Serato library.
    const frame = this._findMarkers2(mp3tag.tags.v2?.GEOB)

    if (!frame) {
      // Either the file has no Serato frames at all, or it was analysed by
      // something that did not write cues. Neither is an error.
      return [];
    }

    const data = Buffer.from(frame.object);
    return Array.from(this._decode(data));
  }

  private _findMarkers2(geob: Geob[] | undefined): Geob | undefined {
    return geob?.find((f) => f.description === this.markersName);
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
    // Read the buffer of an audio file
    const buffer = readTrackFile(track.path.toString())
    
    const mp3tag = new MP3Tag(buffer, true)
    
    mp3tag.read()
    
    // Write the ID3v2 tags.
    // See https://mp3tag.js.org/docs/frames.html for the list of supported ID3v2 frames
    
    const object = Array.from(payload)
    const frame: Geob = {
      format: 'application/octet-stream',
      filename: "",
      object: object,
      description: this.markersName,
    }

    // Replace only our own frame. Assigning the whole GEOB array discards the
    // five frames Serato owns -- the beatgrid, the waveform overview and the
    // BPM/key analysis it spent minutes computing -- which the user cannot get
    // back without re-analysing, losing any manual gridding with it.
    const existing: Geob[] = mp3tag.tags.v2!.GEOB ?? []
    const at = existing.findIndex((f) => f.description === this.markersName)
    mp3tag.tags.v2!.GEOB = at >= 0
      ? existing.map((f, i) => (i === at ? frame : f))
      : [...existing, frame]
    
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
