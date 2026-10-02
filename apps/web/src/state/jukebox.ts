/**
 * Jukebox UI and audio state on this page (#47). The playing state itself
 * is the BuildingRoom's (`BuildingState.jukebox`); this holds what is local:
 * how loud the jukebox is where the player stands (the scene writes it),
 * whether the panel is open, a YouTube panel the viewer closed, and the
 * player's last sync reading (the panel's readout and the e2e probe).
 */
import { create } from "zustand";

export interface JukeboxSync {
  /** Player position minus the server's playhead, ms (positive = ahead). */
  driftMs: number;
  /** Playback rate in use (1, or 1 ± the nudge). */
  rate: number;
  /** What the last check did. */
  action: "settle" | "nudge" | "seek" | "idle";
  /** Server playhead at the reading, ms. */
  positionMs: number;
  /** Estimated server − local clock offset, and its error bound, ms. */
  offsetMs: number;
  errorMs: number;
  /** Server time of the reading. */
  serverAt: number;
  /** Track the reading is about. */
  trackId: string;
}

export interface JukeboxStore {
  /** Spatial level where the player stands, 0..1 (attenuation × occlusion). */
  level: number;
  /** Walking distance to the jukebox, metres (Infinity out of reach). */
  distance: number;
  panelOpen: boolean;
  /** Queue entry whose YouTube panel the viewer closed (it returns for the next video). */
  youtubeClosedFor: string;
  sync: JukeboxSync | null;
  /** Where a player stands to use the jukebox (the scene writes it); e2e walks there. */
  stand: { x: number; z: number } | null;
  setStand(stand: { x: number; z: number } | null): void;
  setLevel(level: number, distance: number): void;
  openPanel(): void;
  closePanel(): void;
  togglePanel(): void;
  closeYouTube(entryId: string): void;
  setSync(sync: JukeboxSync | null): void;
}

export const useJukeboxStore = create<JukeboxStore>()((set) => ({
  level: 0,
  distance: Number.POSITIVE_INFINITY,
  panelOpen: false,
  youtubeClosedFor: "",
  sync: null,
  stand: null,
  setStand: (stand) => set({ stand }),
  setLevel: (level, distance) =>
    set((s) =>
      Math.abs(s.level - level) < 0.005 &&
      (s.distance === distance || Math.abs(s.distance - distance) < 0.25)
        ? s
        : { level, distance },
    ),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  closeYouTube: (entryId) => set({ youtubeClosedFor: entryId }),
  setSync: (sync) => set({ sync }),
}));
