/**
 * Five-field cron for schedule triggers (#155), evaluated in UTC:
 * `minute hour day-of-month month day-of-week`, each field `*`, `n`, `a-b`,
 * lists with `,` and steps with `/`. Day-of-week 0 or 7 is Sunday. As in
 * classic cron, when both day fields are restricted either one may match.
 */

interface Field {
  min: number;
  max: number;
}
const FIELDS: readonly Field[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
];

export interface Cron {
  sets: Set<number>[];
  domAny: boolean;
  dowAny: boolean;
}

export class CronError extends Error {
  override name = "CronError";
}

function parseField(text: string, f: Field): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new CronError(`bad step in ${part}`);
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = f.min;
      hi = f.max;
    } else {
      const [a, b] = (range ?? "").split("-");
      lo = Number(a);
      hi = b === undefined ? (stepText === undefined ? lo : f.max) : Number(b);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < f.min || hi > f.max || lo > hi) {
      throw new CronError(`out of range: ${part}`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new CronError("a cron expression has five fields");
  const sets = parts.map((p, i) => parseField(p, FIELDS[i] as Field));
  const dow = sets[4] as Set<number>;
  if (dow.has(7)) dow.add(0);
  return { sets, domAny: parts[2] === "*", dowAny: parts[4] === "*" };
}

export function cronMatches(cron: Cron, at: Date): boolean {
  const [min, hour, dom, month, dow] = cron.sets as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
  ];
  if (!min.has(at.getUTCMinutes()) || !hour.has(at.getUTCHours())) return false;
  if (!month.has(at.getUTCMonth() + 1)) return false;
  const domOk = dom.has(at.getUTCDate());
  const dowOk = dow.has(at.getUTCDay());
  if (cron.domAny || cron.dowAny) return domOk && dowOk;
  return domOk || dowOk;
}

const MINUTE = 60_000;
/** A missed slot older than this (office down) is not made up for. */
export const CATCH_UP_MS = 60 * MINUTE;

/**
 * The latest slot in `(after, now]`, looking back at most {@link CATCH_UP_MS};
 * null when none. Slots are whole minutes (ms since epoch).
 */
export function dueSlot(cron: Cron, after: number, now: number): number | null {
  const operationMin = (t: number) => Math.floor(t / MINUTE) * MINUTE;
  const oldest = Math.max(operationMin(after) + MINUTE, operationMin(now - CATCH_UP_MS));
  for (let t = operationMin(now); t >= oldest; t -= MINUTE) {
    if (cronMatches(cron, new Date(t))) return t;
  }
  return null;
}
