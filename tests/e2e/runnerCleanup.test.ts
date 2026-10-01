import { describe, expect, test } from "bun:test";
import {
  checkedPrefix,
  type DockerEntry,
  type DockerOps,
  newRunId,
  OFFICE_E2E_PREFIX,
  officeRunnerPrefix,
  removeRunPrefix,
  staleEntries,
  sweepStale,
} from "./runnerCleanup.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const OLD = NOW - 2 * HOUR;
const YOUNG = NOW - 10 * 60 * 1000;

/** An entry labelled with the prefix its name starts with. */
const entry = (name: string, createdAt = OLD, prefixLabel?: string): DockerEntry => ({
  name,
  createdAt,
  prefixLabel: prefixLabel ?? name.split("-").slice(0, 2).join("-"),
});

/** A fake Docker holding `containers` and `volumes`; records what was removed. */
function fakeDocker(containers: DockerEntry[], volumes: DockerEntry[] = []) {
  const removed: { containers: string[]; volumes: string[] } = { containers: [], volumes: [] };
  const listed: string[] = [];
  const ops: DockerOps = {
    containers(namePrefix) {
      listed.push(namePrefix);
      return containers.filter((c) => c.name.startsWith(namePrefix));
    },
    volumes(namePrefix) {
      listed.push(namePrefix);
      return volumes.filter((v) => v.name.startsWith(namePrefix));
    },
    removeContainers: (names) => removed.containers.push(...names),
    removeVolumes: (names) => removed.volumes.push(...names),
  };
  return { ops, removed, listed };
}

describe("run prefix", () => {
  test("a new run id makes a valid, unique main-suite prefix", () => {
    const a = officeRunnerPrefix(newRunId(NOW));
    const b = officeRunnerPrefix(newRunId(NOW));
    expect(a).toMatch(OFFICE_E2E_PREFIX);
    expect(a.startsWith(`rgo2e-${NOW.toString(36)}`)).toBe(true);
    expect(a).not.toBe(b);
    // Within the office's OFFICE_DOCKER_RUNNER_PREFIX limit.
    expect(a).toMatch(/^[a-z0-9][a-z0-9_.-]{0,31}$/);
  });

  test("an empty or unexpected prefix is refused", () => {
    for (const bad of ["", "office", "deploy", "rgo2e-", "rge2e-", "rgo2e-UPPER123", "rgo2e-a b"]) {
      expect(() => checkedPrefix(bad)).toThrow(/refusing/);
    }
    expect(() => officeRunnerPrefix(undefined)).toThrow(/refusing/);
    expect(() => officeRunnerPrefix("")).toThrow(/refusing/);
    expect(() => officeRunnerPrefix("x;rm")).toThrow(/refusing/);
  });
});

describe("teardown", () => {
  const prefix = "rgo2e-mfz1abcd12ef";
  const others = [
    entry("office-runner-u1"),
    entry("deploy-runner-u1"),
    entry("rgo2e-mfz1abcd99ff-runner-u1"),
    entry("rge2e-mfz1abcd-runner-u1"),
  ];

  test("removes exactly this run's containers, then volumes", () => {
    const { ops, removed } = fakeDocker(
      [entry(`${prefix}-runner-u1`), entry(`${prefix}-sbx-a1`, YOUNG), ...others],
      [entry(`${prefix}-home-u1`), entry("office-home-u1"), entry("deploy-home-u1")],
    );
    expect(removeRunPrefix(prefix, ops)).toEqual([
      `${prefix}-runner-u1`,
      `${prefix}-sbx-a1`,
      `${prefix}-home-u1`,
    ]);
    expect(removed).toEqual({
      containers: [`${prefix}-runner-u1`, `${prefix}-sbx-a1`],
      volumes: [`${prefix}-home-u1`],
    });
  });

  test("skips a name whose prefix label does not match", () => {
    const { ops, removed } = fakeDocker([entry(`${prefix}-runner-u1`, OLD, "office")]);
    expect(removeRunPrefix(prefix, ops)).toEqual([]);
    expect(removed.containers).toEqual([]);
  });

  test("an empty or unexpected prefix refuses before listing or deleting anything", () => {
    for (const bad of ["", "office", "deploy", "rgo2e-", "rge2e-mfz1abcd"]) {
      const { ops, removed, listed } = fakeDocker([entry("office-runner-u1"), ...others]);
      expect(() => removeRunPrefix(bad, ops)).toThrow(/refusing/);
      expect(listed).toEqual([]);
      expect(removed).toEqual({ containers: [], volumes: [] });
    }
  });
});

describe("pre-run sweep", () => {
  test("removes only e2e prefixes older than an hour", () => {
    const { ops, removed, listed } = fakeDocker(
      [
        entry("rgo2e-mfz1abcd12ef-runner-u1"),
        entry("rgo2e-mfz1abcd12ef-janitor-1a2b3c4d"),
        entry("rge2e-mfz1abcd-sbx-a1"),
        entry("rgo2e-mfz9zzzz12ef-runner-u1", YOUNG),
        entry("rge2e-mfz9zzzz-runner-u1", YOUNG),
        entry("office-runner-u1"),
        entry("office-sbx-a1"),
        entry("deploy-runner-u1"),
        entry("deploy-office-1"),
      ],
      [
        entry("rgo2e-mfz1abcd12ef-home-u1"),
        entry("rge2e-mfz1abcd-home-u1"),
        entry("rge2e-mfz9zzzz-home-u1", YOUNG),
        entry("office-home-u1"),
        entry("deploy-home-u1"),
        entry("deploy_office-data", OLD, ""),
      ],
    );
    sweepStale(ops, NOW);
    expect(listed).toEqual(["rgo2e-", "rgo2e-", "rge2e-", "rge2e-"]);
    expect(removed).toEqual({
      containers: [
        "rgo2e-mfz1abcd12ef-runner-u1",
        "rgo2e-mfz1abcd12ef-janitor-1a2b3c4d",
        "rge2e-mfz1abcd-sbx-a1",
      ],
      volumes: ["rgo2e-mfz1abcd12ef-home-u1", "rge2e-mfz1abcd-home-u1"],
    });
  });

  test("never sweeps a mismatched label, a malformed run or an unknown age", () => {
    const names = staleEntries(
      [
        entry("rgo2e-mfz1abcd12ef-runner-u1", OLD, ""),
        entry("rgo2e-mfz1abcd12ef-runner-u2", OLD, "office"),
        entry("rgo2e-x-runner-u1"),
        entry("rgo2e--runner-u1", OLD, "rgo2e-"),
        entry("rge2e-mfz1abcd-runner-u1", Number.NaN),
        entry("rgo2e-mfz1abcd12ef", OLD, "rgo2e-mfz1abcd12ef"),
        entry("xrgo2e-mfz1abcd12ef-runner-u1", OLD, "xrgo2e-mfz1abcd12ef"),
      ],
      NOW,
    );
    expect(names).toEqual([]);
  });
});
