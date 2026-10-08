/**
 * The fake GitHub as a process of its own (`bun tests/e2e/fakeGitHubServer.ts`), started by
 * Playwright beside the office for the whole office e2e run (playwright.config.ts): the office
 * asks it who its people are whenever they sign in, link, or a room is created (#270).
 *
 * Also `bun run dev:github` for local development: a GitHub to link accounts on without a real
 * OAuth client. It only exists while you run it, and the office only talks to it when its
 * environment points there (README, "Development without GitHub").
 */
import { startFakeGitHub } from "./fakeGitHub.ts";

const port = Number(process.env.E2E_GITHUB_PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("E2E_GITHUB_PORT is not set");
const gh = await startFakeGitHub(undefined, { port });
console.log(`fake GitHub for the e2e on ${gh.url}`);
