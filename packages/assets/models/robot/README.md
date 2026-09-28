# Robot avatar model

| File | Author | Source | License | Size |
|---|---|---|---|---|
| `robot.glb` | Quaternius | https://poly.pizza/m/QCm7qe9uNJ (also https://quaternius.itch.io/lowpoly-robot) | CC0 1.0 (public domain, no attribution required) | 401 KB |

"Animated LowPoly Robot" by Quaternius, downloaded unmodified from Poly Pizza
(`https://static.poly.pizza/7d95dbce-8c73-489b-8298-f430b1f0dbdf.glb`, exported by
FBX2glTF v0.9.7). SHA-256 `54f1a6999cca701cdc2f8fb67bcd9a283e1154cb80cac356f031bed7c2e74cbe`.

CC0 needs no row in `packages/assets/ATTRIBUTION.md`; this file records provenance.

## Contents

- 3237 triangles, 14 meshes rigidly parented to bones plus two skinned hands, no textures.
- Materials: `Main` (body colour), `Grey` (joints, feet), `Black` (face). The web client swaps
  these for `MeshToonMaterial` per user colour set (`apps/web/src/scene/avatar`).
- The armature node is scaled x100 with a -90 deg X rotation (FBX Y-up fix); the model is ~4.45 units tall (feet to head top), faces +Z, right hand at -X.
- Animation clips (all named `RobotArmature|Robot_<Name>`): Dance, Death, Idle, Jump, No, Punch,
  Running, Sitting, Standing, ThumbsUp, Walking, WalkJump, Wave, Yes.

Missing SPEC §9.3 clips (sit-type, read, think, facepalm, point, celebrate) fall back to the
closest available clip; see `apps/web/src/scene/avatar/clips.ts`.
