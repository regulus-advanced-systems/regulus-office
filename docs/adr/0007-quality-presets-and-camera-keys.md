# 0007: Detail presets, the starting view and the camera keys

## Context

The M2.5 exit gate (#190) re-checks SPEC §11: 60 fps at 1080p with 20
henchmen on screen on a 2020 laptop iGPU. The compound had two detail tiers:
"high" on any GPU and "low" for software WebGL. An integrated GPU got the
full high tier, MSAA included, and nobody could change the tier by hand.
The owner's review of #186 also found the first view too close, and `E`
doing two jobs: it interacted with whatever was in reach and otherwise
turned the camera, so a missed interaction swung the view.

## Decision

- **Three presets** (`scene/compound/quality.ts`): `high`, `medium`, `low`,
  each a plain record of switches (MSAA, pooled lamp lights, alarm lights,
  blob shadows, mountain, decor, draw distance, lite outside, flat floors,
  resolution scale). The GPU tier is read from the WebGL renderer string:
  software renderers get `low`, integrated and mobile GPUs (and browsers that
  hide the GPU) get `medium`, everything else `high`. Settings → Graphics
  quality offers Auto or a fixed preset (saved per browser); `?quality=`
  still overrides both for tests.
- **Medium** drops MSAA and halves the pooled lamp lights, and keeps every
  fixture and piece of decor, so a laptop looks like the office the owner
  designed, not the CI tier.
- **Low** additionally draws floors as flat quads and renders at 0.75
  resolution scale, on top of what it already left out.
- **Starting view**: the camera starts 30 m from the player (a whole large
  room and its door in view) for any compound size, instead of a fixed zoom
  fraction; the first wheel turn or any flow that sets a zoom takes over.
- **Keys**: `E` only interacts. The camera turns on `Z` (left) and `C`
  (right), which no other binding uses; right-drag still turns freely.
  `Q` is free. This deviates from SPEC §9.2's "rotatable (`Q`/`E`)": `E`
  cannot be both.

## Consequences

- Changing MSAA in Settings remounts the canvas once (the WebGL context
  fixes it at creation); other preset changes apply in place.
- The perf probe (`?stats`, `window.__regulusPerf`) and `scripts/perf/`
  measure every preset the same way; the e2e suite records a report-only
  frame-time sample.
- SPEC §9.2 needs its key list updated to `Z`/`C` (owner).
- On a QWERTZ keyboard `Z` sits in the top row; right-drag remains the
  layout-independent way to turn.
