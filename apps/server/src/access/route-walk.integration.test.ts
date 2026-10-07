/**
 * The route-table walk (SPEC D27; #270): every route the real server mounts
 * is either about a room, and then answers through the access gate, or is
 * listed here as office business with the reason. A route that is in neither
 * list fails the test, so a new operation-scoped route cannot ship ungated
 * by being forgotten.
 *
 * For every room route the walk asks, as three people who must not see the
 * room (a guest on the same level, the office owner whose GitHub sees
 * nothing, an office admin without a link), for the closed room's real ids
 * and for ids that do not exist. The two answers must be the same: a closed
 * room is indistinguishable from no room. No answer to any of them, on any
 * route, may contain a word that belongs to a closed room.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Person } from "./office.fixture.ts";
import { MARKERS, type RoomThings, type Scenario, startScenario } from "./scenario.fixture.ts";

/** Routes about a room or something in it: gated by operations/access.ts. */
const ROOM_ROUTES = [
  "GET /api/whiteboards/:boardId",
  "GET /api/whiteboards/:boardId/snapshot",
  "PUT /api/whiteboards/:boardId/snapshot",
  "POST /api/operations/:operationId/pictures",
  "GET /api/operations/:operationId/pictures/:decorId",
  "GET /api/boards/:operationId/:kind/:repoId/:number",
  "GET /api/boards/:operationId/:repoId/assignees",
  "POST /api/boards/:operationId/:kind/:repoId/:number/comment",
  "POST /api/boards/:operationId/:kind/:repoId/:number/assign",
  "POST /api/boards/:operationId/:kind/:repoId/:number/merge",
  "POST /api/boards/:operationId/:kind/:repoId/:number/close",
  "PATCH /api/workflows/:id",
  "DELETE /api/workflows/:id",
  "POST /api/workflows/:id/dry-run",
  "GET /api/workflows/runs/:id",
  "POST /api/workflows/runs/:id/cancel",
  "GET /api/operations/:operationId",
  "POST /api/operations/:operationId/archive",
  "POST /api/operations/:operationId/restore",
  "POST /api/operations/:operationId/send-home",
  "DELETE /api/operations/:operationId",
  "GET /api/operations/:operationId/members",
  "PUT /api/operations/:operationId/members/:userId",
  "DELETE /api/operations/:operationId/members/:userId",
  "POST /api/operations/:operationId/repos/:repoId/clone",
  "PATCH /api/compound/rooms/:operationId",
  "DELETE /api/compound/rooms/:operationId",
  "GET /api/operations/:operationId/room-settings",
  "PUT /api/operations/:operationId/room-settings",
  "GET /api/agents/:agentId/changes",
  "GET /api/agents/:agentId/changes/file",
  "GET /api/agents/:agentId/changes/blob",
  "POST /api/agents/:agentId/changes/commit",
  "POST /api/agents/:agentId/changes/discard",
  "GET /api/meetings/:id",
  "POST /api/meetings/:id/:action",
  // Named by a query parameter or a body field instead of the path.
  "GET /api/workflows",
  "POST /api/workflows",
  "GET /api/workflows/events",
  "GET /api/workflows/runs",
  "GET /api/meetings",
  "POST /api/meetings",
  "POST /api/compound/check",
] as const;

/** Routes that are not about one room, each with why. Their answers are still searched. */
const OFFICE_ROUTES: Record<string, string> = {
  "GET /healthz": "liveness",
  "GET /metrics": "process metrics, route labels only",
  "GET /api/auth/*": "Better Auth",
  "POST /api/auth/*": "Better Auth",
  "GET /api/auth-config": "sign-in options",
  "GET /api/me": "the caller's own profile",
  "POST /api/invites": "office people",
  "GET /api/invites/:token": "office people",
  "POST /api/join/:token": "office people",
  "PATCH /api/users/:userId/role": "office people",
  "GET /api/users": "office people (names and roles)",
  "POST /api/users/:userId/emergency-stop": "office action: answers a count, never a room",
  "GET /api/jukebox/tracks": "lobby jukebox",
  "POST /api/jukebox/tracks": "lobby jukebox",
  "POST /api/jukebox/youtube": "lobby jukebox",
  "GET /api/jukebox/tracks/:id/audio": "lobby jukebox",
  "GET /api/media": "voice: whether it is on",
  "POST /api/media/token": "voice: the caller's own token for the office room",
  "PUT /api/me/avatar": "the caller's own genius",
  "GET /api/notifications/attention": "the caller's own henchmen, in rooms they can see",
  "GET /api/notifications/prefs": "the caller's own preferences",
  "PUT /api/notifications/prefs": "the caller's own preferences",
  "GET /api/notifications/channels": "office channels; room ids filtered per viewer",
  "POST /api/notifications/channels": "office channels; rooms checked against the gate",
  "PATCH /api/notifications/channels/:id": "office channels; rooms checked against the gate",
  "DELETE /api/notifications/channels/:id": "office channels",
  "POST /api/notifications/channels/:id/test": "office channels: fixed test text",
  "GET /api/skin-rules": "henchman skins by role and provider",
  "POST /api/skin-rules": "henchman skins",
  "PATCH /api/skin-rules/:id": "henchman skins",
  "DELETE /api/skin-rules/:id": "henchman skins",
  "GET /api/usage/me": "the caller's own usage",
  "GET /api/search": "office-wide; hits filtered by the gate",
  "GET /api/search/context": "office-wide; the hit's room checked by the gate",
  "GET /api/github/connection": "the office's GitHub connection",
  "GET /api/github/repos": "repo picker: only repos the caller's own account sees",
  "PUT /api/github/pat": "the office's GitHub connection",
  "DELETE /api/github/connection": "the office's GitHub connection",
  "POST /api/github/app/manifest": "the office's GitHub App",
  "GET /api/github/app/requirements": "the office's GitHub App",
  "PUT /api/github/app": "the office's GitHub App",
  "GET /api/github/app/callback": "the office's GitHub App",
  "GET /api/github/app/installed": "the office's GitHub App",
  "GET /api/github/link": "the caller's own link and the repos it opens",
  "POST /api/github/link/start": "the caller's own link",
  "GET /api/github/link/callback": "the caller's own link",
  "POST /api/github/link/check": "the caller's own link",
  "DELETE /api/github/link": "the caller's own link",
  "POST /api/github/webhook": "GitHub's signed deliveries, no session",
  "GET /api/github/sync": "board sync status: counts only",
  "GET /api/operations": "list: only rooms open to the caller",
  "POST /api/operations": "new room: the caller's own GitHub access is checked first",
  "GET /api/operations/archived": "list: only rooms the caller's GitHub covers",
  "GET /api/compound": "layout: per viewer",
  "POST /api/compound/rooms": "new room: the caller's own GitHub access is checked first",
  "POST /api/worktrees/prune": "office maintenance: answers counts only",
  "GET /api/meetings/active": "list: only meetings in rooms open to the caller",
  "POST /api/agents/:agentId/hooks/claude": "the henchman's own hook token, no session",
  "POST /api/agents/:agentId/statusline": "the henchman's own hook token, no session",
  "POST /mcp": "office agents: per-agent token; tools go through the gate (pm/access.ts)",
  "GET /mcp": "office agents: per-agent token",
  "DELETE /mcp": "office agents: per-agent token",
  "GET /api/agent-tools": "office agents: per-agent token",
  "POST /api/agent-tools/:name": "office agents: per-agent token; tools go through the gate",
  "GET /api/office-agents/settings": "office agents",
  "PUT /api/office-agents/settings": "office agents",
  "GET /api/office-agents/runs-on": "office agents",
  "GET /api/office-agents/requests": "office agents: questions for the caller",
  "POST /api/office-agents/requests/:id/answer": "office agents: the caller's own question",
  "GET /api/office-agents": "office agents; grants filtered per viewer",
  "POST /api/office-agents": "office agents",
  "PATCH /api/office-agents/:id": "office agents",
  "DELETE /api/office-agents/:id": "office agents",
  "PUT /api/office-agents/:id/grants": "office agents: grants checked against the gate",
  "POST /api/office-agents/:id/tokens": "office agents",
  "DELETE /api/office-agents/:id/tokens/:tokenId": "office agents",
  "POST /api/office-agents/:id/start": "office agents",
  "POST /api/office-agents/:id/stop": "office agents",
  "GET /api/office-agents/:id/conversation": "office agents: the caller's own conversation",
  "POST /api/office-agents/:id/messages": "office agents: the caller's own conversation",
  "GET /api/credential-profiles": "the caller's own provider profiles",
  "GET /api/credential-profiles/manage": "office provider keys",
  "POST /api/credential-profiles": "provider profiles",
  "POST /api/credential-profiles/:profileId/verify": "provider profiles",
  "DELETE /api/credential-profiles/:profileId": "provider profiles",
  "GET /api/provider-logins": "the caller's own provider logins",
  "POST /api/provider-logins/:provider": "the caller's own provider logins",
  "GET /api/provider-logins/flows/:loginId": "the caller's own provider logins",
  "POST /api/provider-logins/flows/:loginId/cancel": "the caller's own provider logins",
};

/** Path parameters a room route may use; a new one must be given a meaning here. */
type Ids = Record<"operationId" | "boardId" | "repoId" | "agentId" | "decorId" | "id", string>;

const NOWHERE = "00000000-0000-4000-8000-000000000270";

function idsOf(room: RoomThings, pattern: string): Ids {
  const id = pattern.includes("/workflows/runs/")
    ? room.runId
    : pattern.includes("/workflows/")
      ? room.workflowId
      : room.meetingId;
  return {
    operationId: room.operationId,
    boardId: room.operationId,
    repoId: room.repoId,
    agentId: room.agentId,
    decorId: room.decorId,
    id,
  };
}

const NO_IDS: Ids = {
  operationId: NOWHERE,
  boardId: NOWHERE,
  repoId: NOWHERE,
  agentId: NOWHERE,
  decorId: NOWHERE,
  id: NOWHERE,
};

/** The request for a route with these ids: path, query and a body that passes validation. */
function request(route: string, ids: Ids, userId: string) {
  const [method, pattern] = route.split(" ") as [string, string];
  const fixed: Record<string, string> = { kind: "issue", number: "7", action: "stop", userId };
  let path = pattern.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const value = (ids as Record<string, string>)[name] ?? fixed[name];
    if (value === undefined) throw new Error(`route ${route}: no meaning for :${name}`);
    return encodeURIComponent(value);
  });
  if (!pattern.includes(":") && method === "GET") path += `?operationId=${ids.operationId}`;
  if (pattern.endsWith("/changes/file") || pattern.endsWith("/changes/blob")) path += "?path=a";
  const bodies: Record<string, unknown> = {
    "POST /api/workflows": { operationId: ids.operationId, name: "w" },
    "POST /api/meetings": { operationId: ids.operationId, repoId: ids.repoId, topic: "t" },
    "POST /api/compound/check": {
      operationId: ids.operationId,
      placement: { gridX: 1, gridY: 1, width: 6, depth: 6, doorSide: "south" },
    },
    "PUT /api/operations/:operationId/members/:userId": { access: "view" },
    "PATCH /api/compound/rooms/:operationId": {
      placement: { gridX: 1, gridY: 1, width: 6, depth: 6, doorSide: "south" },
    },
    "DELETE /api/operations/:operationId": { confirmName: "Bravo-secret" },
    "DELETE /api/compound/rooms/:operationId": { confirmName: "Bravo-secret" },
    "PUT /api/operations/:operationId/room-settings": { deskCount: 2, decorStyle: "lab" },
    "POST /api/boards/:operationId/:kind/:repoId/:number/comment": { body: "hello" },
  };
  return { method, path, body: method === "GET" ? undefined : (bodies[route] ?? {}) };
}

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
}, 60_000);
afterAll(async () => {
  await s?.stop();
});

describe("the route table", () => {
  test("every mounted route is classified: about a room, or office business with a reason", () => {
    const mounted = s.office.routes().map((r) => `${r.method} ${r.pattern}`);
    expect(mounted.length).toBeGreaterThan(100);
    const known = new Set<string>([...ROOM_ROUTES, ...Object.keys(OFFICE_ROUTES)]);
    // A route that is in neither list is a route nobody has looked at.
    expect(mounted.filter((route) => !known.has(route))).toEqual([]);
    // And the lists name nothing that is not mounted (a stale entry hides a renamed route).
    expect([...known].filter((route) => !mounted.includes(route))).toEqual([]);
    // Anything addressed by an operation, board, repo, henchman or picture id is a room route.
    const scoped = /:(operationId|boardId|repoId|agentId|decorId)\b/;
    expect(
      Object.keys(OFFICE_ROUTES).filter(
        (r) => scoped.test(r) && !r.includes("/hooks/") && !r.endsWith("/statusline"),
      ),
    ).toEqual([]);
  });

  test("the walk reaches real things: the person who may see the rooms gets real answers", async () => {
    let reached = 0;
    for (const route of ROOM_ROUTES.filter((r) => r.startsWith("GET "))) {
      const real = request(route, idsOf(s.bravo, route), s.gus.id);
      const none = request(route, NO_IDS, s.gus.id);
      const a = await s.office.call(s.mia, real.method, real.path);
      const b = await s.office.call(s.mia, none.method, none.path);
      if (a.status !== b.status || (await a.text()) !== (await b.text())) reached += 1;
    }
    // Every GET room route but the file readers (no runner in this office) tells them apart.
    expect(reached).toBeGreaterThanOrEqual(12);
  });

  test("for people who may not see a room, every room route answers as if it did not exist", async () => {
    const outsiders: [string, Person][] = [
      ["guest on the same level", s.gus],
      ["office owner, GitHub sees nothing", s.olga],
      ["office admin, no link", s.ned],
    ];
    const failures: string[] = [];
    for (const [label, who] of outsiders) {
      for (const room of [s.bravo, s.charlie]) {
        for (const route of ROOM_ROUTES) {
          const real = request(route, idsOf(room, route), s.gus.id);
          const none = request(route, NO_IDS, s.gus.id);
          const a = await s.office.call(who, real.method, real.path, real.body);
          const b = await s.office.call(who, none.method, none.path, none.body);
          const [ta, tb] = [await a.text(), await b.text()];
          const same = (t: string) =>
            t.replaceAll(room.operationId, NOWHERE).replaceAll(room.repoId, NOWHERE);
          if (a.status !== b.status || same(ta) !== same(tb)) {
            failures.push(
              `${label}: ${route} -> ${a.status} ${ta.slice(0, 120)} (no such: ${b.status})`,
            );
          }
          // (The placement check is a question, not a change: it may answer, identically.)
          const asks = route.startsWith("GET ") || route === "POST /api/compound/check";
          if (a.status >= 200 && a.status < 300 && !asks) {
            failures.push(`${label}: ${route} was carried out (${a.status})`);
          }
          for (const marker of MARKERS) {
            if (ta.includes(marker)) failures.push(`${label}: ${route} leaks "${marker}"`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
    // Nothing was done to the rooms on the way.
    const still = (await (await s.office.call(s.mia, "GET", "/api/operations")).json()) as {
      operations: { name: string }[];
    };
    expect(still.operations.map((o) => o.name).sort()).toEqual([
      "Alpha",
      "Bravo-secret",
      "Charlie-secret",
    ]);
  }, 60_000);

  test("no office route's answer names a closed room either", async () => {
    const failures: string[] = [];
    const gets = Object.keys(OFFICE_ROUTES).filter((r) => r.startsWith("GET ") && !r.includes(":"));
    for (const who of [s.gus, s.olga, s.ned]) {
      for (const route of gets) {
        const path = route.split(" ")[1] as string;
        const queries = path === "/api/search" ? ["?q=ZEBRA270", "?q=secret"] : [""];
        for (const query of queries) {
          const text = await (
            await s.office.call(who, "GET", `${path.replace("*", "session")}${query}`)
          ).text();
          for (const marker of MARKERS) {
            // The search answer repeats the caller's own search terms.
            if (path === "/api/search" && marker === "ZEBRA270") continue;
            if (text.includes(marker)) failures.push(`${who.name}: ${route} leaks "${marker}"`);
          }
          // Charlie is on a level none of them reach: not even its ids.
          for (const id of [
            s.charlie.operationId,
            s.charlie.levelId,
            s.charlie.repoId,
            s.charlie.agentId,
          ]) {
            if (text.includes(id)) failures.push(`${who.name}: ${route} names ${id}`);
          }
          // Bravo's id is seen from outside by Gus alone, in the layout alone.
          const mayNameBravo = who === s.gus && path === "/api/compound";
          if (!mayNameBravo && text.includes(s.bravo.operationId)) {
            failures.push(`${who.name}: ${route} names Bravo`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);
});
