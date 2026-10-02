/**
 * The lounge TV in the lobby (#48, SPEC §9.4): a walnut 1960s console set
 * across the coffee table from the sofa. While someone shares their screen
 * (LiveKit, media/session.ts) the picture plays on its glass for everyone
 * in range (a VideoTexture, tvTexture.ts); otherwise a test card says what
 * to do. A click, or `E` from in front of it, opens the picture full screen
 * (ui/media/TvOverlay) or, with nothing on, starts sharing your own screen.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { CanvasTexture, type Mesh, SRGBColorSpace } from "three";
import { useMediaStore } from "../../media/store.ts";
import { usePlayerStore } from "../../state/player.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { colors, fonts } from "../../ui/theme.ts";
import type { CompoundWorld } from "../compound/world.ts";
import { LAIR } from "../lair/palette.ts";
import { TV_REACH, tvSpot } from "./spot.ts";
import { bindTvTexture, fitToScreen, type TvBinding } from "./tvTexture.ts";

const CABINET = { h: 0.5, legs: 0.2 };
const BEZEL = 0.09;

/** The test card shown with nothing on. */
function testCard(lines: string[]): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 288;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#1E2A30";
    ctx.fillRect(0, 0, 512, 288);
    const bars = [LAIR.yellow, LAIR.teal, LAIR.red, LAIR.cream, LAIR.steelPaint, LAIR.orange];
    bars.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(i * (512 / bars.length), 0, 512 / bars.length, 120);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.gold;
    ctx.font = `700 40px ${fonts.ui}`;
    ctx.textAlign = "center";
    ctx.fillText("LOUNGE TV", 256, 170);
    ctx.fillStyle = "#E8DCC0";
    ctx.font = `500 22px ${fonts.ui}`;
    lines.forEach((line, i) => ctx.fillText(line, 256, 212 + i * 30));
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function idleLines(enabled: boolean, canPublish: boolean): string[] {
  if (!enabled) return ["Screen share is off on this office"];
  if (!canPublish) return ["Nothing on. Sit on the sofa to watch."];
  return ["Nothing on. Press E here", "to share your screen."];
}

export function LoungeTv({ world }: { world: CompoundWorld }) {
  const spot = useMemo(() => tvSpot(world), [world]);
  const screen = useMediaStore((s) => s.screen);
  const enabled = useMediaStore((s) => s.status?.enabled === true);
  const canPublish = useMediaStore((s) => s.status?.canPublish === true);
  const card = useMemo(() => testCard(idleLines(enabled, canPublish)), [enabled, canPublish]);
  useEffect(() => () => card.dispose(), [card]);
  const binding = useMemo<TvBinding | null>(
    () => (screen ? bindTvTexture(screen.track) : null),
    [screen],
  );
  useEffect(() => () => binding?.dispose(), [binding]);
  const picture = useRef<Mesh>(null);

  useFrame(() => {
    const mesh = picture.current;
    if (!mesh || !spot) return;
    const [w, h] = binding
      ? fitToScreen(binding.aspect(), spot.screen.w, spot.screen.h)
      : [spot.screen.w, spot.screen.h];
    mesh.scale.set(w, h, 1);
  });

  const use = useCallback(() => {
    const media = useMediaStore.getState();
    if (media.screen) media.openTv();
    else if (media.status?.canPublish) void media.controller?.startShare();
  }, []);

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || detail.handled || !spot) return;
        const p = usePlayerStore.getState();
        if (!p.spawned || Math.hypot(p.x - spot.stand.x, p.z - spot.stand.z) > TV_REACH) return;
        detail.handled = true;
        use();
      },
      [spot, use],
    ),
  );

  if (!spot) return null;
  const { w, d, screen: glass } = spot;
  const screenY = glass.y;
  const housing = { w: glass.w + BEZEL * 2, h: glass.h + BEZEL * 2 };
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    use();
  };
  return (
    <group
      name="lounge-tv"
      position={[spot.x, 0, spot.z]}
      rotation-y={spot.heading}
      userData={{ sharing: screen?.sessionId ?? "" }}
    >
      {/* Legs and the walnut cabinet. */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[(sx * (w - 0.2)) / 2, CABINET.legs / 2, (sz * (d - 0.15)) / 2]}
          >
            <cylinderGeometry args={[0.025, 0.018, CABINET.legs, 6]} />
            <meshToonMaterial color={LAIR.brass} />
          </mesh>
        )),
      )}
      <mesh position={[0, CABINET.legs + CABINET.h / 2, 0]}>
        <boxGeometry args={[w, CABINET.h, d]} />
        <meshToonMaterial color={LAIR.walnut} />
      </mesh>
      <mesh position={[0, CABINET.legs + CABINET.h / 2, -d / 2 - 0.005]}>
        <boxGeometry args={[w * 0.9, CABINET.h * 0.6, 0.01]} />
        <meshToonMaterial color={LAIR.walnutDark} />
      </mesh>
      {/* The set on top: a steel housing, the glass facing the sofa (-z before turning). */}
      <mesh position={[0, screenY, 0.02]}>
        <boxGeometry args={[housing.w, housing.h, 0.2]} />
        <meshToonMaterial color={LAIR.steelDark} />
      </mesh>
      <mesh position={[0, screenY, -0.081]} rotation-y={Math.PI}>
        <planeGeometry args={[glass.w, glass.h]} />
        <meshBasicMaterial color="#0B0E10" toneMapped={false} />
      </mesh>
      <mesh
        ref={picture}
        name="lounge-tv-screen"
        position={[0, screenY, -0.083]}
        rotation-y={Math.PI}
        userData={{ live: Boolean(binding) }}
        onClick={click}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={binding ? binding.texture : card} toneMapped={false} />
      </mesh>
      <mesh position={[glass.w / 2 + BEZEL / 2, CABINET.legs + CABINET.h + 0.04, -0.12]}>
        <sphereGeometry args={[0.025, 8, 6]} />
        <meshBasicMaterial color={binding ? "#E04A3A" : "#4A2A22"} toneMapped={false} />
      </mesh>
    </group>
  );
}
