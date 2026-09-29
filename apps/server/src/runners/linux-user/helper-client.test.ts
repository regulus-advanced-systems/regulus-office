/**
 * The helper client's own behaviour: per-verb timeouts, the timing hook, and
 * that a timed-out helper is reported as a timeout promptly even when a child
 * process still holds its output pipes (#117).
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VERB_TIMEOUTS_MS,
  Helper,
  type HelperCall,
  type HelperCallEvent,
  HelperError,
  runCommand,
  TIMEOUT_CODE,
} from "./helper-client.ts";

function recorder(reply: Partial<Awaited<ReturnType<typeof runCommand>>> = {}) {
  const calls: HelperCall[] = [];
  const events: HelperCallEvent[] = [];
  const helper = new Helper({
    run: async (call) => {
      calls.push(call);
      return { code: 0, stdout: "", stderr: "", ...reply };
    },
    onCall: (e) => events.push(e),
  });
  return { helper, calls, events };
}

describe("Helper timeouts", () => {
  test("provision gets a longer default than other verbs", async () => {
    const { helper, calls } = recorder();
    await helper.call("provision", ["u1"]);
    await helper.call("capture", ["u1", "agent-a", "5"]);
    expect(calls.map((c) => c.timeoutMs)).toEqual([
      DEFAULT_VERB_TIMEOUTS_MS.provision ?? 0,
      DEFAULT_TIMEOUT_MS,
    ]);
    expect(DEFAULT_VERB_TIMEOUTS_MS.provision ?? 0).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
  });

  test("timeouts are configurable, per verb over the default", () => {
    const helper = new Helper({ timeoutMs: 5_000, verbTimeoutsMs: { provision: 90_000 } });
    expect(helper.timeoutFor("provision")).toBe(90_000);
    expect(helper.timeoutFor("exec")).toBe(5_000);
    expect(new Helper({ timeoutMs: 5_000 }).timeoutFor("provision")).toBe(
      DEFAULT_VERB_TIMEOUTS_MS.provision ?? 0,
    );
  });

  test("onCall reports verb, duration and exit code, also for failures", async () => {
    const { helper, events } = recorder({ code: 1, stderr: "office-runner-helper: boom\n" });
    await expect(helper.call("kill", ["u1", "a1"])).rejects.toThrow("kill failed (1): ");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ verb: "kill", code: 1, timedOut: false });
    expect(events[0]?.ms).toBeGreaterThanOrEqual(0);
  });

  test("a timed-out call throws a HelperError that says so", async () => {
    const { helper, events } = recorder({ code: TIMEOUT_CODE, timedOut: true });
    const err = await helper.call("provision", ["u1"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HelperError);
    expect((err as HelperError).message).toContain(
      `provision timed out after ${DEFAULT_VERB_TIMEOUTS_MS.provision} ms`,
    );
    expect((err as HelperError).timedOutAfterMs).toBe(DEFAULT_VERB_TIMEOUTS_MS.provision);
    expect(events[0]).toMatchObject({ verb: "provision", timedOut: true });
  });
});

describe("runCommand", () => {
  test("returns output and exit code", async () => {
    const res = await runCommand({
      argv: ["sh", "-c", "cat; echo err >&2; exit 3"],
      stdin: "in",
      timeoutMs: 5_000,
    });
    expect(res).toEqual({ code: 3, stdout: "in", stderr: "err\n" });
  });

  test("stops at the timeout even when a child keeps the pipes open", async () => {
    // The shell exits on SIGTERM; its background `sleep` keeps stdout open,
    // like useradd under a terminated helper.
    const started = performance.now();
    const res = await runCommand({
      argv: ["sh", "-c", "sleep 5 & sleep 5"],
      timeoutMs: 200,
    });
    expect(res.timedOut).toBe(true);
    expect(res.code).toBe(TIMEOUT_CODE);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
