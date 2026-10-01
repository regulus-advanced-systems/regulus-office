/**
 * Scene plumbing for the lair kit (#183): `<LairKit>` creates the shared
 * materials and cutaway uniforms once and hands them to every piece below
 * it; `<CutawayDriver>` points the cutaway at the camera and a focus point
 * (the player, in #186) every frame.
 */
import { useFrame } from "@react-three/fiber";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { updateCutaway, type XYZ } from "../cutaway.ts";
import { createLairMaterials, disposeLairMaterials, type LairMaterials } from "../materials.ts";

const LairMaterialsContext = createContext<LairMaterials | null>(null);

export function LairKit({ children }: { children: ReactNode }) {
  const materials = useMemo(() => createLairMaterials(), []);
  useEffect(() => () => disposeLairMaterials(materials), [materials]);
  return (
    <LairMaterialsContext.Provider value={materials}>{children}</LairMaterialsContext.Provider>
  );
}

export function useLairMaterials(): LairMaterials {
  const m = useContext(LairMaterialsContext);
  if (!m) throw new Error("lair pieces must be rendered inside <LairKit>");
  return m;
}

export interface CutawayDriverProps {
  /** Where the player is; read every frame so a ref-backed getter needs no re-render. */
  focus: XYZ | (() => XYZ);
  /** Off in first person (SPEC §9.2: full walls at eye height). */
  enabled?: boolean;
}

export function CutawayDriver({ focus, enabled = true }: CutawayDriverProps) {
  const { cutaway } = useLairMaterials();
  useFrame(({ camera }) => {
    cutaway.uCutEnabled.value = enabled ? 1 : 0;
    updateCutaway(cutaway, camera.position, typeof focus === "function" ? focus() : focus);
  });
  return null;
}
