/**
 * Guards against drift between the zod state shapes (the TS source of truth)
 * and the Colyseus schema classes: field names must match in order, and a
 * fixture must survive hydrate → encode → decode → toJSON unchanged.
 */
import { describe, expect, test } from "bun:test";
import { ArraySchema, Decoder, Encoder, MapSchema, Schema } from "@colyseus/schema";
import type { z } from "zod";
import * as building from "../building-state.ts";
import { WorldPos } from "../common.ts";
import { buildingFixture, floorFixture } from "../fixtures.ts";
import * as floor from "../floor-state.ts";
import * as schemas from "./index.ts";
import { type SchemaClass, schemaFieldNames, schemaMetadata } from "./introspect.ts";

/** Every zod state object paired with its Colyseus class. */
const pairs: Array<[string, z.ZodObject, SchemaClass]> = [
  ["WorldPos", WorldPos, schemas.WorldPosSchema],
  ["AvatarLook", building.AvatarLook, schemas.AvatarLookSchema],
  ["HumanPresence", building.HumanPresence, schemas.HumanPresenceSchema],
  ["FloorSummary", building.FloorSummary, schemas.FloorSummarySchema],
  ["ChatMessage", building.ChatMessage, schemas.ChatMessageSchema],
  ["JukeboxQueueEntry", building.JukeboxQueueEntry, schemas.JukeboxQueueEntrySchema],
  ["JukeboxState", building.JukeboxState, schemas.JukeboxStateSchema],
  ["TopRobotUsage", building.TopRobotUsage, schemas.TopRobotUsageSchema],
  ["UsageSummary", building.UsageSummary, schemas.UsageSummarySchema],
  ["PmState", building.PmState, schemas.PmStateSchema],
  ["BuildingState", building.BuildingState, schemas.BuildingStateSchema],
  ["BubbleEmits", floor.BubbleEmits, schemas.BubbleEmitsSchema],
  ["RobotState", floor.RobotState, schemas.RobotStateSchema],
  ["DeskState", floor.DeskState, schemas.DeskStateSchema],
  ["DecorState", floor.DecorState, schemas.DecorStateSchema],
  ["QueueTask", floor.QueueTask, schemas.QueueTaskSchema],
  ["QueueSettings", floor.QueueSettings, schemas.QueueSettingsSchema],
  ["IssueCard", floor.IssueCard, schemas.IssueCardSchema],
  ["PullCard", floor.PullCard, schemas.PullCardSchema],
  ["ServiceState", floor.ServiceState, schemas.ServiceStateSchema],
  ["CarriedCard", floor.CarriedCard, schemas.CarriedCardSchema],
  ["RepoSummary", floor.RepoSummary, schemas.RepoSummarySchema],
  ["FloorState", floor.FloorState, schemas.FloorStateSchema],
];

/** Build a schema instance from a plain object using the class's field metadata. */
function hydrate(klass: SchemaClass, plain: Record<string, unknown>): Schema {
  const metadata = schemaMetadata(klass);
  const instance = new klass() as unknown as Record<string, unknown>;
  for (const name of schemaFieldNames(klass)) {
    const fieldType = metadata?.[metadata[name] as number]?.type as unknown;
    instance[name] = hydrateValue(fieldType, plain[name]);
  }
  return instance as unknown as Schema;
}

function hydrateValue(fieldType: unknown, value: unknown): unknown {
  if (typeof fieldType === "function" && Schema.is(fieldType as typeof Schema)) {
    return hydrate(fieldType as SchemaClass, value as Record<string, unknown>);
  }
  if (fieldType && typeof fieldType === "object" && "map" in fieldType) {
    const map = new MapSchema();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      map.set(k, hydrateValue(fieldType.map, v));
    }
    return map;
  }
  if (fieldType && typeof fieldType === "object" && "array" in fieldType) {
    const arr = new ArraySchema();
    for (const v of value as unknown[]) arr.push(hydrateValue(fieldType.array, v));
    return arr;
  }
  return value;
}

/** Bun's toEqual treats absent keys and `undefined` differently; normalise via JSON. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("Colyseus schema lockstep", () => {
  test.each(pairs)("%s: schema fields match the zod shape keys in order", (_n, zod, klass) => {
    expect(schemaFieldNames(klass)).toEqual(Object.keys(zod.shape));
  });

  test("every zod state shape has a Colyseus twin", () => {
    const exported: unknown[] = [...Object.values(building), ...Object.values(floor)];
    const zodObjects = exported.filter(
      (v): v is z.ZodObject => typeof v === "object" && v !== null && "shape" in v,
    );
    const paired = new Set(pairs.map(([, zod]) => zod));
    for (const obj of zodObjects) expect(paired.has(obj)).toBe(true);
  });

  test("building fixture round-trips through encode/decode", () => {
    const state = hydrate(schemas.BuildingStateSchema, buildingFixture);
    expect(plain(state.toJSON())).toEqual(plain(buildingFixture));
    const bytes = new Encoder(state).encodeAll();
    const decoded = new schemas.BuildingStateSchema();
    new Decoder(decoded).decode(bytes);
    const json = plain(decoded.toJSON());
    expect(json).toEqual(plain(buildingFixture));
    expect(building.BuildingState.safeParse(json).success).toBe(true);
  });

  test("floor fixture round-trips through encode/decode", () => {
    const state = hydrate(schemas.FloorStateSchema, floorFixture);
    expect(plain(state.toJSON())).toEqual(plain(floorFixture));
    const bytes = new Encoder(state).encodeAll();
    const decoded = new schemas.FloorStateSchema();
    new Decoder(decoded).decode(bytes);
    const json = plain(decoded.toJSON());
    expect(json).toEqual(plain(floorFixture));
    expect(floor.FloorState.safeParse(json).success).toBe(true);
  });
});
