/**
 * Dev-only page (apps/web/dev/robots.html): the Office L2 floor with fake
 * robots at their desks, bubbles flying to the HUD counters and an fps probe.
 * Query: n=<robots> (default 12), mode=working|mixed|waiting|idle|flap, rate=<ticks/s>,
 * reduced=1, template=<template id> (default office-l2), seats=all (robots on
 * meeting, bistro, reception and lounge seats too). The merge gong (#43) hangs on its anchor;
 * the buttons ring it once (a merge) or three times (the queue emptied). Not part of the
 * production build.
 */
import { officeL2Template, templateById } from "@regulus/floor-layout";
import type { RobotState } from "@regulus/protocol";
import { Suspense, useEffect, useState } from "react";
import { useFloorStore } from "../../../state/floor.ts";
import { useUiStore } from "../../../state/ui.ts";
import { WorkCounters } from "../../../ui/hud/WorkCounters.tsx";
import { FpsProbe } from "../../avatar/showcase/FpsProbe.tsx";
import { AvatarLayer } from "../../avatars/AvatarLayer.tsx";
import { GongLayer } from "../../gong/GongLayer.tsx";
import { useGongStore } from "../../gong/gongStore.ts";
import { playGong } from "../../gong/gongSynth.ts";
import { MovementController } from "../../movement/MovementController.tsx";
import { OfficeCanvas } from "../../OfficeCanvas.tsx";
import { RobotLayer } from "../RobotLayer.tsx";
import { fakeRobots, harnessMode } from "./fakeRobots.ts";
import "../../../ui/globals.css";
import "../../../ui/hud.css";

const noSend = () => {};

function ring(strikes: number) {
  const cause = strikes > 1 ? "queue_empty" : "merge";
  useGongStore.getState().heard({ floorId: "dev", cause, strikes });
  const ui = useUiStore.getState();
  playGong(strikes, {
    volume: ui.settings.volume,
    reducedMotion: ui.settings.reducedMotion === true,
  });
}

export function RobotsHarness({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const n = Number(params.get("n") ?? 12);
  const mode = harnessMode(params.get("mode"));
  const rate = Number(params.get("rate") ?? 2);
  const template = templateById(params.get("template") ?? "") ?? officeL2Template;
  const allSeats = params.get("seats") === "all";
  const [tick, setTick] = useState(0);
  const [robots, setRobots] = useState<Record<string, RobotState>>({});

  useEffect(() => {
    if (new URLSearchParams(search).get("reduced") === "1")
      useUiStore.getState().updateSettings({ reducedMotion: true });
    const timer = setInterval(() => setTick((t) => t + 1), 1000 / Math.max(0.1, rate));
    return () => clearInterval(timer);
  }, [rate, search]);

  useEffect(() => {
    const next = fakeRobots(template, n, tick, mode, allSeats);
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
        queueSettings: { maxRunning: 2, maxPerOwner: 2 },
        deskCount: 1,
        decorStyle: "ops_room",
      },
    });
  }, [tick, n, mode, template, allSeats]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <OfficeCanvas template={template} floorName="Dev floor" avatars={<AvatarLayer />}>
        <MovementController template={template} send={noSend} />
        <Suspense fallback={null}>
          <RobotLayer template={template} robots={robots} />
          <GongLayer template={template} />
        </Suspense>
        <FpsProbe probe={false} />
      </OfficeCanvas>
      <div className="rg-hud">
        <WorkCounters />
        <div style={{ position: "fixed", right: 16, bottom: 16, display: "flex", gap: 8 }}>
          <button type="button" onClick={() => ring(1)}>
            Ring the gong
          </button>
          <button type="button" onClick={() => ring(3)}>
            Queue done (x3)
          </button>
        </div>
      </div>
    </div>
  );
}
