import { probeContainer } from './container';
import { FlacTagIO } from './flacTagIO';
import { Mp3TagIO } from './mp3TagIO';
import { TagIO, UnsupportedContainerError } from './tagIO';

export { Container, probeContainer } from './container';
export { FlacTagIO } from './flacTagIO';
export { Mp3TagIO } from './mp3TagIO';
export { TagIO, UnsupportedContainerError } from './tagIO';

/**
 * The reader and writer for whatever this file turns out to be.
 *
 * Throws UnsupportedContainerError for a container with no implementation yet,
 * which is the point of doing this here rather than in each encoder: there is
 * one place that decides, and it names the container it refused.
 */
export function tagIOFor(file: string): TagIO {
  const { container, offset } = probeContainer(file);
  switch (container) {
    case 'MP3':
      return new Mp3TagIO(file);
    case 'FLAC':
      return new FlacTagIO(file, offset);
    default:
      throw new UnsupportedContainerError(container, file);
  }
}
