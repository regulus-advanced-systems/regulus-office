/**
 * Runner container changes for one human are serialized (#130): while a slow
 * create holds the container name (the daemon answers 404 for it until done), a
 * second `ensure` — the spawn next to the spawn dialog's login check — used to
 * create too, get 409 "name already in use" and fail the spawn.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SecretEnv } from "@regulus/agent-adapters";
import { RunnerContainers } from "./containers.ts";
import { DockerRunner } from "./docker-runner.ts";
import { EngineClient } from "./engine.ts";
import { FakeEngine } from "./testing/fake-engine.ts";

const IMAGE = "runner:test";
const settings = { image: IMAGE, prefix: "office", user: "1001:1001", home: "/home/runner" };
const user = { userId: "u1" };

let fake: FakeEngine;

beforeEach(async () => {
  fake = await FakeEngine.start();
  fake.images.add(IMAGE);
  fake.createDelayMs = 150;
});

afterEach(async () => {
  await fake.stop();
});

describe("runner container changes (#130)", () => {
  test("overlapping ensures share one slow create instead of failing with 409", async () => {
    const containers = new RunnerContainers(new EngineClient(fake.dockerHost), settings);
    const [a, b, c] = await Promise.all([
      containers.ensure("u1"),
      containers.ensure("u1"),
      containers.ensure("u1"),
    ]);
    expect(a.id).toBe(b.id);
    expect(b.id).toBe(c.id);
    expect(fake.calls("POST", "/containers/create")).toHaveLength(1);
    expect(fake.containers.size).toBe(1);
  });

  test("an ensure during a recreate gets the new container, not a 409", async () => {
    const containers = new RunnerContainers(new EngineClient(fake.dockerHost), settings);
    const first = await containers.ensure("u1");
    const mount = { Type: "bind" as const, Source: "/srv/w/f/r", Target: "/srv/w/f/r" };
    const [recreated, ensured] = await Promise.all([
      containers.recreate("u1", [mount]),
      containers.ensure("u1"),
    ]);
    expect(recreated.id).not.toBe(first.id);
    expect(ensured.id).toBe(recreated.id);
    expect(ensured.operationMounts).toEqual([mount]);
  });

  test("another human's changes do not wait", async () => {
    const containers = new RunnerContainers(new EngineClient(fake.dockerHost), settings);
    const [u1, u2] = await Promise.all([containers.ensure("u1"), containers.ensure("u2")]);
    expect(u1.id).not.toBe(u2.id);
  });

  test("a login check and a spawn provisioning a new runner at once both work", async () => {
    // The piped wrapper reports its pid first (interactive.ts), then the check answers.
    fake.onExec = (_exec, io) => {
      io.stderr("office-pid:42\n");
      io.stdout('{"loggedIn":true}\n');
      return 0;
    };
    const runner = new DockerRunner({ engine: new EngineClient(fake.dockerHost), ...settings });
    const plan = {
      agentId: "check",
      provider: "claude-code" as const,
      argv: ["claude", "auth", "status"],
      env: SecretEnv.empty(),
      cwd: "/home/runner",
      tmuxSession: "check",
      files: [],
    };
    const [check, handle] = await Promise.all([
      runner.spawnPiped(user, plan),
      runner.provision(user),
    ]);
    expect(handle.containerId).toBeDefined();
    await check.exited;
    expect(fake.containers.size).toBe(1);
  });
});
