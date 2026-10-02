/** What every archetype module provides (bodies/<archetype>.ts). */
import type { GeniusAccessory, GeniusArchetype } from "@regulus/protocol";
import type { PartBuilder } from "../parts.ts";
import type { Body } from "../rig.ts";
import type { HeadFrame } from "./common.ts";

/** Idle arm poses: each archetype stands in character. */
export type IdlePose =
  | "rub_hands"
  | "thumbs_in_vest"
  | "hands_behind"
  | "hands_in_pocket"
  | "hand_on_hip"
  | "steepled";

export interface MotionStyle {
  idle: IdlePose;
  /** Forward lean of the spine when standing, degrees (hunch > 0, proud chest < 0). */
  lean: number;
  /** Thigh swing amplitude when walking, degrees. */
  stride: number;
  /** Arm swing amplitude when walking, degrees (0 with the arms held). */
  armSwing: number;
  /** Side-to-side hip roll when walking, degrees (waddle, sashay). */
  sway: number;
  /** Vertical bounce per step, metres. */
  bob: number;
  /** Keep the idle arms while walking (hands behind the back). */
  walkKeepsArms?: boolean;
}

export interface ArchetypeModel {
  id: GeniusArchetype;
  body: Body;
  /** The head block (model space), where the talking mouth goes (#48). */
  head: HeadFrame;
  style: MotionStyle;
  /** Body, clothes, face and hair. */
  build(p: PartBuilder): void;
  /** One of the archetype's accessories ("none" adds nothing). */
  accessory(p: PartBuilder, accessory: GeniusAccessory): void;
  /** Height an accessory adds above `body.height` (hats), for the name plate. */
  extraHeight?(accessory: GeniusAccessory): number;
}
