/** Pure formatting for the top bar and status box. */

export interface ClockOptions {
  locale?: string;
  hour12?: boolean;
  timeZone?: string;
}

/** "14:05" (or "2:05 PM" with hour12). Seconds are never shown. */
export function formatClock(date: Date, opts: ClockOptions = {}): string {
  return new Intl.DateTimeFormat(opts.locale ?? "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: opts.hour12 ?? false,
    timeZone: opts.timeZone,
  }).format(date);
}

/** Milliseconds until the wall clock next reaches a whole minute. */
export function msUntilNextMinute(now: number): number {
  const remainder = now % 60_000;
  return remainder === 0 ? 60_000 : 60_000 - remainder;
}

/** GDT-style compact counts: 950, 93.7K, 4.3M, 1.2B. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  const units = [
    { value: 1e9, suffix: "B" },
    { value: 1e6, suffix: "M" },
    { value: 1e3, suffix: "K" },
  ];
  for (const { value, suffix } of units) {
    if (n >= value) {
      const scaled = n / value;
      const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "");
      return `${text}${suffix}`;
    }
  }
  return String(n);
}

/** "$0.00", "$12.40", "$1.2K" for the spend estimate. */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "$0.00";
  if (amount >= 1000) return `$${formatCompact(amount)}`;
  return `$${amount.toFixed(2)}`;
}
