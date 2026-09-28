/**
 * Dev-only page (apps/web/dev/robots.html): the Office L2 floor with fake
 * robots at their desks, bubbles flying to the HUD counters and an fps probe.
 * Query: n=<robots> (default 12), mode=working|mixed|waiting, rate=<counter ticks/s>,
 * reduced=1. Not part of the production build.
 */
import { officeL2Template } from "@regulus/floor-layout";
import type { RobotState } from "@regulus/protocol";
import { Suspense, useEffect, useState } from "react";
import { useFloorStore } from "../../../state/floor.ts";
import { useUiStore } from "../../../state/ui.ts";
import { WorkCounters } from "../../../ui/hud/WorkCounters.tsx";
import { FpsProbe } from "../../avatar/showcase/FpsProbe.tsx";
import { AvatarLayer } from "../../avatars/AvatarLayer.tsx";
import { MovementController } from "../../movement/MovementController.tsx";
import { OfficeCanvas } from "../../OfficeCanvas.tsx";
import { RobotLayer } from "../RobotLayer.tsx";
import { fakeRobots } from "./fakeRobots.ts";
import "../../../ui/globals.css";
import "../../../ui/hud.css";

const template = officeL2Template;
const noSend = () => {};

export function RobotsHarness({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const n = Number(params.get("n") ?? 12);
  const m = params.get("mode");
  const mode = m === "mixed" || m === "waiting" ? m : "working";
  const rate = Number(params.get("rate") ?? 2);
  const [tick, setTick] = useState(0);
  const [robots, setRobots] = useState<Record<string, RobotState>>({});

  useEffect(() => {
    if (new URLSearchParams(search).get("reduced") === "1")
      useUiStore.getState().updateSettings({ reducedMotion: true });
    const timer = setInterval(() => setTick((t) => t + 1), 1000 / Math.max(0.1, rate));
    return () => clearInterval(timer);
  }, [rate, search]);

  useEffect(() => {
    const next = fakeRobots(template, n, tick, mode);
    setRobots(next);
    // The HUD counters read the floor store.
    useFloorStore.setState({
      floorId: "dev",
      state: {
        floorId: "dev",
        name: "Dev",
        slug: "dev",
        paletteId: "teal-cream",
        layoutTemplateId: template.id,
        repos: [],
        robots: next,
        desks: {},
        decor: {},
        queue: [],
        issues: {},
        pulls: {},
        services: {},
        whiteboardVersion: 0,
        carriedCards: {},
      },
    });
  }, [tick, n, mode]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <OfficeCanvas template={template} floorName="Dev floor" avatars={<AvatarLayer />}>
        <MovementController template={template} send={noSend} />
        <Suspense fallback={null}>
          <RobotLayer template={template} robots={robots} />
        </Suspense>
        <FpsProbe probe={false} />
      </OfficeCanvas>
      <div className="rg-hud">
        <WorkCounters />
      </div>
    </div>
  );
}
