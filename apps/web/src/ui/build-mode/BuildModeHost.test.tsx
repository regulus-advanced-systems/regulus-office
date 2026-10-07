import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { rowPlacement, testWorld } from "../../scene/compound/testing.ts";
import { useCameraStore } from "../../state/camera.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, press, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { createCompoundApi } from "./api.ts";
import { BuildModeHost } from "./BuildModeHost.tsx";
import { buildFrame } from "./logic.ts";
import { BUILD_MODE_OVERLAY, useBuildModeStore } from "./store.ts";

useDom();

const world = testWorld([{ id: "apollo", name: "Apollo", placement: rowPlacement(4) }]);
const REQUEST = { name: "Hermes", repos: [{ repo: "octo/hello" }] };

const OPERATION = {
  operationId: "f2",
  levelId: "lobby",
  name: "Hermes",
  slug: "hermes",
  index: 2,
  paletteId: "oak-sky",
  layoutTemplateId: "room",
  archivedAt: null,
  access: "manage",
  repos: [],
};

const mounted: Mounted[] = [];
let checks = 0;

/** The server: every spot is clear unless it overlaps Apollo. */
function server(extra: Parameters<typeof fakeFetch>[0] = {}) {
  checks = 0;
  return fakeFetch({
    "POST /api/compound/check": (call) => {
      checks++;
      const p = (call.body as { placement: { gridX: number } }).placement;
      const clash = p.gridX < 12;
      return {
        body: clash
          ? { ok: false, reason: "overlap", conflicts: ["apollo"] }
          : { ok: true, conflicts: [] },
      };
    },
    ...extra,
  });
}

async function start(kind: "create" | "move" = "create") {
  await act(async () => {
    useBuildModeStore
      .getState()
      .start(
        world,
        kind === "create"
          ? { kind: "create", request: REQUEST }
          : { kind: "move", operationId: "apollo", name: "Apollo" },
        buildFrame(world),
      );
  });
  await settle();
}

const status = () => document.querySelector('[data-testid="build-status"]')?.textContent ?? "";
const store = () => useBuildModeStore.getState();

/** Let the debounced server check run. */
async function checked() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });
  await settle();
}

describe("build mode", () => {
  beforeEach(() => {
    useCompoundStore.getState().set(world);
    useCameraStore.getState().reset();
  });
  afterEach(async () => {
    for (const m of mounted.splice(0)) await m.unmount();
    await act(async () => {
      store().cancel();
      useBuildModeStore.setState({
        added: null,
        watching: null,
        returnZoom: null,
        followMove: null,
      });
      useUiStore.setState({ overlay: null });
      useCompoundStore.getState().set(null);
      useOperationsStore.getState().clear();
    });
  });

  test("placing: the camera pulls out, the ghost starts clear, Enter builds there", async () => {
    const f = server({
      "POST /api/compound/rooms": (call) => ({
        status: 201,
        body: {
          operation: OPERATION,
          room: {
            ...(call.body as { placement: object }).placement,
            operationId: "f2",
            levelId: "lobby",
            name: "Hermes",
            doorX: 0,
            doorY: 0,
            buildState: "building",
            buildEndsAt: Date.now() + 20_000,
          },
        },
      }),
    });
    mounted.push(await mount(<BuildModeHost api={createCompoundApi({ fetch: f.fetch })} />));
    const zoomBefore = useCameraStore.getState().zoom;
    await start();
    expect(useUiStore.getState().overlay).toBe(BUILD_MODE_OVERLAY);
    expect(useCameraStore.getState().zoom).toBe(1);
    expect(text()).toContain("Build Hermes");
    await checked();
    expect(checks).toBe(1);
    expect(status()).toContain("Clear to build");
    const placement = store().placement();

    await press(window, "Enter");
    await settle();
    const place = f.calls.find((c) => c.path === "/api/compound/rooms");
    expect(place?.body).toEqual({ ...REQUEST, placement });
    expect(store().intent).toBeNull();
    expect(useUiStore.getState().overlay).toBeNull();
    expect(useOperationsStore.getState().operations?.map((x) => x.operationId)).toEqual(["f2"]);
    // The new room's status panel; the camera stays out while it is built.
    expect(text()).toContain("Operation set up");
    expect(store().watching).toBe("f2");
    expect(useCameraStore.getState().zoom).toBe(1);
    await act(async () => store().stopWatching());
    expect(useCameraStore.getState().zoom).toBe(zoomBefore);
  });

  test("the keyboard: arrows move the ghost, R turns the door, Escape cancels", async () => {
    const f = server();
    mounted.push(await mount(<BuildModeHost api={createCompoundApi({ fetch: f.fetch })} />));
    const zoomBefore = useCameraStore.getState().zoom;
    await start();
    const g = store().ghost;
    await press(window, "ArrowRight");
    expect(store().ghost).not.toEqual(g);
    expect(store().pinned).toBe(true);
    await press(window, "ArrowLeft");
    expect(store().ghost).toEqual(g);
    await press(window, "r");
    expect(store().doorSide).toBe("west");
    await press(window, "R", { shiftKey: true });
    expect(store().doorSide).toBe("south");
    // Keys typed into a text field are not build mode's.
    const input = document.createElement("input");
    document.body.append(input);
    await press(input, "r");
    expect(store().doorSide).toBe("south");
    input.remove();
    await press(window, "Escape");
    expect(store().intent).toBeNull();
    expect(useUiStore.getState().overlay).toBeNull();
    expect(useCameraStore.getState().zoom).toBe(zoomBefore);
    expect(f.calls.some((c) => c.path === "/api/compound/rooms")).toBe(false);
  });

  test("a red ghost says why (the server's reason) and does not build", async () => {
    const f = server();
    mounted.push(await mount(<BuildModeHost api={createCompoundApi({ fetch: f.fetch })} />));
    await start();
    await act(async () => store().pinAt(world, { x: 6, y: 28 }));
    await checked();
    expect(status()).toBe("It overlaps Apollo.");
    expect(button("Build here (Enter)")?.disabled).toBe(true);
    // A size change keeps the room's middle where it was.
    await act(async () => store().setSize(world, { w: 6, d: 6 }));
    expect(store().ghost).toEqual({ x: 7, y: 29 });
  });

  test("a spot taken while deciding is refused with the reason; build mode stays open", async () => {
    const f = server({
      "POST /api/compound/rooms": {
        status: 409,
        body: { error: "placement_invalid", reason: "too_close", conflicts: ["apollo"] },
      },
    });
    mounted.push(await mount(<BuildModeHost api={createCompoundApi({ fetch: f.fetch })} />));
    await start();
    await checked();
    await click(button("Build here (Enter)") as HTMLButtonElement);
    await settle();
    expect(store().intent?.kind).toBe("create");
    expect(status()).toBe("Too close to Apollo: keep 2 tiles clear for a corridor.");
  });

  test("moving: starts on the room, refused while henchmen run, moves and takes the mover along", async () => {
    let henchmen = true;
    const f = server({
      "PATCH /api/compound/rooms/apollo": () =>
        henchmen
          ? {
              status: 409,
              body: {
                error: "room_has_running_henchmen",
                henchmen: [
                  {
                    agentId: "a1",
                    ownerUserId: "u1",
                    ownerName: "Ada",
                    status: "working",
                    taskTitle: "x",
                    running: true,
                  },
                ],
              },
            }
          : { body: {} },
    });
    mounted.push(await mount(<BuildModeHost api={createCompoundApi({ fetch: f.fetch })} />));
    const apollo = world.rooms.find((r) => r.id === "apollo");
    if (!apollo) throw new Error("no apollo");
    usePlayerStore.setState({ x: apollo.origin.x + 4, z: apollo.origin.z + 4 });
    await start("move");
    expect(text()).toContain("Move Apollo");
    expect(store().ghost).toEqual({ x: apollo.rect.x, y: apollo.rect.y });
    await act(async () => store().pinAt(world, { x: 20, y: 28 }));
    await checked();
    await press(window, "Enter");
    await settle();
    expect(status()).toContain("A henchman is running in this room");
    expect(store().intent?.kind).toBe("move");
    henchmen = false;
    await press(window, "Enter");
    await settle();
    expect(store().intent).toBeNull();
    expect(store().followMove).toEqual({
      operationId: "apollo",
      placement: { gridX: 20, gridY: 28, width: 8, depth: 8, doorSide: "south" },
    });
  });
});
