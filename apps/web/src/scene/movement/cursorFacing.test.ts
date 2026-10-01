import { describe, expect, test } from "bun:test";
import { HEADING } from "@regulus/room-layout";
import { OrthographicCamera, Raycaster, Vector2, Vector3 } from "three";
import {
  CURSOR_DEADZONE,
  createCursorTracker,
  cursorHeading,
  groundPointFromRay,
  pointerToNdc,
} from "./cursorFacing.ts";

const scene = { overlayOpen: false, firstPerson: false };

describe("pointerToNdc", () => {
  const rect = { left: 100, top: 50, width: 800, height: 600 };
  test("maps the canvas corners and centre", () => {
    expect(pointerToNdc(100, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(pointerToNdc(900, 650, rect)).toEqual({ x: 1, y: -1 });
    expect(pointerToNdc(500, 350, rect)).toEqual({ x: 0, y: 0 });
  });
  test("a zero-sized canvas has no cursor", () => {
    expect(pointerToNdc(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe("groundPointFromRay", () => {
  test("intersects the floor plane", () => {
    const p = groundPointFromRay({ x: 1, y: 10, z: 2 }, { x: 0.5, y: -1, z: -0.25 });
    expect(p?.x).toBeCloseTo(6);
    expect(p?.z).toBeCloseTo(-0.5);
  });
  test("parallel or upward rays miss", () => {
    expect(groundPointFromRay({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(groundPointFromRay({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });
  test("recovers the floor point under the cursor of the isometric camera", () => {
    // The third-person camera: orthographic, yaw 45 degrees, pitch 35.264 degrees (SPEC §9.2).
    const camera = new OrthographicCamera(-8, 8, 6, -6, 0.1, 200);
    camera.position.set(7 + 20, 20 * Math.tan((35.264 * Math.PI) / 180) * Math.SQRT2, 5.5 + 20);
    camera.lookAt(7, 0, 5.5);
    camera.updateMatrixWorld(true);
    const floor = new Vector3(3.2, 0, 8.4);
    const ndc = floor.clone().project(camera);
    const caster = new Raycaster();
    caster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);
    const hit = groundPointFromRay(caster.ray.origin, caster.ray.direction);
    expect(hit?.x).toBeCloseTo(3.2, 5);
    expect(hit?.z).toBeCloseTo(8.4, 5);
  });
});

describe("cursorHeading", () => {
  const at = { x: 5, z: 5 };
  test("faces the cursor's ground point", () => {
    expect(cursorHeading(at, { x: 8, z: 5 }) as number).toBeCloseTo(HEADING.east);
    expect(cursorHeading(at, { x: 5, z: 1 }) as number).toBeCloseTo(HEADING.north);
    expect(cursorHeading(at, { x: 5, z: 9 }) as number).toBeCloseTo(HEADING.south);
    expect(cursorHeading(at, { x: 2, z: 5 }) as number).toBeCloseTo(HEADING.west);
  });
  test("ignores a cursor at the henchman's feet", () => {
    expect(cursorHeading(at, { x: 5 + CURSOR_DEADZONE / 2, z: 5 })).toBeNull();
    expect(cursorHeading(at, at)).toBeNull();
  });
});

describe("cursor tracker (HUD suppression)", () => {
  test("no cursor before the pointer moves over the scene", () => {
    expect(createCursorTracker().active(scene)).toBeNull();
  });
  test("follows the pointer over the scene", () => {
    const t = createCursorTracker();
    t.move({ x: 0.2, y: -0.4 }, true);
    expect(t.active(scene)).toEqual({ x: 0.2, y: -0.4 });
  });
  test("a pointer over a HUD panel drops the cursor until it comes back", () => {
    const t = createCursorTracker();
    t.move({ x: 0.2, y: -0.4 }, true);
    t.move({ x: 0.9, y: 0.9 }, false);
    expect(t.active(scene)).toBeNull();
    t.move({ x: 0.1, y: 0.1 }, true);
    expect(t.active(scene)).toEqual({ x: 0.1, y: 0.1 });
  });
  test("an open modal or first person suppresses the cursor", () => {
    const t = createCursorTracker();
    t.move({ x: 0.2, y: -0.4 }, true);
    expect(t.active({ overlayOpen: true, firstPerson: false })).toBeNull();
    expect(t.active({ overlayOpen: false, firstPerson: true })).toBeNull();
    expect(t.active(scene)).toEqual({ x: 0.2, y: -0.4 }); // back once the modal closes
  });
  test("leaving the window or losing focus clears it", () => {
    const t = createCursorTracker();
    t.move({ x: 0.2, y: -0.4 }, true);
    t.clear();
    expect(t.active(scene)).toBeNull();
  });
});
