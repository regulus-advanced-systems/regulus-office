/**
 * Test fixtures for the usage tracker (#40): an in-memory database with a
 * few humans, a floor and robots with chosen providers, models, credential
 * profiles and session ids.
 */
import type { ProviderId } from "@regulus/protocol";
import { agents, desks, floorRepos, floors } from "../db/schema/index.ts";
import { testDb } from "../floors/test-helpers.ts";

export function usageDb() {
  const { db, addUser } = testDb();
  const ada = addUser("Ada", "owner");
  const bob = addUser("Bob", "member");
  const cy = addUser("Cy", "member");
  db.insert(floors)
    .values({
      id: "floor-1",
      name: "Web",
      slug: "web",
      index: 1,
      paletteId: "oak-sky",
      layoutTemplateId: "t",
    })
    .run();
  db.insert(floorRepos)
    .values({
      id: "repo-1",
      floorId: "floor-1",
      owner: "octo",
      name: "web",
      url: "file:///dev/null",
      defaultBranch: "main",
      workdir: "/nonexistent",
      isPrimary: true,
      cloneStatus: "ready",
    })
    .run();
  db.insert(desks).values({ floorId: "floor-1", seatId: "seat-1" }).run();
  const addAgent = (
    id: string,
    ownerUserId: string,
    opts: {
      provider?: ProviderId;
      model?: string;
      profileId?: string;
      session?: string;
      status?: "working" | "exited";
      taskTitle?: string;
    } = {},
  ) => {
    const provider = opts.provider ?? "claude-code";
    db.insert(agents)
      .values({
        id,
        floorId: "floor-1",
        repoId: "repo-1",
        deskSeatId: "seat-1",
        ownerUserId,
        provider,
        model: opts.model ?? (provider === "codex" ? "gpt-6-sol" : "opus"),
        profileId: opts.profileId ?? `login:${provider}`,
        status: opts.status ?? "working",
        providerSessionId: opts.session ?? null,
        workdir: "/nonexistent",
        taskTitle: opts.taskTitle ?? "Secret project codename",
      })
      .run();
    return id;
  };
  return { db, ada, bob, cy, addAgent };
}

export function usage(
  ts: number,
  tokens: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }> = {},
  extra: Record<string, unknown> = {},
) {
  return {
    ts,
    inputTokens: tokens.input ?? 0,
    outputTokens: tokens.output ?? 0,
    cacheReadTokens: tokens.cacheRead ?? 0,
    cacheWriteTokens: tokens.cacheWrite ?? 0,
    source: "inband" as const,
    ...extra,
  };
}
