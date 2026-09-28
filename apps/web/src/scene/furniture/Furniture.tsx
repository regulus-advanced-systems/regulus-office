/**
 * Places every obstacle, seat chair and the elevator from the floor template
 * (SPEC §9.1): Kenney GLBs where the catalog has one, boxes otherwise.
 */
import {
  type FloorTemplate,
  type ObstacleKind,
  type Palette,
  wallById,
} from "@regulus/floor-layout";
import { chairForSeat, FURNITURE_MODELS, PLACEHOLDER_HEIGHTS } from "./catalog.ts";
import { GltfProp } from "./GltfProp.tsx";
import { ElevatorBank, Jukebox, PlaceholderBox } from "./Procedural.tsx";
import { furnitureHeading, restingHeight, SEAT_FOOTPRINT, visualFootprint } from "./placement.ts";

export interface FurnitureProps {
  template: FloorTemplate;
  palette: Palette;
}

const heightOfKind = (kind: ObstacleKind) =>
  FURNITURE_MODELS[kind]?.targetHeight ?? PLACEHOLDER_HEIGHTS[kind];

export function Furniture({ template, palette }: FurnitureProps) {
  return (
    <group name="furniture">
      {template.obstacles.map((o) => {
        const rect = visualFootprint(o, template.seats);
        const heading = furnitureHeading(o, template.seats, template.size);
        if (o.kind === "jukebox") return <Jukebox key={o.id} rect={rect} heading={heading} />;
        const spec = FURNITURE_MODELS[o.kind];
        const y = restingHeight(o, template.obstacles, heightOfKind);
        if (spec)
          return (
            <GltfProp
              key={o.id}
              spec={spec}
              rect={rect}
              heading={heading}
              palette={palette}
              y={y}
            />
          );
        return (
          <PlaceholderBox
            key={o.id}
            rect={rect}
            height={PLACEHOLDER_HEIGHTS[o.kind]}
            palette={palette}
          />
        );
      })}
      {template.seats.map((s) => {
        const spec = chairForSeat(s.kind);
        if (!spec) return null;
        const half = SEAT_FOOTPRINT / 2;
        const rect = {
          x: s.pose.x - half,
          z: s.pose.z - half,
          w: SEAT_FOOTPRINT,
          d: SEAT_FOOTPRINT,
        };
        return (
          <GltfProp
            key={`seat-${s.id}`}
            spec={spec}
            rect={rect}
            heading={s.pose.heading}
            palette={palette}
          />
        );
      })}
      <ElevatorBank
        elevator={template.elevator}
        wall={wallById(template, template.elevator.wallId)}
      />
    </group>
  );
}
