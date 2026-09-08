import { findGeobFrame, openTrack, writeGeobFrame } from '../geob';
import { TagIO } from './tagIO';

/**
 * Serato tags in an MP3's ID3v2 GEOB frames -- the path this library has always
 * taken, now behind the same interface as the others.
 */
export class Mp3TagIO implements TagIO {
  constructor(private readonly file: string) {}

  read(description: string): Buffer | null {
    const frame = findGeobFrame(openTrack(this.file).tags.v2?.GEOB, description);
    return frame ? Buffer.from(frame.object) : null;
  }

  write(description: string, payload: Buffer): void {
    writeGeobFrame(this.file, description, payload);
  }
}
