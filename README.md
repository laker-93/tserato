# pyserato-ts

TypeScript port of pyserato (https://github.com/laker-93/pyserato/).

## File formats

Serato's cue and beat grid payloads are the same bytes in every container; only
where they are stored differs. tserato reads and writes them in:

| Container | Where the tag lives | Status |
|---|---|---|
| MP3 | ID3v2 `GEOB` frame | supported |
| FLAC | Vorbis comment, base64 envelope | supported |
| WAV, AIFF | ID3 chunk inside RIFF/IFF | [#17](https://github.com/laker-93/tserato/issues/17) |
| M4A | `----:com.serato.dj` freeform atom | [#17](https://github.com/laker-93/tserato/issues/17) |

The container is decided by the file's own bytes, not its extension. Anything
in that second group throws `UnsupportedContainerError` rather than reporting
that the track has no cues -- a caller has to be able to tell those apart.

## Write Crates

```
// example/testEncoder.ts
import { Builder, Crate, Track, V2Encoder, HotCue, HotCueType } from "tserato"

async function main() {
  // create encoder + builder
  const encoder = new V2Encoder();
  const builder = new Builder(encoder);

  // create crate
  const crate = new Crate("foojs");

  // add track
  const track = Track.fromPath("/Users/lukepurnell/test music/Russian Circles - Gnosis/Russian Circles - Gnosis - 06 Betrayal.mp3");
  crate.addTrack(track);

  // add cues
  track.addHotCue(
    new HotCue({
      name: "mycue1",
      type: HotCueType.CUE,
      start: 500,
      index: 1,
    })
  );
  track.addHotCue(
    new HotCue({
      name: "mycue2",
      type: HotCueType.CUE,
      start: 1000,
      index: 2,
    })
  );

  track.addHotCue(
    new HotCue({
      name: "myloop1",
      type: HotCueType.LOOP,
      start: 2000,
      end: 3000,
      index: 3,
    })
  );

  // save crate (writes .crate file + tags)
  await builder.save(crate, undefined, true);

  console.log("Crate saved successfully!");
}

main().catch(console.error);

```

## Write Cues

```
import { Builder, Crate, Track, V2Encoder, HotCue, HotCueType } from "tserato"

async function main() {
  // create encoder + builder
  const encoder = new V2Encoder();
  const builder = new Builder(encoder);

  // create crate
  const crate = new Crate("foojs");

  // add track
  const track = Track.fromPath("/Users/lukepurnell/test music/Russian Circles - Gnosis/Russian Circles - Gnosis - 06 Betrayal.mp3");
  crate.addTrack(track);

  // add cues
  track.addHotCue(
    new HotCue({
      name: "mycue1",
      type: HotCueType.CUE,
      start: 500,
      index: 1,
    })
  );
  track.addHotCue(
    new HotCue({
      name: "mycue2",
      type: HotCueType.CUE,
      start: 1000,
      index: 2,
    })
  );

  track.addHotCue(
    new HotCue({
      name: "myloop1",
      type: HotCueType.LOOP,
      start: 2000,
      end: 3000,
      index: 3,
    })
  );

  // save crate (writes .crate file + tags)
  await builder.save(crate, undefined, true);

  console.log("Crate saved successfully!");
}

main().catch(console.error);
```