/**
 * The office scene (SPEC §9.2, §12): true-isometric orthographic camera over
 * a dollhouse room rendered from a floor template with toon shading, on a
 * cream vignette, with baked blob shadows under the furniture. Pixel ratio
 * 1, no tone mapping, render loop paused while the tab is hidden (SPEC §11).
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
import { vignetteBackground } from "./backdrop.ts";
import { IsoCamera } from "./camera/IsoCamera.tsx";
import { CAMERA_FAR, CAMERA_NEAR, cameraPosition, roomTarget } from "./camera/isoCamera.ts";
import { Furniture } from "./furniture/Furniture.tsx";
import { WallAnchors } from "./furniture/WallAnchors.tsx";
import { useDocumentHidden } from "./hooks/useDocumentHidden.ts";
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

  return (
    <div style={{ position: "absolute", inset: 0, background: vignetteBackground() }}>
      <Canvas
        orthographic
        flat
        dpr={1}
        frameloop={hidden ? "never" : "always"}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ position: initialPosition, zoom: 50, near: CAMERA_NEAR, far: CAMERA_FAR }}
        style={{ position: "absolute", inset: 0 }}
        onCreated={showStats ? (state) => (window.__regulusR3F = state) : undefined}
      >
        <IsoCamera room={room} />
        <Lighting />
        <Room template={template} palette={palette} floorName={floorName} />
        <Suspense fallback={null}>
          <Furniture template={template} palette={palette} />
          <WallAnchors template={template} palette={palette} />
          <BlobShadows template={template} />
        </Suspense>
        <group name="avatars">{avatars}</group>
        {children}
        {showStats && <StatsOverlay />}
      </Canvas>
    </div>
  );
}
