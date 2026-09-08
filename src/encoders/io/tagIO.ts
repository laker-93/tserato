import { Container } from './container';

/**
 * Where a Serato tag lives in a file, separated from what the tag means.
 *
 * Serato's payloads are container-independent: the same `Serato Markers2` bytes
 * appear in an MP3's ID3 GEOB frame and inside a FLAC's Vorbis comment, and the
 * encoders decode them with exactly the same code. What differs is retrieval --
 * where the blob sits and what is wrapped around it -- so that is all this
 * interface covers. Nothing behind it knows what a hot cue or a beat grid is.
 *
 * `description` is the Serato tag name ("Serato Markers2", "Serato BeatGrid"):
 * the GEOB frame description in ID3, and the thing each implementation maps to
 * its container's own field name.
 */
export interface TagIO {
  /** The tag's raw payload, or null where the file does not carry it. */
  read(description: string): Buffer | null;
  /** Replace that payload, leaving every other tag in the file alone. */
  write(description: string, payload: Buffer): void;
}

/**
 * Thrown for a container tserato cannot read yet, rather than returning an
 * empty result.
 *
 * The distinction matters downstream. subbox sends a track's cues to the server
 * as a manifest, and "this file has no cues" and "I could not look" have to be
 * different answers: reporting the second as the first is silent, permanent cue
 * loss, because the server's copy of the file is frozen at whatever was
 * uploaded (laker-93/pymix#145). WAV, AIFF and M4A are tracked in
 * laker-93/tserato#17.
 */
export class UnsupportedContainerError extends Error {
  constructor(
    readonly container: Container,
    readonly file: string
  ) {
    super(
      `${container} is not supported yet (${file}); tserato reads Serato tags from MP3 and FLAC`
    );
    this.name = 'UnsupportedContainerError';
  }
}
