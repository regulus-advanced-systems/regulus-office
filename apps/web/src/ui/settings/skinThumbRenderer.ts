/**
 * Skin thumbnails (#225) from one offscreen WebGL renderer: each skin and
 * trim is drawn once, in the idle pose at a three-quarter angle, and read
 * back as a PNG data URL. The thumbnails on screen are plain <img>s, so the
 * gallery and the rule cards cost no WebGL context each. The renderer is
 * made on the first request and released a moment after the last one.
 * Loaded lazily (it pulls in three.js).
 */
import {
  AnimationMixer,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { bulbColorFor, bulbLitFor } from "../../scene/avatar/statusBulb.ts";
import { toonMaterialFor, unlitMaterialFor } from "../../scene/avatar/toonMaterial.ts";
import { ARM_OVERLAY_WEIGHT, HENCHMAN_CLIPS, henchmanClips } from "../../scene/henchmen/clips.ts";
import { buildHenchman } from "../../scene/henchmen/instance.ts";
import { henchmanMaterial } from "../../scene/henchmen/palette.ts";
import { paletteFor, skinLook } from "../../scene/henchmen/skins.ts";
import { HEMI_GROUND, HEMI_SKY, KEY_INTENSITY } from "../../scene/lights/Lighting.tsx";

/** Pixel size of a thumbnail (shown at half this, for sharp edges on HiDPI). */
export const THUMB_WIDTH = 160;
export const THUMB_HEIGHT = 192;
/** World units across the thumbnail's height: a henchman from soles to hair, with a margin. */
const VIEW_HEIGHT = 2.0;
const RELEASE_AFTER_MS = 1500;

let renderer: WebGLRenderer | null = null;
let release: ReturnType<typeof setTimeout> | null = null;
let unavailable = false;

function acquire(): WebGLRenderer | null {
  if (unavailable) return null;
  if (release) clearTimeout(release);
  release = setTimeout(() => {
    release = null;
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer = null;
  }, RELEASE_AFTER_MS);
  if (renderer) return renderer;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const options = { alpha: true, antialias: true, preserveDrawingBuffer: true };
    const context = canvas.getContext("webgl2", options) as WebGL2RenderingContext | null;
    if (!context) {
      unavailable = true;
      return null;
    }
    renderer = new WebGLRenderer({ canvas, context, ...options });
    renderer.setPixelRatio(1);
    renderer.setSize(THUMB_WIDTH, THUMB_HEIGHT, false);
    renderer.setClearColor(0x000000, 0);
    return renderer;
  } catch {
    unavailable = true;
    return null;
  }
}

function camera(): OrthographicCamera {
  const halfH = VIEW_HEIGHT / 2;
  const halfW = (halfH * THUMB_WIDTH) / THUMB_HEIGHT;
  const cam = new OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 50);
  cam.position.set(0, 1.4, 6);
  cam.lookAt(0, 0.9, 0);
  return cam;
}

/** One skin or form in one trim as a PNG data URL; null when this browser has no WebGL. */
export function renderSkinThumbnail(skin: string, trim: string | undefined): string | null {
  const gl = acquire();
  if (!gl) return null;
  const scene = new Scene();
  scene.add(new HemisphereLight(HEMI_SKY, HEMI_GROUND, 1.15));
  const key = new DirectionalLight(0xffffff, KEY_INTENSITY);
  key.position.set(-3, 5, 4);
  scene.add(key);

  const henchman = buildHenchman(skin);
  henchman.mesh.material = henchmanMaterial(paletteFor(skin, trim));
  const bulb = bulbColorFor("idle");
  henchman.light.material = bulbLitFor("idle") ? unlitMaterialFor(bulb) : toonMaterialFor(bulb);
  // Facing the camera (+z), turned a little: a three-quarter view.
  henchman.group.rotation.y = 0.45;
  scene.add(henchman.group);

  const mixer = new AnimationMixer(henchman.group);
  const idle = henchmanClips().find((c) => c.name === HENCHMAN_CLIPS.idle);
  if (idle) mixer.clipAction(idle).play();
  // What the form carries (the secretary's clipboard) is in its arm in the picture too.
  const hold = henchmanClips().find((c) => c.name === HENCHMAN_CLIPS.hold);
  if (hold && skinLook(skin).holds) {
    const held = mixer.clipAction(hold);
    held.weight = ARM_OVERLAY_WEIGHT;
    held.play();
  }
  mixer.update(0.35);
  henchman.group.updateMatrixWorld(true);

  gl.render(scene, camera());
  const url = gl.domElement.toDataURL("image/png");
  mixer.stopAllAction();
  mixer.uncacheRoot(henchman.group);
  return url;
}
