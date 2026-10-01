/**
 * Outfit layers over the jumpsuit body (#184): the lab coat's tails and
 * lapels, the black-ops vest, the chef's buttons, apron and neckerchief, the
 * number two's lapels and tie. Whatever a skin has in the provider colour
 * (`trim`) keeps the henchman's provider readable under any skin.
 */
import { box, cylinder, ellipsoid, lathe, type Part, part } from "./shapes.ts";

export const OUTFITS = ["jumpsuit", "labcoat", "vest", "chef", "suit"] as const;
export type Outfit = (typeof OUTFITS)[number];

/** Back-and-sides coat tails from the waist to mid-thigh (open at the front so the legs can sit). */
function coatTails(): Part {
  const g = lathe(
    [
      [0.235, 0.74],
      [0.245, 0.62],
      [0.265, 0.5],
      [0.28, 0.4],
    ],
    0.8,
    {},
    14,
  );
  // LatheGeometry has no phi range in our helper: keep the back two thirds by dropping front triangles.
  const pos = g.attributes.position;
  const index = g.index;
  if (pos && index) {
    const keep: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const front = tri.every((v) => pos.getZ(v) > 0.07);
      if (!front) keep.push(...tri);
    }
    g.setIndex(keep);
  }
  return part(g, "suit", "Hips");
}

const lapels = (slot: "suitDark" | "shirt"): Part[] => [
  part(box([0.07, 0.22, 0.014], { at: [0.065, 1.06, 0.186], rot: [-0.08, 0, 0.38] }), slot, "Body"),
  part(
    box([0.07, 0.22, 0.014], { at: [-0.065, 1.06, 0.186], rot: [-0.08, 0, -0.38] }),
    slot,
    "Body",
  ),
];

const builders: Readonly<Record<Outfit, () => Part[]>> = {
  jumpsuit: () => [],
  labcoat: () => [
    coatTails(),
    ...lapels("suitDark"),
    // A pen in the provider colour in the breast pocket.
    part(cylinder(0.008, 0.008, 0.07, { at: [0.09, 1.05, 0.178] }, 6), "trim", "Body"),
  ],
  vest: () => [
    part(box([0.52, 0.3, 0.4], { at: [0, 0.98, 0.0] }, 0.09), "suitDark", "Body"),
    part(box([0.09, 0.1, 0.05], { at: [0.11, 0.92, 0.2] }), "belt", "Body"),
    part(box([0.09, 0.1, 0.05], { at: [0, 0.92, 0.205] }), "belt", "Body"),
    part(box([0.09, 0.1, 0.05], { at: [-0.11, 0.92, 0.2] }), "belt", "Body"),
  ],
  chef: () => {
    const button = (x: number, y: number) =>
      part(ellipsoid([0.014, 0.014, 0.008], { at: [x, y, 0.186] }, [6, 4]), "suitDark", "Body");
    return [
      button(0.07, 1.06),
      button(0.07, 0.98),
      button(0.07, 0.9),
      button(-0.03, 1.06),
      button(-0.03, 0.98),
      button(-0.03, 0.9),
      // Waist apron over the belt.
      part(box([0.34, 0.16, 0.02], { at: [0, 0.6, 0.17], rot: [0.1, 0, 0] }), "white", "Hips"),
      // Neckerchief knot.
      part(ellipsoid([0.035, 0.03, 0.025], { at: [0, 1.19, 0.12] }, [8, 6]), "trim", "Body"),
    ];
  },
  suit: () => [
    // Shirt front, lapels, and a tie in the provider colour.
    part(box([0.11, 0.15, 0.012], { at: [0, 1.11, 0.18] }), "shirt", "Body"),
    ...lapels("suitDark"),
    part(box([0.04, 0.03, 0.02], { at: [0, 1.165, 0.185] }), "trim", "Body"),
    part(box([0.05, 0.25, 0.012], { at: [0, 1.03, 0.19], rot: [-0.06, 0, 0] }), "trim", "Body"),
    // Pocket square.
    part(box([0.05, 0.025, 0.012], { at: [0.11, 1.045, 0.178] }), "white", "Body"),
  ],
};

export function outfitParts(outfit: Outfit): Part[] {
  return builders[outfit]();
}
