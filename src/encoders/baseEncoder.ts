import { Track } from '../model/track';

export abstract class BaseEncoder {
  abstract get tagName(): string;
  abstract get tagVersion(): Buffer;
  abstract get markersName(): string;
  abstract write(track: Track): void;
}
