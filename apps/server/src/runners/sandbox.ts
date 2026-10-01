/**
 * Per-agent sandboxes (SPEC §8, D18, #169), shared by both backends: every
 * coding henchman runs in its own sandbox inside its human's runner identity,
 * with its own processes, network namespace, memory/CPU/pids limits and a
 * stable port range. `docker` makes one container per henchman
 * (docker/sandboxes.ts); `linux-user` one systemd scope plus network and pid
 * namespaces per henchman (the helper's `sandbox-up`).
 *
 * Ports: each sandbox gets a slot, and slot `s` owns the ports
 * `base + s*span … base + s*span + span-1`. `PORT` is the first of them, so a
 * dev server that honours `PORT` gets a port no other henchman of the office has.
 * The sandbox has its own network namespace as well, so two dev servers that
 * both insist on 3000 do not collide either. The slot is picked from a hash
 * of the agent id (then the next free one), so a henchman keeps its ports across
 * restarts and resumes unless another henchman took them meanwhile.
 */
import { createHash } from "node:crypto";

export interface SandboxSettings {
  /** Memory limit per sandbox, bytes. */
  memoryBytes: number;
  /** CPU limit per sandbox, cores (may be fractional). */
  cpus: number;
  /** Process/thread limit per sandbox. */
  pids: number;
  /** First port of slot 0. */
  portBase: number;
  /** Ports per sandbox. */
  portSpan: number;
  /** Number of slots (so at most this many sandboxes at once). */
  portSlots: number;
}

/**
 * Defaults for the central office VM (D11: 8 vCPU, 16 GB): an agent CLI needs
 * 0.3–0.8 GB and a dev server 0.2–0.6 GB, so 2 GiB leaves room for a build or
 * a test run; 2 CPUs keep one runaway henchman from taking more than a quarter of
 * the machine. Limits are caps, not reservations: idle henchmen cost nothing.
 */
export const DEFAULT_SANDBOX_SETTINGS: Readonly<SandboxSettings> = {
  memoryBytes: 2 * 1024 ** 3,
  cpus: 2,
  pids: 1024,
  portBase: 20_000,
  portSpan: 10,
  portSlots: 2000,
};

export interface PortRange {
  first: number;
  last: number;
}

export function portRange(slot: number, s: SandboxSettings): PortRange {
  if (!Number.isInteger(slot) || slot < 0 || slot >= s.portSlots) {
    throw new Error(`sandbox slot out of range: ${slot}`);
  }
  const first = s.portBase + slot * s.portSpan;
  return { first, last: first + s.portSpan - 1 };
}

/** The slot a port range belongs to, or null when it is not one of ours. */
export function slotOf(range: PortRange, s: SandboxSettings): number | null {
  const offset = range.first - s.portBase;
  if (offset < 0 || offset % s.portSpan !== 0) return null;
  const slot = offset / s.portSpan;
  if (slot >= s.portSlots || range.last !== range.first + s.portSpan - 1) return null;
  return slot;
}

/** `20000-20009` ⇄ {first, last}. */
export function formatPorts(range: PortRange): string {
  return `${range.first}-${range.last}`;
}

export function parsePorts(text: string | undefined): PortRange | null {
  const m = text?.match(/^(\d{1,5})-(\d{1,5})$/);
  if (!m) return null;
  const first = Number(m[1]);
  const last = Number(m[2]);
  return first > 0 && last >= first && last < 65536 ? { first, last } : null;
}

/** The agent's preferred slot, else the next free one; throws when all are taken. */
export function pickSlot(agentId: string, taken: ReadonlySet<number>, s: SandboxSettings): number {
  const start = createHash("sha256").update(agentId).digest().readUInt32BE(0) % s.portSlots;
  for (let i = 0; i < s.portSlots; i++) {
    const slot = (start + i) % s.portSlots;
    if (!taken.has(slot)) return slot;
  }
  throw new Error(`all ${s.portSlots} sandbox port slots are in use`);
}

/** Env every process in the sandbox gets (not secret). */
export function sandboxEnv(range: PortRange): Record<string, string> {
  return { PORT: String(range.first), OFFICE_SANDBOX_PORTS: formatPorts(range) };
}

/** Checks the port plan fits in 1–65535. */
export function checkSandboxSettings(s: SandboxSettings): SandboxSettings {
  const ok =
    s.memoryBytes > 0 &&
    s.cpus > 0 &&
    Number.isInteger(s.pids) &&
    s.pids > 0 &&
    Number.isInteger(s.portBase) &&
    s.portBase >= 1024 &&
    Number.isInteger(s.portSpan) &&
    s.portSpan >= 1 &&
    Number.isInteger(s.portSlots) &&
    s.portSlots >= 1 &&
    s.portBase + s.portSpan * s.portSlots <= 65_536;
  if (!ok)
    throw new Error("invalid sandbox settings (limits must be positive, ports within 1024-65535)");
  return s;
}
