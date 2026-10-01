/** Colyseus schema classes shared by the building and operation state. */
import { schema, t } from "@colyseus/schema";

/** Mirrors `WorldPos` in ../common.ts. */
export const WorldPosSchema = schema(
  {
    x: t.float64().default(0),
    z: t.float64().default(0),
    heading: t.float64().default(0),
  },
  "WorldPos",
);
