import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_YAW_DEG } from "../scene/camera/orbit.ts";
import { useCameraStore } from "./camera.ts";

const initial = useCameraStore.getState();

describe("camera store (#186, #190)", () => {
  beforeEach(() => useCameraStore.setState(initial, true));

  test("the rig's room-level default applies until a zoom is chosen", () => {
    useCameraStore.getState().setDefaultZoom(0.53);
    expect(useCameraStore.getState().zoom).toBe(0.53);
    useCameraStore.getState().wheel(100);
    const chosen = useCameraStore.getState().zoom;
    expect(chosen).toBeCloseTo(0.61, 6);
    useCameraStore.getState().setDefaultZoom(0.4);
    expect(useCameraStore.getState().zoom).toBe(chosen);
    useCameraStore.getState().reset();
    expect(useCameraStore.getState().zoom).toBe(0.4);
    expect(useCameraStore.getState().yaw).toBeCloseTo((DEFAULT_YAW_DEG * Math.PI) / 180, 9);
    useCameraStore.getState().setDefaultZoom(0.45);
    expect(useCameraStore.getState().zoom).toBe(0.45);
  });

  test("setZoom (build mode, the harness) counts as a choice", () => {
    useCameraStore.getState().setZoom(1);
    useCameraStore.getState().setDefaultZoom(0.5);
    expect(useCameraStore.getState().zoom).toBe(1);
  });
});
