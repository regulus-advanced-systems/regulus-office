/**
 * Top-down SVG of a generated room (#182), for reviews and debugging:
 * walls (full dark, stubs light, the door frame in yellow), rugs, furniture
 * by kind, chairs with their facing, wall anchors and decor along the walls,
 * light pools and the spawn point. Not used by the app.
 */
import type { Wall } from "../types.ts";
import type { RoomLayout } from "./types.ts";

const PX = 32;
const PAD = 40;

const KIND_FILL: Record<string, string> = {
  shared_table: "#8B6B4A",
  cabinet: "#5C6B73",
  bookshelf: "#6B4E3D",
  counter: "#7A7A70",
  plant: "#3E8E41",
  plant_small: "#5DAA5F",
  floor_lamp: "#F2C200",
  water_cooler: "#7FB8D8",
  armchair: "#A0522D",
  coffee_table: "#9C7A54",
};

const ANCHOR_FILL: Record<string, string> = {
  issue_board: "#E07A5F",
  pr_board: "#81B29A",
  queue_clipboard: "#F2CC8F",
  whiteboard: "#FFFFFF",
  usage_wall: "#2EC4B6",
  gong: "#C9A227",
  picture: "#B388EB",
  tv: "#333333",
};

const LABEL: Record<string, string> = {
  issue_board: "issues",
  pr_board: "PRs",
  queue_clipboard: "Q",
  whiteboard: "whiteboard",
  usage_wall: "usage",
  gong: "gong",
  picture: "pic",
};

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const m = (v: number) => (v * PX).toFixed(1);

function wallLine(w: Wall, door: boolean): string {
  const stroke = door ? "#F2C200" : w.height === "full" ? "#2B2B2E" : "#9A948C";
  const width = w.height === "full" ? 6 : 4;
  return `<line x1="${m(w.from.x)}" y1="${m(w.from.z)}" x2="${m(w.to.x)}" y2="${m(w.to.z)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="square"/>`;
}

/** Point `t` along a wall, pushed `off` metres into the room. */
function onWall(w: Wall, t: number, off: number) {
  const len = Math.abs(w.to.x - w.from.x) + Math.abs(w.to.z - w.from.z);
  const dx = (w.to.x - w.from.x) / len;
  const dz = (w.to.z - w.from.z) / len;
  const n = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] }[w.facing] as number[];
  return {
    x: w.from.x + dx * t + (n[0] as number) * off,
    z: w.from.z + dz * t + (n[1] as number) * off,
    along: dx !== 0,
  };
}

export function roomLayoutSvg(layout: RoomLayout, title?: string): string {
  const { width, depth } = layout.size;
  const pal = layout.room.materials.palette;
  const out: string[] = [];
  const W = width * PX + PAD * 2;
  const H = depth * PX + PAD * 2 + 24;
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#1E1C1A"/>`,
    `<text x="${PAD}" y="24" fill="#EEE" font-size="15">${esc(title ?? layout.name)}</text>`,
    `<g transform="translate(${PAD},${PAD + 12})">`,
    `<rect width="${m(width)}" height="${m(depth)}" fill="${pal.floor}"/>`,
  );
  // 2 m tile grid.
  for (let x = 2; x < width; x += 2)
    out.push(
      `<line x1="${m(x)}" y1="0" x2="${m(x)}" y2="${m(depth)}" stroke="#000" stroke-opacity="0.12"/>`,
    );
  for (let z = 2; z < depth; z += 2)
    out.push(
      `<line x1="0" y1="${m(z)}" x2="${m(width)}" y2="${m(z)}" stroke="#000" stroke-opacity="0.12"/>`,
    );
  for (const light of layout.room.lighting.lights) {
    out.push(
      `<circle cx="${m(light.x)}" cy="${m(light.z)}" r="${m(light.range / 2.5)}" fill="${light.color}" fill-opacity="0.16"/>`,
    );
  }
  for (const rug of layout.rugs) {
    const fill = rug.style === "patch" ? (pal.floorAlt ?? pal.floor) : (pal.wallAlt ?? pal.accent);
    out.push(
      `<rect x="${m(rug.rect.x)}" y="${m(rug.rect.z)}" width="${m(rug.rect.w)}" height="${m(rug.rect.d)}" fill="${fill}" fill-opacity="0.55" rx="4"/>`,
    );
  }
  for (const o of layout.obstacles) {
    const fill = KIND_FILL[o.kind] ?? "#777";
    const round = o.kind.startsWith("plant") || o.kind === "floor_lamp";
    out.push(
      `<rect x="${m(o.rect.x)}" y="${m(o.rect.z)}" width="${m(o.rect.w)}" height="${m(o.rect.d)}" fill="${fill}" stroke="#111" stroke-width="1" rx="${round ? m(o.rect.w / 2) : 2}"/>`,
    );
  }
  for (const d of layout.decor) {
    out.push(`<circle cx="${m(d.x)}" cy="${m(d.z)}" r="4" fill="#F4E9D8" stroke="#333"/>`);
  }
  for (const seat of layout.seats) {
    const { x, z, heading } = seat.pose;
    const fx = x - Math.sin(heading) * 0.35;
    const fz = z - Math.cos(heading) * 0.35;
    const desk = seat.kind === "desk";
    out.push(
      `<circle cx="${m(x)}" cy="${m(z)}" r="${m(0.3)}" fill="${desk ? "#3A3A3A" : "#A0522D"}" stroke="#EEE" stroke-width="1"/>`,
      `<line x1="${m(x)}" y1="${m(z)}" x2="${m(fx)}" y2="${m(fz)}" stroke="#F2C200" stroke-width="2"/>`,
    );
  }
  for (const desk of layout.room.desks) {
    const t = layout.obstacles.find((o) => o.id === desk.tableId);
    if (t)
      out.push(
        `<text x="${m(t.rect.x + t.rect.w / 2)}" y="${m(t.rect.z + t.rect.d / 2 + 0.15)}" fill="#FFF" font-size="13" text-anchor="middle">${desk.id}</text>`,
      );
  }
  for (const w of layout.walls) out.push(wallLine(w, w.id === layout.room.door.wallId));
  const hung = [
    ...layout.wallAnchors.map((a) => ({
      ...a,
      fill: ANCHOR_FILL[a.kind] ?? "#999",
      label: LABEL[a.kind] ?? a.kind,
    })),
    ...layout.wallDecor.map((d) => ({ ...d, fill: "#D9C6A5", label: "" })),
  ];
  for (const a of hung) {
    const wall = layout.walls.find((w) => w.id === a.wallId);
    if (!wall) continue;
    const p = onWall(wall, a.t, 0.18);
    const [rw, rh] = p.along ? [a.w, 0.2] : [0.2, a.w];
    out.push(
      `<rect x="${m(p.x - rw / 2)}" y="${m(p.z - rh / 2)}" width="${m(rw)}" height="${m(rh)}" fill="${a.fill}" stroke="#111"/>`,
    );
    if (a.label) {
      const q = onWall(wall, a.t, 0.55);
      const rot = p.along ? "" : ` transform="rotate(-90 ${m(q.x)} ${m(q.z)})"`;
      out.push(
        `<text x="${m(q.x)}" y="${m(q.z + 0.1)}" fill="#111" font-size="9" text-anchor="middle"${rot}>${a.label}</text>`,
      );
    }
  }
  const s = layout.spawn;
  out.push(
    `<circle cx="${m(s.x)}" cy="${m(s.z)}" r="7" fill="none" stroke="#D7263D" stroke-width="3"/>`,
    "</g></svg>",
  );
  return out.join("\n");
}
