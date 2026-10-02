/**
 * Fakes for meeting tests (#50): henchmen that take prompts, write their
 * notes into an in-memory file system and report status like the
 * AgentManager would, a worktree that records what happened to it, and
 * outputs that record PRs and reviews. The office fixture is the AgentManager
 * one (an operation, a cloned repo, users with every kind of access).
 */
import type { AgentStatus, MeetingSummary } from "@regulus/protocol";
import { AgentManagerError } from "../agents/manager/errors.ts";
import type { AgentView } from "../agents/manager/henchman.ts";
import { officeFixture } from "../agents/manager/test-helpers.ts";
import type { Db } from "../db/index.ts";
import { desks } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import type { OperationActor } from "../operations/access.ts";
import { createMeetings } from "./index.ts";
import type {
  MeetingHenchmen,
  MeetingOutputs,
  MeetingWorkspaceInput,
  MeetingWorkspaces,
} from "./ports.ts";

export interface FakeAgent {
  owner: string;
  status: AgentStatus | undefined;
  seat: string | null;
}

export interface PromptCall {
  agentId: string;
  text: string;
  /** The notes file the prompt asks for (absolute). */
  file: string;
}

export type Behaviour = (call: PromptCall, fake: FakeHenchmen) => void | Promise<void>;

/** Works, writes its notes, rests: what a well-behaved henchman does with a turn. */
export const diligent: Behaviour = (call, fake) => {
  setTimeout(() => {
    fake.setStatus(call.agentId, "working");
    fake.files.set(call.file, `notes by ${call.agentId}`);
    fake.setStatus(call.agentId, "idle");
  }, 1);
};

export class FakeHenchmen implements MeetingHenchmen {
  readonly agents = new Map<string, FakeAgent>();
  readonly files = new Map<string, string>();
  readonly prompts: PromptCall[] = [];
  readonly interrupts: string[] = [];
  readonly emergencyStops: string[] = [];
  readonly sentHome: string[] = [];
  behave: Behaviour = diligent;
  /** Status changes go here (the meetings' AgentManager observer). */
  feed: (agentId: string, status: AgentStatus) => void = () => {};
  #seq = 0;

  constructor(private readonly db: Db) {}

  setStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.status = status;
    this.feed(agentId, status);
  }

  #own(starter: OperationActor, agentId: string): FakeAgent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new AgentManagerError("not_found", "no such agent");
    if (agent.owner !== starter.id) {
      throw new AgentManagerError("forbidden", "only the henchman's owner may control it");
    }
    return agent;
  }

  async spawn(
    starter: OperationActor,
    input: Parameters<MeetingHenchmen["spawn"]>[1],
    _workspace: Parameters<MeetingHenchmen["spawn"]>[2],
    onAdmitted: (agentId: string) => void,
  ) {
    this.#seq += 1;
    const agentId = `agent-${this.#seq}`;
    const seat = input.seatId ?? `seat-${this.#seq}`;
    this.agents.set(agentId, { owner: starter.id, status: "starting", seat });
    onAdmitted(agentId);
    setTimeout(() => this.setStatus(agentId, "idle"), 1);
    return { agentId, seatId: seat };
  }

  async prompt(starter: OperationActor, agentId: string, text: string) {
    this.#own(starter, agentId);
    const file = /`([^`]*\.meeting\/turns\/[^`]+)`/.exec(text)?.[1] ?? "";
    const call = { agentId, text, file: `/w/meeting/${file}` };
    this.prompts.push(call);
    await this.behave(call, this);
  }

  async interrupt(starter: OperationActor, agentId: string) {
    this.#own(starter, agentId);
    this.interrupts.push(agentId);
    this.setStatus(agentId, "idle");
  }

  async emergencyStop(_admin: OperationActor, agentId: string) {
    this.emergencyStops.push(agentId);
    this.setStatus(agentId, "exited");
  }

  async sendHome(starter: OperationActor, agentId: string) {
    const agent = this.#own(starter, agentId);
    this.sentHome.push(agentId);
    agent.seat = null;
    agent.status = undefined;
  }

  status = (agentId: string) => this.agents.get(agentId)?.status;
  seatOf = (agentId: string) => this.agents.get(agentId)?.seat ?? null;

  check(_starter: OperationActor, input: { provider: string }) {
    if (input.provider === "gemini-cli") {
      throw new AgentManagerError("bad_request", "gemini-cli is not installed");
    }
  }

  async readFile(_starterId: string, path: string) {
    return this.files.get(path) ?? null;
  }

  lastMessage = () => null;

  freeSeats(operationId: string, count: number) {
    const taken = new Set([...this.agents.values()].map((a) => a.seat));
    return this.db
      .select({ seatId: desks.seatId })
      .from(desks)
      .all()
      .map((r) => r.seatId)
      .filter((s) => !taken.has(s) && operationId !== "")
      .slice(0, count);
  }

  /** Prompts as `agent:kind-ish first word of the instruction` for order checks. */
  promptedAgents(): string[] {
    return this.prompts.map((p) => p.agentId);
  }
}

export class FakeWorkspaces implements MeetingWorkspaces {
  readonly prepared: MeetingWorkspaceInput[] = [];
  readonly released: string[] = [];
  dirty: string[] = [];
  pull: string | null = "origin/feature";

  async prepare(input: MeetingWorkspaceInput) {
    this.prepared.push(input);
    return { workdir: "/w/meeting", branch: `office/${input.slug}` };
  }
  async uncommitted() {
    return this.dirty;
  }
  async release(input: { workdir: string }) {
    this.released.push(input.workdir);
  }
  baseBranch = () => "trunk";
  pullBase = () => this.pull;
}

export class FakeOutputs implements MeetingOutputs {
  readonly pulls: { agentId: string; title: string; body: string; starter: string }[] = [];
  readonly reviews: { repoId: string; prNumber: number; body: string }[] = [];
  failPull: Error | null = null;

  async openPullRequest(
    starter: OperationActor,
    agentId: string,
    options: { title: string; body: string },
  ) {
    if (this.failPull) throw this.failPull;
    this.pulls.push({ agentId, ...options, starter: starter.id });
    return { number: 42, url: "https://github.test/octo/hello/pull/42" };
  }
  async postReview(repoId: string, prNumber: number, body: string) {
    this.reviews.push({ repoId, prNumber, body });
    return { url: `https://github.test/octo/hello/pull/${prNumber}#review-1` };
  }
}

/** An office with five free desks and a meetings module over fakes. */
export async function meetingFixture() {
  const office = await officeFixture();
  for (const seatId of ["seat-4", "seat-5", "seat-6"]) {
    office.db.insert(desks).values({ operationId: office.operationId, seatId }).run();
  }
  const fake = new FakeHenchmen(office.db);
  const workspaces = new FakeWorkspaces();
  const outputs = new FakeOutputs();
  const broadcasts: MeetingSummary[] = [];
  const make = () =>
    createMeetings({
      db: office.db,
      logger: createLogger({ level: "silent" }),
      rooms: {
        broadcast(_operationId, _type, payload) {
          broadcasts.push(payload as MeetingSummary);
          return true;
        },
      },
      henchmen: fake,
      workspaces,
      outputs,
      pollMs: 15,
      readyTimeoutMs: 2000,
    });
  const meetings = make();
  const attach = (m: ReturnType<typeof make>) => {
    fake.feed = (agentId, status) =>
      m.observer.statusChanged({ agentId, status } as AgentView, "idle");
  };
  attach(meetings);
  return { ...office, fake, workspaces, outputs, broadcasts, meetings, make, attach };
}

export async function waitFor<T>(
  probe: () => T | undefined | null | false,
  what: string,
  ms = 5000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

export const startInput = (
  operationId: string,
  repoId: string,
  extra: Record<string, unknown> = {},
) => ({
  operationId,
  repoId,
  pattern: "debate" as const,
  topic: "Pick a cache for the board sync",
  members: [
    { provider: "custom" as const, model: "fake-1" },
    { provider: "custom" as const, model: "fake-2" },
    { provider: "custom" as const, model: "fake-3" },
  ],
  rounds: 2,
  tokenBudget: 100_000,
  turnTimeoutMinutes: 1,
  output: "pull_request" as const,
  ...extra,
});
