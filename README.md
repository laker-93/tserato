# pyserato-ts

TypeScript port of pyserato.

## Write Crates

```
// example/testEncoder.ts
import { Builder, Crate, Track, V2Mp3Encoder, HotCue, HotCueType } from "tserato"

async function main() {
  // create encoder + builder
  const mp3Encoder = new V2Mp3Encoder();
  const builder = new Builder(mp3Encoder);

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
import { Builder, Crate, Track, V2Mp3Encoder, HotCue, HotCueType } from "tserato"

async function main() {
  // create encoder + builder
  const mp3Encoder = new V2Mp3Encoder();
  const builder = new Builder(mp3Encoder);

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