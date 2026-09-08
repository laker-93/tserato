export { Builder, DEFAULT_SERATO_FOLDER } from './builder';
export { V2Encoder } from './encoders/v2/v2Encoder';
export { BeatgridEncoder } from './encoders/beatgrid/beatgridEncoder';
export {
  Container,
  Mp3TagIO,
  FlacTagIO,
  TagIO,
  UnsupportedContainerError,
  probeContainer,
  tagIOFor,
} from './encoders/io';
export { Crate } from './model/crate';
export { Track } from './model/track';
export { TrackMeta } from './model/trackMeta';
export { HotCue } from './model/hotCue';
export { HotCueType } from './model/hotCueType';
export { Tempo, isTerminal, bpmBetween } from './model/tempo';

/**
 * The names these carried while they were MP3-only. Kept so a consumer pinned
 * to an older tserato keeps compiling across the upgrade; prefer the names
 * above, which do not claim a container.
 *
 * @deprecated use V2Encoder / BeatgridEncoder
 */
export { V2Encoder as V2Mp3Encoder } from './encoders/v2/v2Encoder';
/** @deprecated use BeatgridEncoder */
export { BeatgridEncoder as BeatgridMp3Encoder } from './encoders/beatgrid/beatgridEncoder';
