/**
 * Outfit layers over the jumpsuit body (#184, refitted to the slim body in
 * #281): the lab coat's tails and lapels, the black-ops vest, the cook's
 * buttons, apron and neckerchief, the number two's lapels and tie. Whatever a
 * skin has in the provider colour (`trim`) keeps the henchman's provider
 * readable under any skin.
 */
import { CHEST_FRONT, TORSO_DEPTH } from "./body.ts";
import { box, cylinder, ellipsoid, lathe, type Part, part } from "./shapes.ts";

export const OUTFITS = ["jumpsuit", "labcoat", "vest", "chef", "suit"] as const;
export type Outfit = (typeof OUTFITS)[number];

const F = CHEST_FRONT;

/** Back-and-sides coat tails from the waist to mid-thigh (open at the front so the legs can sit). */
function coatTails(): Part {
  const g = lathe(
    [
      [0.18, 0.66],
      [0.172, 0.78],
      [0.162, 0.9],
      [0.152, 1.0],
    ],
    TORSO_DEPTH + 0.08,
    {},
    12,
  );
  // LatheGeometry has no phi range in our helper: keep the back and sides by dropping front triangles.
  const pos = g.attributes.position;
  const index = g.index;
  if (pos && index) {
    const keep: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const front = tri.every((v) => pos.getZ(v) > 0.05);
      if (!front) keep.push(...tri);
    }
    g.setIndex(keep);
  }
  return part(g, "suit", "Hips");
}

const lapels = (slot: "suitDark" | "shirt"): Part[] => [
  part(
    box([0.05, 0.18, 0.012], { at: [0.045, 1.3, F - 0.004], rot: [-0.12, 0, 0.32] }),
    slot,
    "Body",
  ),
  part(
    box([0.05, 0.18, 0.012], { at: [-0.045, 1.3, F - 0.004], rot: [-0.12, 0, -0.32] }),
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
    part(cylinder(0.006, 0.006, 0.06, { at: [0.085, 1.29, 0.105] }, 5), "trim", "Body"),
  ],
  vest: () => [
    part(box([0.36, 0.25, 0.25], { at: [0, 1.25, 0.0] }, 0.07), "suitDark", "Body"),
    part(box([0.06, 0.07, 0.035], { at: [0.085, 1.2, 0.12] }), "belt", "Body"),
    part(box([0.06, 0.07, 0.035], { at: [0, 1.2, 0.125] }), "belt", "Body"),
    part(box([0.06, 0.07, 0.035], { at: [-0.085, 1.2, 0.12] }), "belt", "Body"),
  ],
  chef: () => {
    const button = (x: number, y: number) =>
      part(ellipsoid([0.01, 0.01, 0.006], { at: [x, y, F - 0.004] }, [5, 3]), "suitDark", "Body");
    return [
      button(0.05, 1.3),
      button(0.05, 1.23),
      button(0.05, 1.16),
      button(-0.02, 1.3),
      button(-0.02, 1.23),
      button(-0.02, 1.16),
      // Waist apron over the belt.
      part(box([0.24, 0.2, 0.014], { at: [0, 0.9, 0.102], rot: [0.04, 0, 0] }), "white", "Hips"),
      // Neckerchief knot.
      part(ellipsoid([0.026, 0.022, 0.018], { at: [0, 1.415, 0.08] }, [6, 4]), "trim", "Body"),
    ];
  },
  suit: () => [
    // Shirt front, lapels, and a tie in the provider colour.
    part(
      box([0.07, 0.13, 0.01], { at: [0, 1.345, F - 0.012], rot: [-0.2, 0, 0] }),
      "shirt",
      "Body",
    ),
    ...lapels("suitDark"),
    part(box([0.028, 0.024, 0.016], { at: [0, 1.4, 0.084] }), "trim", "Body"),
    part(box([0.034, 0.2, 0.01], { at: [0, 1.29, F + 0.001], rot: [-0.1, 0, 0] }), "trim", "Body"),
    // Pocket square.
    part(box([0.036, 0.018, 0.01], { at: [0.085, 1.3, 0.103] }), "white", "Body"),
  ],
};

export function outfitParts(outfit: Outfit): Part[] {
  return builders[outfit]();
}
