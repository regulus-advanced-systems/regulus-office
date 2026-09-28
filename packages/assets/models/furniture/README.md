# Placeholder furniture models

Source: **Kenney Furniture Kit 2.0** (https://kenney.nl/assets/furniture-kit), created and
distributed by Kenney (www.kenney.nl). License: **CC0 1.0 Universal** (public domain,
http://creativecommons.org/publicdomain/zero/1.0/); no attribution required, so these have no
row in `../../ATTRIBUTION.md`.

Only the models the lobby scene actually places are checked in, unmodified from the kit's
`Models/GLTF format/` folder (binary glTF, flat `KHR_materials_unlit` colours, no textures). The
client swaps their materials for `MeshToonMaterial` and recolours some of them to the floor
palette at load time (`apps/web/src/scene/furniture/catalog.ts`).

| File | Used for (floor-layout kind) |
|---|---|
| `desk.glb` | `reception_desk`, `desk` |
| `chairDesk.glb` | chairs at `desk` / `reception` seats |
| `kitchenCabinet.glb` | `counter` |
| `kitchenCoffeeMachine.glb` | `coffee_machine` |
| `loungeSofa.glb` | `couch` |
| `tableCoffee.glb` | `coffee_table` |
| `pottedPlant.glb` | `plant` |
| `televisionModern.glb` | `tv` wall anchor |

Kinds without a model here (jukebox, elevator, whiteboard, usage wall, picture frames) are
built procedurally from boxes in the client.
