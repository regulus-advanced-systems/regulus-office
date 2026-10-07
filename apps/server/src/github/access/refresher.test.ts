/** Keeping snapshots current (#267): webhooks, coalescing, the timer, sign-in requests. */
import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../logging.ts";
import { type AnyGitHubEvent, GitHubEventBus } from "../events.ts";
import { type SyncFixture, syncFixture, WEBHOOK_SECRET } from "../sync-fixture.ts";
import { signWebhookBody } from "../webhook-signature.ts";
import { type AccessFixture, accessFixture } from "./fixture.ts";
import { AccessRefresher } from "./refresher.ts";

let f: AccessFixture;
let s: SyncFixture | undefined;
afterEach(() => {
  f?.stop();
  s?.stop();
  s = undefined;
});

const HELLO = { name: "hello", full_name: "octo/hello", owner: { login: "octo" } };

function event(
  name: AnyGitHubEvent["name"],
  payload: Record<string, unknown>,
  repoIds: string[] = [],
): AnyGitHubEvent {
  return {
    name,
    action: typeof payload.action === "string" ? payload.action : null,
    deliveryId: randomUUID(),
    source: "webhook",
    receivedAt: Date.now(),
    repo: null,
    repoIds,
    operationIds: [],
    installationId: null,
    sender: null,
    fromOfficeApp: false,
    stale: false,
    payload,
  } as AnyGitHubEvent;
}

async function linked() {
  f = accessFixture();
  const mia = f.addUser("Mia", "member");
  const ravi = f.addUser("Ravi", "member");
  await f.link(mia.id, "mia");
  await f.link(ravi.id, "ravi");
  f.changes.length = 0;
  f.gh.calls.length = 0;
  const bus = new GitHubEventBus();
  f.refresher.follow(bus);
  return { mia, ravi, bus };
}

/** Whose token asked GitHub for which repo since the calls were last cleared. */
const repoChecks = () =>
  f.gh.calls
    .filter((c) => c.path.startsWith("/repos/"))
    .map((c) => `${c.authorization?.split("x").at(-1)} ${c.path.toLowerCase()}`)
    .sort();

describe("webhooks", () => {
  test("member: the collaborator named, for the repo named", async () => {
    const { mia, bus } = await linked();
    f.people.setPermission("mia", "octo/hello", "none");
    bus.emit(
      event("member", { action: "removed", member: { id: 1001, login: "mia" } }, [
        f.repos.hello,
        f.repos.helloAgain,
      ]),
    );
    await f.refresher.flush();
    expect(repoChecks()).toEqual(["mia /repos/octo/hello"]);
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("none");
    expect(f.changes).toEqual([
      { userId: mia.id, repoIds: [f.repos.hello, f.repos.helloAgain].sort(), reason: "refresh" },
    ]);
  });

  test("member: someone who has not linked, or a repo the office does not follow, asks nothing", async () => {
    const { bus } = await linked();
    bus.emit(event("member", { action: "added", member: { id: 4040 } }, [f.repos.hello]));
    bus.emit(event("member", { action: "added", member: { id: 1001 } }, []));
    await f.refresher.flush();
    expect(f.gh.calls).toEqual([]);
  });

  test("membership and organization member events: that person, every repo", async () => {
    const { mia, ravi, bus } = await linked();
    f.people.setPermission("mia", "octo/secret", "write");
    bus.emit(event("membership", { action: "added", member: { id: 1001 }, team: { id: 5 } }));
    await f.refresher.flush();
    expect(f.service.repoPermissionFor(mia.id, f.repos.secret)).toBe("write");
    expect(repoChecks().every((c) => c.startsWith("mia "))).toBe(true);

    f.gh.calls.length = 0;
    f.people.setPermission("ravi", "octo/hello", "none");
    f.people.setOrgs("ravi", []);
    bus.emit(
      event("organization", { action: "member_removed", membership: { user: { id: 1002 } } }),
    );
    bus.emit(
      event("organization", { action: "member_invited", membership: { user: { id: 1001 } } }),
    );
    await f.refresher.flush();
    expect(repoChecks().every((c) => c.startsWith("ravi "))).toBe(true);
    expect(f.service.repoPermissionFor(ravi.id, f.repos.hello)).toBe("none");
  });

  test("team and repository events: everyone, for the repo named", async () => {
    const { mia, ravi, bus } = await linked();
    f.people.setPermission("mia", "octo/hello", "admin");
    f.people.setPermission("ravi", "octo/hello", "triage");
    bus.emit(event("team", { action: "edited", team: { id: 5 } }, [f.repos.hello]));
    await f.refresher.flush();
    expect(repoChecks()).toEqual(["mia /repos/octo/hello", "ravi /repos/octo/hello"]);
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("admin");
    expect(f.service.repoPermissionFor(ravi.id, f.repos.hello)).toBe("triage");

    // A public repo went private: Ravi can no longer see it.
    f.gh.calls.length = 0;
    f.people.setPermission("ravi", "octo/hello", "none");
    bus.emit(event("repository", { action: "privatized" }, [f.repos.hello]));
    // A repository event for a repo the office does not follow asks nothing.
    bus.emit(event("repository", { action: "privatized" }, []));
    await f.refresher.flush();
    expect(repoChecks()).toEqual(["mia /repos/octo/hello", "ravi /repos/octo/hello"]);
    expect(f.service.repoPermissionFor(ravi.id, f.repos.hello)).toBe("none");

    // A team without a repo (deleted, renamed) or an org rename: everyone, every repo.
    f.gh.calls.length = 0;
    bus.emit(event("team", { action: "deleted", team: { id: 5 } }));
    await f.refresher.flush();
    expect(repoChecks()).toHaveLength(6);
  });

  test("a burst of webhooks about one person asks GitHub once", async () => {
    const { bus } = await linked();
    for (let i = 0; i < 20; i++) {
      bus.emit(event("membership", { action: "added", member: { id: 1001 } }));
    }
    await f.refresher.flush();
    expect(f.gh.calls.filter((c) => c.path === "/user")).toHaveLength(1);
  });

  test("polled events and the board events do not refresh anyone", async () => {
    const { bus } = await linked();
    bus.emit({ ...event("repository", { action: "edited" }, [f.repos.hello]), source: "poll" });
    bus.emit(event("issues", { action: "opened" }, [f.repos.hello]));
    await f.refresher.flush();
    expect(f.gh.calls).toEqual([]);
  });

  test("a signed member delivery travels from the webhook route to the event bus", async () => {
    f = accessFixture();
    s = syncFixture();
    const body = JSON.stringify({
      action: "removed",
      member: { id: 1001, login: "mia" },
      repository: HELLO,
      sender: { login: "olga", id: 1, type: "User" },
    });
    const url = "https://office.example.com/api/github/webhook";
    const request = new Request(url, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-github-event": "member",
        "x-github-delivery": randomUUID(),
        "x-hub-signature-256": signWebhookBody(WEBHOOK_SECRET, body),
      },
    });
    const res = await s.sync.webhookHandler({ request, url: new URL(url), params: {} });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    const got = s.events.find((e) => e.name === "member");
    expect(got).toMatchObject({ action: "removed", source: "webhook" });
    expect(got?.repoIds.length).toBeGreaterThan(0);
  });
});

describe("the timer and requests", () => {
  test("the timer refreshes everyone; stop ends it", async () => {
    let passes = 0;
    const refresher = new AccessRefresher({
      service: {
        refreshAll: async () => {
          passes += 1;
        },
        refreshUser: async () => ({ state: "not_linked" }),
        linkedUserIds: () => [],
        userIdForGitHubUser: () => null,
      },
      logger: createLogger({ level: "silent" }),
      intervalMs: 10,
    });
    refresher.start();
    await Bun.sleep(60);
    refresher.stop();
    const seen = passes;
    expect(seen).toBeGreaterThanOrEqual(2);
    await Bun.sleep(40);
    expect(passes).toBe(seen);
  });

  test("a request (sign-in) refreshes that person after the debounce", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    await f.link(mia.id, "mia");
    f.people.setPermission("mia", "octo/secret", "read");
    f.refresher.request(mia.id);
    expect(f.service.repoPermissionFor(mia.id, f.repos.secret)).toBe("none");
    await Bun.sleep(50);
    await f.refresher.flush();
    expect(f.service.repoPermissionFor(mia.id, f.repos.secret)).toBe("read");
  });

  test("a failing refresh does not stop the next person's", async () => {
    const done: string[] = [];
    const refresher = new AccessRefresher({
      service: {
        refreshAll: async () => {},
        refreshUser: async (userId: string) => {
          if (userId === "a") throw new Error("boom");
          done.push(userId);
          return { state: "not_linked" };
        },
        linkedUserIds: () => ["a", "b"],
        userIdForGitHubUser: () => null,
      },
      logger: createLogger({ level: "silent" }),
      debounceMs: 1,
    });
    refresher.requestAll();
    await refresher.flush();
    expect(done).toEqual(["b"]);
    refresher.stop();
  });
});
