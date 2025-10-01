import * as fs from 'fs';
import * as path from 'path';
import { BaseEncoder } from './encoders/baseEncoder';
import { Crate } from './model/crate';
import { Track } from './model/track';
import { seratoEncode, seratoDecode, concatBytes, intToBytes, latin1Encode } from './util';

const DEFAULT_SERATO_FOLDER = path.join(process.env.HOME || process.cwd(), 'Music', '_Serato_');

export class Builder {
  private _encoder?: BaseEncoder;
  constructor(encoder?: BaseEncoder) { this._encoder = encoder; }

  private static *_resolvePath(root: Crate): Generator<[Crate, string]> {
    let pathStr = '';
    const stack: Array<[Crate, string]> = [[root, pathStr]];
    while (stack.length) {
      const [crate, p] = stack.pop() as [Crate, string];
      let newPath = p + `${crate.name}%%`;
      const children = crate.children;
      if (children && children.length) {
        for (const child of children) stack.push([child, newPath]);
      }
      yield [crate, newPath.replace(/%%$/, '') + '.crate'];
    }
  }

  private static *_parseCrateNames(filepath: string): Generator<string> {
    const parts = path.basename(filepath).split('%%');
    for (const p of parts) yield p.replace('.crate', '');
  }

  private *_buildCrateFilepath(crate: Crate, seratoFolder: string): Generator<[Crate, string]> {
    const subcrateFolder = path.join(seratoFolder, 'SubCrates');
    if (!fs.existsSync(subcrateFolder)) fs.mkdirSync(subcrateFolder, { recursive: true });
    for (const [c, p] of Builder._resolvePath(crate)) {
      yield [c, path.join(subcrateFolder, p)];
    }
  }

  parseCratesFromRootPath(subcratePath: string): Record<string, Crate> {
    const result: Record<string, Crate> = {};
    const entries = fs.readdirSync(subcratePath);
    for (const name of entries) {
      if (!name.endsWith('crate')) continue;
      const full = path.join(subcratePath, name);
      const crate = this._buildCratesFromFilepath(full);
      if (result[crate.name]) {
        const merged_crate = crate.plus(result[crate.name])
        result[crate.name] = merged_crate;
      } else {
        result[crate.name] = crate;
      }
    }
    return result;
  }

  private _buildCratesFromFilepath(filepath: string): Crate {
    const crateNames = Array.from(Builder._parseCrateNames(filepath));
    let childCrate: Crate | null = null;
    let crate: Crate | null = null;
    for (const crateName of crateNames.reverse()) {
      if (childCrate == null) {
        crate = new Crate(crateName);
        for (const filePath of this._parseCrateTracks(filepath)) {
          const t = Track.fromPath(filePath);
          crate.addTrack(t);
        }
        childCrate = crate;
      } else {
        crate = new Crate(crateName, [childCrate]);
        childCrate = crate;
      }
    }
    if (!crate) throw new Error(`no crates parsed from ${filepath}`);
    return crate;
  }

  private *_parseCrateTracks(filepath: string): Generator<string> {
    let buffer = fs.readFileSync(filepath);
    buffer = Buffer.from(buffer);
    while (buffer.length > 0) {
      const otrkIdx = buffer.indexOf(Buffer.from('otrk'));
      if (otrkIdx < 0) break;
      const ptrkIdx = buffer.indexOf(Buffer.from('ptrk'), otrkIdx);
      if (ptrkIdx < 0) break;
      const ptrkSection = buffer.slice(ptrkIdx);
      const trackNameLength = ptrkSection.readUInt32BE(4);
      const trackNameEncoded = ptrkSection.slice(8, 8 + trackNameLength);
      let filePath = seratoDecode(trackNameEncoded);
      if (!filePath.startsWith('/')) filePath = '/' + filePath;
      yield filePath;
      buffer = ptrkSection.slice(8 + trackNameLength);
    }
  }

  private _construct(crate: Crate): Uint8Array {
    // ----- HEADER -----
    let header = concatBytes([
      latin1Encode("vrsn"),
      intToBytes(0, 1),
      intToBytes(0, 1),
      seratoEncode("81.0"),
      seratoEncode("/Serato ScratchLive Crate"),
    ]);

    // ----- DEFAULT COLUMNS -----
    const DEFAULT_COLUMNS = ["track", "artist", "album", "length"];

    const parts: Uint8Array[] = [];
    for (const column of DEFAULT_COLUMNS) {
      parts.push(latin1Encode("ovct"));
      parts.push(intToBytes(column.length * 2 + 18, 4));

      parts.push(latin1Encode("tvcn"));
      parts.push(intToBytes(column.length * 2, 4));
      parts.push(seratoEncode(column));

      parts.push(latin1Encode("tvcw"));
      parts.push(intToBytes(2, 4));
      parts.push(latin1Encode("0"));
      parts.push(latin1Encode("0"));

    }
    const columnSection = concatBytes(parts);

    // ----- PLAYLIST SECTION -----

    const playlistParts: Uint8Array[] = [];
    if (crate.tracks) {
      for (const track of crate.tracks) {
        if (this._encoder) {
          this._encoder.write(track);
        }
        const absoluteTrackPath = path.resolve(track.path);

        const otrkSize = intToBytes(absoluteTrackPath.length * 2 + 8, 4);
        const ptrkSize = intToBytes(absoluteTrackPath.length * 2, 4);

        playlistParts.push(latin1Encode("otrk"));
        playlistParts.push(otrkSize);
        playlistParts.push(latin1Encode("ptrk"));
        playlistParts.push(ptrkSize);
        playlistParts.push(seratoEncode(absoluteTrackPath));

      }
    }
    const playlistSection = concatBytes(playlistParts);

    // ----- FINAL CONTENTS -----
    const contents = concatBytes([header, columnSection, playlistSection]);
    return contents;
  }


  save(root: Crate, savePath: string = DEFAULT_SERATO_FOLDER, overwrite = false) {
    for (const [crate, filepath] of this._buildCrateFilepath(root, savePath)) {
      if (fs.existsSync(filepath) && !overwrite) continue;
      const buffer = this._construct(crate);
      fs.writeFileSync(filepath, buffer);
    }
  }
}
