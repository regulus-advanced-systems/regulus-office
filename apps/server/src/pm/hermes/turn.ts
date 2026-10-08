/**
 * One office message as one Hermes turn (#58): find or create the
 * conversation's session, run the turn, and turn what Hermes streams back
 * into engine events. Every way it can end is told to the person.
 *
 * A message is offered again only while Hermes has provably not taken it
 * (no connection, a refusal before the stream, "too many turns"). Once the
 * stream started, Hermes has the message in its transcript and may have
 * acted on it, so a broken stream is never answered by sending it again:
 * the office asks Hermes what became of the run, and otherwise says so.
 */
import type { EngineEvent, EngineMessage } from "../engines/types.ts";
import { type HermesClient, HermesError, type HermesStreamEvent } from "./client.ts";
import type { SessionState } from "./session-state.ts";

export interface TurnHost {
  agentId: string;
  client: Pick<HermesClient, "createSession" | "chat" | "runStatus">;
  state: SessionState;
  /** Aborted when the agent is stopped. */
  signal: AbortSignal;
  /** How often a message Hermes has not taken is offered. */
  attempts: number;
  pauseMs(attempt: number): number;
  systemMessage(message: EngineMessage): string;
  sessionTitle: string;
  emit(event: EngineEvent): void;
  saveState(): void;
  /** What the last contact showed about the gateway. */
  reachable(ok: boolean, detail: string): void;
  /** What a finished turn used, when Hermes reported it. */
  usage?(usage: HermesTurnUsage, runId: string): void;
}

/** Token counts of one turn, as Hermes reports them with `run.completed`. */
export interface HermesTurnUsage {
  inputTokens: number;
  outputTokens: number;
}

function reportUsage(host: TurnHost, runId: string, raw: unknown): void {
  if (!host.usage || raw === null || typeof raw !== "object") return;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  const { input_tokens, output_tokens } = raw as Record<string, unknown>;
  const usage = { inputTokens: count(input_tokens), outputTokens: count(output_tokens) };
  if (runId && usage.inputTokens + usage.outputTokens > 0) host.usage(usage, runId);
}

const REPLY_MAX = 60_000;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const str = (value: unknown) => (typeof value === "string" ? value : "");

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** What one stream told us. */
interface Outcome {
  text: string;
  deltas: string;
  runId: string;
  sessionId: string;
  terminal: "" | "completed" | "failed" | "cancelled" | "queued";
  error: string;
  reason: string;
}

function collect(outcome: Outcome, host: TurnHost, { event, data }: HermesStreamEvent): void {
  if (!outcome.runId) outcome.runId = str(data.run_id);
  switch (event) {
    case "assistant.delta":
      outcome.deltas += str(data.delta);
      return;
    case "assistant.completed":
      outcome.text = str(data.content);
      outcome.sessionId = str(data.session_id) || outcome.sessionId;
      return;
    case "tool.started": {
      const tool = clip(str(data.tool_name), 60);
      if (tool) {
        host.emit({
          type: "status",
          agentId: host.agentId,
          status: "busy",
          reason: `Using ${tool}`,
        });
      }
      return;
    }
    case "run.completed":
    case "run.failed":
    case "run.cancelled":
      outcome.terminal = event.slice(4) as Outcome["terminal"];
      outcome.sessionId = str(data.session_id) || outcome.sessionId;
      outcome.reason = clip(str(data.turn_exit_reason), 120);
      reportUsage(host, outcome.runId, data.usage);
      return;
    case "run.queued":
      outcome.terminal = "queued";
      return;
    case "error":
      outcome.error = clip(str(data.message), 300) || "Hermes reported an error";
      return;
    // run.started, message.started, assistant.commentary, tool.completed, tool.failed,
    // tool.progress and anything a later Hermes adds: nothing the office shows yet.
  }
}

export async function runTurn(host: TurnHost, message: EngineMessage): Promise<void> {
  const { agentId, state } = host;
  const userId = message.userId;
  const fail = (text: string) => host.emit({ type: "error", agentId, userId, message: text });
  const say = (text: string) =>
    host.emit({ type: "message", agentId, userId, text: clip(text, REPLY_MAX) });
  host.emit({ type: "status", agentId, status: "busy" });

  const outcome: Outcome = {
    text: "",
    deltas: "",
    runId: "",
    sessionId: "",
    terminal: "",
    error: "",
    reason: "",
  };
  let recreated = false;
  for (let attempt = 1; ; attempt++) {
    if (host.signal.aborted) return fail("Not delivered: the agent was stopped first.");
    let streaming = false;
    try {
      let sessionId = state.sessions[userId] ?? state.continues;
      if (!sessionId) sessionId = await host.client.createSession(host.sessionTitle, host.signal);
      if (state.sessions[userId] !== sessionId) {
        state.sessions[userId] = sessionId;
        host.saveState();
      }
      await host.client.chat(
        sessionId,
        { message: message.text, system_message: host.systemMessage(message) },
        (event) => {
          if (!streaming) host.reachable(true, "connected");
          streaming = true;
          collect(outcome, host, event);
        },
        host.signal,
      );
      break;
    } catch (err) {
      if (host.signal.aborted) {
        return fail(
          streaming
            ? "The agent was stopped while Hermes was answering; its answer is not shown here."
            : "Not delivered: the agent was stopped first.",
        );
      }
      const kind = err instanceof HermesError ? err.kind : "http";
      const text = err instanceof HermesError ? err.message : "talking to Hermes failed";
      if (streaming || kind === "broken_stream") {
        if (await recover(host, outcome)) break;
        return fail(
          `${sentence(text)} Its answer was lost. Hermes may have your message and may have acted on it: ask it what it did before you send it again.`,
        );
      }
      // From here on Hermes has not taken the message.
      if (kind === "not_found") {
        delete state.sessions[userId];
        host.saveState();
        if (state.continues) {
          return fail(
            "Not delivered: the Hermes session this agent was told to continue is not there any more. Name another one in its connection, or leave it empty.",
          );
        }
        if (recreated)
          return fail("Not delivered: Hermes keeps losing this conversation's session.");
        recreated = true;
        fail(
          "Hermes no longer had the session of this conversation, so a new one was started. It may not remember earlier messages from the office.",
        );
        attempt -= 1;
        continue;
      }
      if (kind === "auth") {
        host.reachable(false, "the Hermes gateway refused the access token");
        return fail(
          "Not delivered: the Hermes gateway refused the access token. Enter the current one in this agent's connection.",
        );
      }
      if (kind === "unreachable" || kind === "busy") {
        if (kind === "unreachable") host.reachable(false, "the Hermes gateway cannot be reached");
        if (attempt < host.attempts) {
          const retryAfter = err instanceof HermesError ? (err.detail.retryAfterMs ?? 0) : 0;
          await sleep(Math.max(host.pauseMs(attempt), retryAfter), host.signal);
          continue;
        }
        return fail(
          kind === "busy"
            ? `Not delivered: Hermes is running too many turns at once (tried ${attempt} times). Send it again in a moment.`
            : `Not delivered: the Hermes gateway cannot be reached (tried ${attempt} times). Your message was not sent; send it again when Hermes is back.`,
        );
      }
      return fail(`Not delivered: ${sentence(text)}`);
    }
  }

  // Hermes may have moved the conversation on to a new session (after compressing it).
  if (outcome.sessionId && state.sessions[userId] !== outcome.sessionId) {
    state.sessions[userId] = outcome.sessionId;
    host.saveState();
  }
  const text = (outcome.text || outcome.deltas).trim();
  if (outcome.terminal === "queued") {
    return fail(
      "Hermes took your message, but this conversation is open in another Hermes window, which will answer it there.",
    );
  }
  if (text) say(text);
  if (outcome.error) return fail(`Hermes reported an error: ${sentence(outcome.error)}`);
  if (outcome.terminal === "failed") {
    return fail(
      `Hermes could not finish this turn${outcome.reason ? ` (${outcome.reason})` : ""}.${text ? " What it wrote so far is above." : ""}`,
    );
  }
  if (outcome.terminal === "cancelled") {
    return fail("Hermes's turn was interrupted before it finished.");
  }
  if (!text) fail("Hermes finished the turn without saying anything.");
}

const sentence = (text: string) => {
  const s = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
};

/**
 * The stream was lost after Hermes took the message. Hermes keeps the result
 * of a run for a while: ask for it, a few times, in case the turn still
 * finished. True when the outcome now holds a finished turn.
 */
async function recover(host: TurnHost, outcome: Outcome): Promise<boolean> {
  if (outcome.terminal) return true;
  if (!outcome.runId) return false;
  for (let attempt = 1; attempt <= host.attempts; attempt++) {
    await sleep(host.pauseMs(attempt), host.signal);
    if (host.signal.aborted) return false;
    try {
      const status = await host.client.runStatus(outcome.runId, host.signal);
      if (!status) return false;
      host.reachable(true, "connected");
      if (status.status === "completed" && status.output) {
        outcome.text = status.output;
        outcome.terminal = "completed";
        outcome.sessionId = status.sessionId ?? outcome.sessionId;
        return true;
      }
      if (status.status === "failed" || status.status === "cancelled") return false;
    } catch {
      // Still away: try again after a longer pause.
    }
  }
  return false;
}
