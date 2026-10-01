/**
 * Labels for the henchman permission modes (#166). The values and the default
 * per provider come from protocol `permission-modes.ts`, which cites the
 * provider docs; this file only says them in office words. Used by the spawn
 * dialog's "More options" and the henchman panel.
 */
import { type PermissionMode, type ProviderId, permissionModesFor } from "@regulus/protocol";

export interface PermissionModeCopy {
  label: string;
  hint: string;
}

const COPY: Readonly<Record<PermissionMode, PermissionModeCopy>> = {
  auto: {
    label: "Auto mode",
    hint: "Claude approves low-risk actions itself and raises its hand for riskier ones.",
  },
  default: {
    label: "Ask for everything",
    hint: "The henchman raises its hand before every edit and command.",
  },
  acceptEdits: {
    label: "Accept edits",
    hint: "File edits run without asking; commands and network access still ask.",
  },
  "on-request": {
    label: "Ask outside the sandbox",
    hint: "Edits and commands run in the workspace sandbox; the henchman asks before leaving it.",
  },
  never: {
    label: "Never ask",
    hint: "The henchman never raises its hand; its commands stay inside the workspace sandbox.",
  },
};

export function permissionModeCopy(mode: string): PermissionModeCopy | undefined {
  return (COPY as Record<string, PermissionModeCopy>)[mode];
}

/** Short name for the panel; unknown values are shown as they are. */
export function permissionModeLabel(mode: string): string {
  return permissionModeCopy(mode)?.label ?? mode;
}

export interface PermissionModeOption extends PermissionModeCopy {
  value: PermissionMode;
  isDefault: boolean;
}

/** The provider's modes, its default first and marked. */
export function permissionModeOptions(provider: ProviderId): PermissionModeOption[] {
  return permissionModesFor(provider).map((value, i) => ({
    value,
    ...COPY[value],
    isDefault: i === 0,
  }));
}
