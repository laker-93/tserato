import { Track } from '../../model/track';
import { Tempo } from '../../model/tempo';
import { BaseEncoder } from '../baseEncoder';
import { SERATO_BEATGRID } from '../serato_tags';
import { findGeobFrame, openTrack, writeGeobFrame } from '../geob';

/**
 * The byte after the markers. Nobody knows what it is for: the most complete
 * public description of the format calls it "apparently random"
 * (Holzhaus/serato-tags, docs/serato_beatgrid.md), and it is the one field here
 * that is neither structure nor data we can interpret.
 *
 * Every file observed carries 0x00 -- 34 Serato-authored files on the QA
 * machine, gridded and ungridded alike -- so this is what we write when there
 * is nothing to copy. When there *is* something to copy we copy it, because the
 * rule for a byte we cannot read is the rule for the sibling GEOB frames: do
 * not overwrite what you cannot reproduce.
 */
const DEFAULT_FOOTER = 0x00;

const HEADER_BYTES = 6; // version (2) + marker count (4)
const MARKER_BYTES = 8;

/**
 * Reads and writes `GEOB:Serato BeatGrid`.
 *
 * The layout, verified by decoding real analysed files rather than taken from a
 * reverse-engineering write-up:
 *
 *     version   uint8 uint8      = (1, 0)      # note: Markers2 is (1, 1)
 *     n_markers uint32be
 *     n-1 x     float32be position_s, uint32be beats_till_next
 *     1 x       float32be position_s, float32be bpm      # terminal marker
 *     footer    1 byte                        # meaning unknown; copied, not set
 *
 * This agrees field for field with Holzhaus/serato-tags, which was checked
 * against it after the fact. Two things that write-up leaves open are settled
 * here empirically: the version bytes it records only as "?" are (1, 0) on all
 * 34 Serato-authored files on the QA machine, and the footer it calls
 * "apparently random" is 0x00 on all 34. Neither is relied on -- an unfamiliar
 * version reads as "no grid", and the footer is copied from the file.
 *
 * Worked examples:
 *
 *     0100 00000001 3d3c3e82 432f0000 00   1 marker, pos=0.045958s, bpm=175.0
 *     0100 00000000 00                     analysed but not gridded
 *
 * That second state is common and is not an error: Serato writes the frame with
 * zero markers for a track it has analysed but never gridded. It decodes to an
 * empty grid, exactly as a missing frame does.
 *
 * Positions are float32 in the frame, so a value read back will not be bit-
 * equal to the double that went in.
 *
 * This library writes to the user's *own* music files, so the bias throughout
 * is towards declining rather than guessing: a wrong grid puts every hot cue on
 * the track off-beat, which is a worse outcome than no grid at all.
 *
 * MP3 only, matching the cue side.
 */
export class BeatgridMp3Encoder extends BaseEncoder {
  get tagName(): string {
    return SERATO_BEATGRID;
  }

  get tagVersion(): Buffer {
    return Buffer.from([0x01, 0x00]);
  }

  get markersName(): string {
    return SERATO_BEATGRID;
  }

  /**
   * The track's grid, or an empty list where it has none.
   *
   * Absent, present-but-ungridded and unreadable all give an empty grid, so a
   * sweep over a real library throws nothing. A caller that must tell "no
   * frame" from "not gridded" should look for the frame itself.
   */
  readBeatgrid(track: Track): Tempo[] {
    const mp3tag = openTrack(track.path.toString());
    const frame = findGeobFrame(mp3tag.tags.v2?.GEOB, this.markersName);
    if (!frame) {
      return [];
    }
    try {
      return this._decode(Buffer.from(frame.object));
    } catch {
      // Reading runs in Electron's main process against files this library did
      // not write. One malformed frame must not take the app down.
      return [];
    }
  }

  /**
   * The trailing byte of the track's existing beatgrid frame, if it has one.
   *
   * Separate from readBeatgrid because it is not part of the grid -- it is a
   * byte we carry rather than a byte we understand.
   */
  readFooter(track: Track): number {
    try {
      const frame = findGeobFrame(
        openTrack(track.path.toString()).tags.v2?.GEOB,
        this.markersName
      );
      if (!frame) {
        return DEFAULT_FOOTER;
      }
      const data = Buffer.from(frame.object);
      return data.length > 0 ? data.readUInt8(data.length - 1) : DEFAULT_FOOTER;
    } catch {
      return DEFAULT_FOOTER;
    }
  }

  write(track: Track): void {
    // The file being written is very often one Serato has analysed and left
    // ungridded, which already has this frame and so already has a footer byte.
    // Writing a grid into it must not replace that byte with a guess.
    const payload = this._encode(track.beatgrid, this.readFooter(track));
    // Replaces only our own frame; see writeGeobFrame for why that matters.
    writeGeobFrame(track.path.toString(), this.markersName, payload);
  }

  _decode(data: Buffer): Tempo[] {
    if (data.length < HEADER_BYTES) {
      throw new Error('beatgrid frame is too short to carry a header');
    }
    if (data.readUInt8(0) !== 0x01 || data.readUInt8(1) !== 0x00) {
      // (1, 1) is Markers2. Reading it as a grid would yield plausible garbage.
      throw new Error(
        `unexpected beatgrid version (${data.readUInt8(0)}, ${data.readUInt8(1)})`
      );
    }
    const count = data.readUInt32BE(2);
    if (data.length < HEADER_BYTES + count * MARKER_BYTES) {
      throw new Error(`beatgrid claims ${count} markers but is too short for them`);
    }

    const grid: Tempo[] = [];
    for (let i = 0; i < count; i += 1) {
      const at = HEADER_BYTES + i * MARKER_BYTES;
      const position = data.readFloatBE(at);
      if (i === count - 1) {
        grid.push({ position, bpm: data.readFloatBE(at + 4), beatsTillNext: null });
      } else {
        grid.push({ position, bpm: null, beatsTillNext: data.readUInt32BE(at + 4) });
      }
    }
    return grid;
  }

  _encode(grid: Tempo[], footer: number = DEFAULT_FOOTER): Buffer {
    const out = Buffer.alloc(HEADER_BYTES + grid.length * MARKER_BYTES + 1);
    this.tagVersion.copy(out, 0);
    out.writeUInt32BE(grid.length, 2);

    grid.forEach((tempo, i) => {
      if (tempo.position == null) {
        throw new Error(`beatgrid marker ${i} has no position`);
      }
      const at = HEADER_BYTES + i * MARKER_BYTES;
      out.writeFloatBE(tempo.position, at);

      // Strict on write. The two marker shapes are the same width -- a uint32
      // beat count sits exactly where a float32 bpm does -- so a grid whose
      // model disagrees with its position in the list would encode to plausible
      // garbage that nothing downstream can detect. Refuse it here instead.
      if (i === grid.length - 1) {
        if (tempo.bpm == null) {
          throw new Error('the last beatgrid marker must carry a bpm');
        }
        out.writeFloatBE(tempo.bpm, at + 4);
      } else {
        if (tempo.beatsTillNext == null) {
          throw new Error(
            `beatgrid marker ${i} is not the last and must carry beatsTillNext`
          );
        }
        out.writeUInt32BE(tempo.beatsTillNext, at + 4);
      }
    });

    out.writeUInt8(footer, out.length - 1);
    return out;
  }
}
