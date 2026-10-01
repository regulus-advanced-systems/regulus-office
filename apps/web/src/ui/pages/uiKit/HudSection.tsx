import {
  BLAST_DOOR_CLOSED,
  DEFAULT_ROOM_SETTINGS,
  EMPTY_COMPOUND,
  UNPLACED_ROOM,
  type UsageSummary,
} from "@regulus/protocol";
import { useCallback, useState } from "react";
import { useBuildingStore } from "../../../state/building.ts";
import type { ConnectionStatus } from "../../../state/connection.ts";
import { useFloorStore } from "../../../state/floor.ts";
import { Button } from "../../components/Button.tsx";
import { HotkeyList } from "../../hotkeys/HotkeyHelp.tsx";
import type { HotkeyEventDetail } from "../../hotkeys/registry.ts";
import { useGlobalHotkeys, useHotkeyEvents } from "../../hotkeys/useHotkeys.ts";
import { RoomsPanel } from "../../hud/RoomsPanel.tsx";
import { ConnectionChip, StatusBox, UsageRows } from "../../hud/StatusBox.tsx";
import { TopBar } from "../../hud/TopBar.tsx";
import { Panel } from "../../Panel.tsx";
import { Row, Section } from "./Section.tsx";

const STATUSES: ConnectionStatus[] = [
  "idle",
  "connecting",
  "connected",
  "reconnecting",
  "failed",
  "disconnected",
];

const USAGE: UsageSummary = {
  todayInputTokens: 81_200,
  todayOutputTokens: 12_500,
  todayCacheTokens: 640_000,
  todayCostUsdEstimate: 4.32,
  officeKeysCostUsdEstimate: 0.8,
  activeHumans: 3,
  topRobots: [],
  dayStart: 0,
  observedAt: 0,
};

const floor = (index: number, name: string, working: number, total: number) => ({
  floorId: `kit-${index}`,
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  index,
  paletteId: "teal-cream",
  robotsWorking: working,
  robotsWaiting: 0,
  robotsTotal: total,
  humansPresent: 0,
  ...UNPLACED_ROOM,
  ...DEFAULT_ROOM_SETTINGS,
});

/** Seed the building/floor stores with fake floors (counters, quick travel). */
function seedFloors() {
  const current = useBuildingStore.getState().state;
  useBuildingStore.getState().apply({
    humans: current?.humans ?? {},
    chat: current?.chat ?? [],
    jukebox: current?.jukebox ?? {
      trackId: "",
      startedAtServerMs: 0,
      pausedAtMs: 0,
      playing: false,
      volume: 0.5,
      queue: [],
    },
    usage: USAGE,
    pm: current?.pm ?? {
      enabled: false,
      privilege: "coordinator",
      activity: "idle",
      floorId: "kit-0",
      position: { x: 0, z: 0, heading: 0 },
      animation: "idle",
      doing: "",
      targetAgentId: "",
      lastBriefAt: 0,
    },
    compound: current?.compound ?? EMPTY_COMPOUND,
    blastDoor: current?.blastDoor ?? BLAST_DOOR_CLOSED,
    floors: {
      "kit-0": floor(0, "Lobby", 0, 0),
      "kit-1": floor(1, "Regulus Web", 2, 3),
      "kit-2": floor(2, "Billing Service", 0, 4),
    },
  });
  useFloorStore.getState().setFloorId("kit-1");
}

export function HudSection() {
  useGlobalHotkeys();
  const [log, setLog] = useState<string[]>([]);
  useHotkeyEvents(
    useCallback(
      (d: HotkeyEventDetail) => setLog((l) => [`${d.id} (${d.key})`, ...l].slice(0, 6)),
      [],
    ),
  );
  return (
    <Section id="hud" title="HUD">
      <Row label="top bar">
        <div style={{ position: "relative", height: 76, width: "100%" }}>
          <TopBar
            officeName="Regulus Office"
            floorName="Regulus Web"
            date={new Date(2026, 8, 28, 14, 5)}
          />
        </div>
      </Row>
      <Row label="top bar (long)">
        <div style={{ position: "relative", height: 76, width: "100%" }}>
          <TopBar officeName="An Office With A Very Long Name That Truncates" floorName="Lobby" />
        </div>
      </Row>
      <Row label="connection chips">
        {STATUSES.map((s) => (
          <ConnectionChip key={s} status={s} attempt={s === "reconnecting" ? 3 : 0} />
        ))}
      </Row>
      <Row label="status box">
        {STATUSES.map((s) => (
          <div key={s} style={{ position: "relative", width: 240, height: 96 }}>
            <StatusBox status={s} usage={s === "connected" ? USAGE : null} />
          </div>
        ))}
      </Row>
      <Row label="usage rows">
        <Panel style={{ width: 220 }}>
          <UsageRows usage={USAGE} />
        </Panel>
        <Panel style={{ width: 220 }}>
          <UsageRows usage={null} />
        </Panel>
      </Row>
      <Row label="rooms">
        <div style={{ width: 260 }}>
          <RoomsPanel />
        </div>
        <Button variant="secondary" size="sm" onClick={seedFloors}>
          Seed fake operations
        </Button>
      </Row>
      <Row label="shortcuts">
        <Panel style={{ width: 360 }}>
          <HotkeyList />
        </Panel>
        <Panel title="regulus:hotkey events" style={{ width: 260, minHeight: 120 }}>
          {log.length === 0 && <div className="rg-muted">Press F, V or E here.</div>}
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {log.map((entry, i) => (
              <li key={`${entry}-${i}`}>{entry}</li>
            ))}
          </ol>
        </Panel>
      </Row>
    </Section>
  );
}
