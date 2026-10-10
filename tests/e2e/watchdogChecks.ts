/**
 * Settings → Watchdog in the office e2e (#253), across two browsers. The owner picks the
 * watchdog, sets Sentry and adds a host through the forms; the SSH key and the Sentry token
 * are typed once and are then nowhere on the page or in a response. With a finished round
 * seeded (seedWatchdog.ts), the owner sees the finding and the summary of the targets without a
 * room; the member sees no setup, no "Do a round now", and neither of those.
 *
 * No round is run (this office has no runner and makes no outbound call): rounds, the SSH
 * probe and the fix are covered in apps/server/src/pm/watchdog.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

/** A made-up key in the right shape; it opens nothing. */
const FAKE_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nE2EFAKEKEYE2EFAKEKEYE2EFAKEKEYE2EFAKEKEYE2EFAKEKEY\n-----END OPENSSH PRIVATE KEY-----";
const FAKE_TOKEN = "sntryu_E2EFAKE0123456789abcdef0123456789";

async function openWatchdog(page: Page) {
  await page.bringToFront();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: "Watchdog", exact: true }).click();
  return dialog;
}

export async function checkWatchdog(owner: Page, member: Page, shots?: string) {
  const dbPath = process.env.E2E_DATA_DIR ? join(process.env.E2E_DATA_DIR, "office.db") : "";
  // Against an external office nothing can be seeded: this step needs the office it started.
  test.skip(!dbPath, "needs the e2e office's own database");
  const n = test.info().repeatEachIndex + 1;
  const tag = randomUUID().slice(0, 8);
  const headers = { origin: new URL(owner.url()).origin };
  const profileId = randomUUID();
  const run = (script: string, ...args: string[]) =>
    execFileSync("bun", [join(import.meta.dirname, script), dbPath, ...args]);
  run("seedOfficeKey.ts", "add", profileId);
  const made = await owner.request.post("/api/office-agents", {
    headers,
    data: {
      name: `Cerberus ${n}`,
      owner: "office",
      engine: "cli-session",
      role: "watchdog",
      provider: "claude-code",
      model: "haiku",
      profileId,
    },
  });
  expect(made.status(), await made.text()).toBe(201);
  const agent = (await made.json()) as { id: string; appearance: string };
  // Its own kit, unless another look is chosen.
  expect(agent.appearance).toBe("black_ops");
  const responses: string[] = [];
  const listen = async (res: { url(): string; text(): Promise<string> }) => {
    if (res.url().includes("/api/watchdog")) responses.push(await res.text().catch(() => ""));
  };
  owner.on("response", listen);
  let hostId = "";
  // For the screenshots: room for a whole form, so nothing is cut off by the dialog's scroll.
  const viewports = [owner.viewportSize(), member.viewportSize()];
  if (shots) {
    await owner.setViewportSize({ width: 1280, height: 1800 });
    await member.setViewportSize({ width: 1280, height: 1800 });
  }

  try {
    const dialog = await openWatchdog(owner);
    const report = dialog.getByRole("region", { name: "Watchdog report" });
    await expect(report).toContainText("No watchdog is on duty.");

    // Duty: who does the rounds.
    const duty = dialog.getByRole("region", { name: "Watchdog duty" });
    await duty.getByLabel("Who does the rounds").selectOption(agent.id);
    await expect(duty.getByLabel("How often")).toHaveValue("60");
    await expect(report).toContainText(`Cerberus ${n} has nothing to watch yet.`);

    // Sentry: the token is typed once.
    const sentry = dialog.getByRole("region", { name: "Watchdog Sentry" });
    await sentry.getByLabel("Organisation slug").fill("acme");
    await sentry.getByLabel("Access token").fill(FAKE_TOKEN);
    await sentry.getByRole("button", { name: "Add a project" }).click();
    await sentry.getByLabel("Project 1 slug").fill("web");
    await sentry.getByRole("button", { name: "Save Sentry" }).click();
    await expect(sentry.getByLabel("Access token")).toHaveValue("");
    await expect(sentry.getByLabel("Access token")).toHaveAttribute(
      "placeholder",
      /A token is stored/,
    );

    // A host with its key and two apps.
    const hosts = dialog.getByRole("region", { name: "Watchdog hosts" });
    await hosts.getByRole("button", { name: "Add a host" }).click();
    const form = hosts.getByRole("form", { name: "New host" });
    await form.getByLabel("Name", { exact: true }).fill("prod-1");
    await form.getByLabel("Address").fill("vps.example.com");
    await form.getByLabel("Read-only user").fill("watchdog");
    await form.getByLabel("That user's SSH private key").fill(FAKE_KEY);
    await form.getByLabel("App 1 name").fill("api");
    await form.getByRole("button", { name: "Add an app" }).click();
    await form.getByLabel("App 2 name").fill("worker");
    if (shots) await form.screenshot({ path: `${shots}/host-form.png` });
    await form.getByRole("button", { name: "Add host" }).click();
    await expect(form).toHaveCount(0);
    await expect(hosts).toContainText("watchdog@vps.example.com:22 · key stored");
    await expect(hosts).toContainText("api (no room), worker (no room)");
    const settings = (await (await owner.request.get("/api/watchdog/settings")).json()) as {
      hosts: Array<{ id: string; hasKey: boolean }>;
      sentry: { hasToken: boolean };
    };
    hostId = settings.hosts[0]?.id ?? "";
    expect(settings.hosts[0]?.hasKey).toBe(true);
    expect(settings.sentry.hasToken).toBe(true);
    // Neither secret is on the page or came back in any response.
    const page = await owner.content();
    for (const text of [page, responses.join("\n"), JSON.stringify(settings)]) {
      expect(text).not.toContain("E2EFAKEKEY");
      expect(text).not.toContain(FAKE_TOKEN);
    }
    // The schedule is left off here (a scheduled round would need a runner, which this office
    // does not have): it has something to watch and does a round when asked.
    await expect(report).toContainText(`Cerberus ${n} is off duty: rounds only when asked.`);
    await expect(report.getByRole("button", { name: "Do a round now" })).toBeEnabled();
    if (shots) {
      await dialog.screenshot({ path: `${shots}/setup.png` });
      // What starting fixes without asking means, as the form says it before the switch is touched.
      await duty.getByRole("note").scrollIntoViewIfNeeded();
      await dialog.screenshot({ path: `${shots}/duty.png` });
    }

    // A finished round with findings.
    run("seedWatchdog.ts", "add", tag);
    await owner.getByRole("button", { name: "Done" }).click();
    const again = await openWatchdog(owner);
    const mine = again.getByRole("region", { name: "Watchdog report" });
    // The finding of the target without a room and that part's summary: for who runs the office.
    await expect(mine).toContainText("It is errored and PM2 has stopped restarting it.");
    await expect(mine).toContainText("worker is down.");
    if (shots) {
      await mine.screenshot({ path: `${shots}/report.png` });
      await mine.getByRole("list", { name: "Rounds" }).scrollIntoViewIfNeeded();
      await again.screenshot({ path: `${shots}/report-rounds.png` });
    }
    await owner.getByRole("button", { name: "Done" }).click();

    // The member: the report within what they may see, and nothing of the setup.
    const theirs = await openWatchdog(member);
    const seen = theirs.getByRole("region", { name: "Watchdog report" });
    await expect(seen).toContainText("is off duty");
    await expect(seen).not.toContainText("worker is down");
    await expect(seen).not.toContainText("PM2 has stopped restarting it");
    await expect(seen.getByRole("button", { name: "Do a round now" })).toHaveCount(0);
    await expect(theirs.getByRole("region", { name: "Watchdog hosts" })).toHaveCount(0);
    if (shots) await seen.screenshot({ path: `${shots}/report-member.png` });
    expect((await member.request.get("/api/watchdog/settings")).status()).toBe(403);
    await member.getByRole("button", { name: "Done" }).click();
  } finally {
    if (viewports[0]) await owner.setViewportSize(viewports[0]);
    if (viewports[1]) await member.setViewportSize(viewports[1]);
    owner.off("response", listen);
    run("seedWatchdog.ts", "remove", tag);
    if (hostId) await owner.request.delete(`/api/watchdog/hosts/${hostId}`, { headers });
    await owner.request.put("/api/watchdog/sentry-projects", { headers, data: { projects: [] } });
    await owner.request.patch("/api/watchdog/settings", {
      headers,
      data: { agentId: null, enabled: false, sentryToken: null, sentryOrganization: "" },
    });
    await owner.request.delete(`/api/office-agents/${agent.id}`, { headers });
    run("seedOfficeKey.ts", "remove", profileId);
  }
}
