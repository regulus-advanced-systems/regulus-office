# Placeholder furniture models

Source: **Kenney Furniture Kit 2.0** (https://kenney.nl/assets/furniture-kit), created and
distributed by Kenney (www.kenney.nl). License: **CC0 1.0 Universal** (public domain,
http://creativecommons.org/publicdomain/zero/1.0/); no attribution required, so these have no
row in `../../ATTRIBUTION.md`.

Only the models the scene actually places are checked in, unmodified from the kit's
`Models/GLTF format/` folder (binary glTF, flat `KHR_materials_unlit` colours, no textures). The
client swaps their materials for `MeshToonMaterial` and recolours some of them to the operation
palette at load time (`apps/web/src/scene/furniture/catalog.ts`).

| File | Used for (room-layout kind) |
|---|---|
| `desk.glb` | `reception_desk`, `desk` |
| `chairDesk.glb` | chairs at `desk` / `reception` seats |
| `kitchenCabinet.glb` | `counter` |
| `kitchenCoffeeMachine.glb` | `coffee_machine` |
| `loungeSofa.glb` | `couch` |
| `tableCoffee.glb` | `coffee_table` |
| `pottedPlant.glb` | `plant` |
| `televisionModern.glb` | `tv` wall anchor |
| `plantSmall1.glb`, `plantSmall2.glb`, `plantSmall3.glb` | `plant_small`, plants in a `planter`, `desk_plant` props |
| `loungeChair.glb` | `armchair` |
| `lampRoundFloor.glb` | `floor_lamp` |
| `kitchenFridge.glb` | `fridge` |
| `tableRound.glb` | `bistro_table` |
| `table.glb` | `meeting_table` |
| `benchCushion.glb` | `bench` |
| `books.glb` | `books` props |

Kinds without a model here (jukebox, elevator, bookshelf, planter, whiteboard, usage wall,
picture frames, wall decor, mugs, fruit bowls) are built procedurally from boxes in the client.
