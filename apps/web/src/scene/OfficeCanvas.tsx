/**
 * The office scene (SPEC §9.2, §12): true-isometric orthographic camera over
 * a dollhouse room rendered from a floor template with toon shading, on a
 * cream vignette, with baked blob shadows under the furniture. Pixel ratio
 * 1, no tone mapping, render loop paused while the tab is hidden (SPEC §11).
 *
 * The view store (`state/view.ts`) switches between third person and the
 * first-person rig (`fpv/`), with a cream crossfade drawn above the canvas
 * and full-height front walls while in first person.
 *
 * Avatars are not rendered here: pass them through `avatars` (they mount in
 * a `<group name="avatars">`) or as `children`, so the avatar issues need
 * not touch this file.
 */
import { Canvas } from "@react-three/fiber";
import {
  type FloorTemplate,
  LOBBY_PALETTE_ID,
  lobbyTemplate,
  type Palette,
  paletteById,
} from "@regulus/floor-layout";
import { type ReactNode, Suspense, useMemo } from "react";
import { useFloorStore } from "../state/floor.ts";
import { usePlayerStore } from "../state/player.ts";
import { useViewStore } from "../state/view.ts";
import { useViewHotkey } from "../ui/hud/ViewToggle.tsx";
import { vignetteBackground } from "./backdrop.ts";
import { IsoCamera } from "./camera/IsoCamera.tsx";
import { CAMERA_FAR, CAMERA_NEAR, cameraPosition, roomTarget } from "./camera/isoCamera.ts";
import { ViewCrossfade } from "./camera/ViewCrossfade.tsx";
import { FirstPersonRig } from "./fpv/FirstPersonRig.tsx";
import { createPlayerBinding } from "./fpv/playerBinding.ts";
import { Furniture } from "./furniture/Furniture.tsx";
import { WallAnchors } from "./furniture/WallAnchors.tsx";
import { useDocumentHidden } from "./hooks/useDocumentHidden.ts";
import { LaptopLayer } from "./laptops/LaptopLayer.tsx";
import { Lighting } from "./lights/Lighting.tsx";
import { StatsOverlay } from "./perf/StatsOverlay.tsx";
import { statsEnabled } from "./perf/stats.ts";
import { Room } from "./room/Room.tsx";
import { BlobShadows } from "./shadows/BlobShadows.tsx";

export interface OfficeCanvasProps {
  /** Floor to draw; the lobby until floor switching lands. */
  template?: FloorTemplate;
  palette?: Palette;
  /** Name painted on the exterior stub wall; defaults to the template name. */
  floorName?: string;
  /** Robots and humans, mounted in `<group name="avatars">` after the room. */
  avatars?: ReactNode;
  /** Anything else to add to the scene (bubbles, decals, debug helpers). */
  children?: ReactNode;
}

/** First-person rig <-> player store (#15); only once MovementController has spawned us. */
const playerBinding = createPlayerBinding(usePlayerStore);

function requirePalette(id: string): Palette {
  const p = paletteById(id);
  if (!p) throw new Error(`palette ${id} missing`);
  return p;
}
const DEFAULT_PALETTE = requirePalette(LOBBY_PALETTE_ID);

export function OfficeCanvas({
  template = lobbyTemplate,
  palette = DEFAULT_PALETTE,
  floorName,
  avatars,
  children,
}: OfficeCanvasProps) {
  const hidden = useDocumentHidden();
  const showStats = useMemo(() => statsEnabled(window.location.search), []);
  const room = useMemo(
    () => ({ width: template.size.width, depth: template.size.depth, height: template.wallHeight }),
    [template],
  );
  const initialPosition = useMemo(() => {
    const p = cameraPosition(roomTarget(room));
    return [p.x, p.y, p.z] as [number, number, number];
  }, [room]);

  useViewHotkey();
  const mode = useViewStore((s) => s.mode);
  const cameraMode = useViewStore((s) => s.cameraMode);
  const firstPerson = cameraMode === "first_person";
  /** The rig mounts on request (to grab pointer lock early) and stays until the camera swaps back. */
  const rigMounted = firstPerson || mode === "first_person";
  /** Without a spawned player (e.g. the dev harness) the rig walks a local pose. */
  const spawned = usePlayerStore((s) => s.spawned);

  return (
    <div
      // Own stacking context: drei <Html> z-indices (live laptop screens) stay under the HUD.
      style={{
        position: "absolute",
        inset: 0,
        isolation: "isolate",
        background: vignetteBackground(),
      }}
    >
      <Canvas
        orthographic
        flat
        dpr={1}
        frameloop={hidden ? "never" : "always"}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ position: initialPosition, zoom: 50, near: CAMERA_NEAR, far: CAMERA_FAR }}
        style={{ position: "absolute", inset: 0 }}
        onCreated={
          showStats
            ? (state) => {
                window.__regulusR3F = state;
                window.__regulusFloorStore = useFloorStore;
              }
            : undefined
        }
      >
        <IsoCamera room={room} enabled={!firstPerson} />
        {rigMounted && (
          <FirstPersonRig
            template={template}
            active={firstPerson}
            getPose={spawned ? playerBinding.getPose : undefined}
            onMove={spawned ? playerBinding.onMove : undefined}
          />
        )}
        <Lighting />
        <Room
          template={template}
          palette={palette}
          floorName={floorName}
          frontWalls={firstPerson ? "full" : "stub"}
        />
        <Suspense fallback={null}>
          <Furniture template={template} palette={palette} />
          <WallAnchors template={template} palette={palette} />
          <BlobShadows template={template} />
          <LaptopLayer template={template} />
        </Suspense>
        <group name="avatars">{avatars}</group>
        {children}
        {showStats && <StatsOverlay />}
      </Canvas>
      <ViewCrossfade />
    </div>
  );
}
