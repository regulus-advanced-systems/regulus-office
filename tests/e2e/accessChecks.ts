/**
 * Lost access in the office e2e (#244): the owner gives the member view access to the room, the
 * member walks in, and the owner takes the access away again while the member stands there. The
 * member's room closes at once: a plain message says so, it stays (no flicker of retries), and
 * the browser does not knock on the room's door again.
 */
import { expect, type Page } from "@playwright/test";
import { roomNamed, walkInto, walkToLobby } from "./compoundProbes.ts";
import { waitForScene } from "./probes.ts";

const MESSAGE = "You no longer have access to this room.";

export async function checkAccessWithdrawn(owner: Page, member: Page, operation: string) {
  const room = await roomNamed(owner, operation);
  const memberId = ((await (await member.request.get("/api/me")).json()) as { id: string }).id;
  const origin = new URL(owner.url()).origin;
  const members = `/api/operations/${room.id}/members/${memberId}`;
  const grant = await owner.request.put(members, { data: { access: "view" }, headers: { origin } });
  expect(grant.status(), await grant.text()).toBeLessThan(300);
  // The member's operation list (and with it room access) refreshes on reload.
  await member.reload();
  await waitForScene(member);
  await walkInto(member, operation);
  await expect(member.locator(".rg-topbar__operation")).toHaveText(operation);
  await expect(member.getByText(MESSAGE)).toHaveCount(0);

  // From here on, every time the member's browser asks for a room seat is counted.
  const joins: string[] = [];
  const onRequest = (request: { url(): string }) => {
    if (request.url().includes("/matchmake/")) joins.push(request.url());
  };
  member.on("request", onRequest);
  const revoke = await owner.request.delete(members, { headers: { origin } });
  expect(revoke.status(), await revoke.text()).toBeLessThan(300);

  // Told once, promptly, in plain words; the message stays until dismissed.
  await expect(member.getByText(MESSAGE)).toBeVisible({ timeout: 5_000 });
  await member.waitForTimeout(3_000);
  await expect(member.getByText(MESSAGE)).toHaveCount(1);
  member.off("request", onRequest);
  expect(joins, "the browser asked for the closed room again").toEqual([]);
  // The office itself is still there for them.
  const me = await member.request.get("/api/me");
  expect(me.status()).toBe(200);
  const list = (await (await member.request.get("/api/operations")).json()) as {
    operations?: { operationId: string }[];
  };
  expect((list.operations ?? []).some((o) => o.operationId === room.id)).toBe(false);

  await walkToLobby(member);
}
