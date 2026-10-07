/**
 * Settings → Agents: connecting a person's own, already running Hermes (#58).
 *
 * - `HermesFields`: the address and the access token (and, under "More", an
 *   existing Hermes session to continue), with "Test connection" and what to
 *   set up on the Hermes side. Used in the new-agent form.
 * - `HermesConnectionSection`: on the agent's card, for its owner: try the
 *   stored connection, or replace it.
 *
 * The office never sends a stored address or token back, so the fields of an
 * existing agent are always empty: entering new values replaces the old ones.
 */
import {
  HERMES_LIMITS,
  type HermesConnectionInput,
  type HermesConnectionTestResult,
  hermesUrlProblem,
  type OfficeAgentView,
} from "@regulus/protocol";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { Button } from "../components/Button.tsx";
import { describeOfficeAgentsError, type OfficeAgentsApi } from "./api.ts";

export interface HermesFieldRefs {
  url: RefObject<HTMLInputElement | null>;
  token: RefObject<HTMLInputElement | null>;
  session: RefObject<HTMLInputElement | null>;
}

export function useHermesFieldRefs(): HermesFieldRefs {
  return {
    url: useRef<HTMLInputElement>(null),
    token: useRef<HTMLInputElement>(null),
    session: useRef<HTMLInputElement>(null),
  };
}

/** What the person typed, or the first thing wrong with it (and the field to go to). */
export function readHermesFields(
  refs: HermesFieldRefs,
): { ok: true; value: HermesConnectionInput } | { ok: false; problem: string; focus(): void } {
  const url = refs.url.current?.value.trim() ?? "";
  const token = refs.token.current?.value.trim() ?? "";
  const sessionId = refs.session.current?.value.trim() ?? "";
  const at = (ref: RefObject<HTMLInputElement | null>) => () => ref.current?.focus();
  if (!url) return { ok: false, problem: "Enter the address of your Hermes.", focus: at(refs.url) };
  const problem = hermesUrlProblem(url);
  if (problem) return { ok: false, problem, focus: at(refs.url) };
  if (token.length < HERMES_LIMITS.tokenMin || /\s/.test(token)) {
    return {
      ok: false,
      problem: "Enter the access token of your Hermes (its API_SERVER_KEY), without spaces.",
      focus: at(refs.token),
    };
  }
  if (sessionId && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(sessionId)) {
    return {
      ok: false,
      problem: "A Hermes session id has only letters, digits and . _ : -",
      focus: at(refs.session),
    };
  }
  return { ok: true, value: { url, token, ...(sessionId ? { sessionId } : {}) } };
}

/** Where this office's tools are, as a Hermes elsewhere reaches them. */
function officeMcpUrl(): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${/^https?:/.test(origin) ? origin : "https://your-office"}/mcp`;
}

function TestResult({ result }: { result: HermesConnectionTestResult | string | null }) {
  if (result === null) return null;
  const ok = typeof result !== "string" && result.ok;
  return (
    <div
      className={`rg-field__hint rg-office-agent-hermes__result ${ok ? "is-ok" : "is-bad"}`}
      role="status"
    >
      {typeof result === "string" ? result : result.detail}
    </div>
  );
}

export function HermesFields({
  api,
  refs,
  problem,
}: {
  api: OfficeAgentsApi;
  refs: HermesFieldRefs;
  /** What the form found wrong on submit; a new object each time, so it shows again. */
  problem?: { text: string } | null;
}) {
  const ids = { url: useId(), token: useId(), session: useId() };
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<HermesConnectionTestResult | string | null>(null);
  // Whatever happened last is what is shown: the form's complaint or a test's outcome.
  useEffect(() => {
    if (problem) setResult(problem.text);
  }, [problem]);

  const test = async () => {
    const read = readHermesFields(refs);
    if (!read.ok) {
      setResult(read.problem);
      return read.focus();
    }
    setTesting(true);
    setResult(null);
    const res = await api.testHermes({ url: read.value.url, token: read.value.token });
    setTesting(false);
    setResult(res.ok ? res.data : describeOfficeAgentsError(res));
  };

  return (
    <div className="rg-office-agent-hermes">
      <label className="rg-field__label" htmlFor={ids.url}>
        Address of your Hermes
      </label>
      <input
        id={ids.url}
        className="rg-input"
        ref={refs.url}
        maxLength={HERMES_LIMITS.urlMax}
        placeholder="http://my-server:8642"
        autoComplete="off"
        spellCheck={false}
      />
      <div className="rg-field__hint">
        Where the API server of your Hermes gateway answers, as seen from the office's server (not
        from your browser). Port 8642 unless you changed it.
      </div>
      <label className="rg-field__label" htmlFor={ids.token}>
        Access token
      </label>
      <input
        id={ids.token}
        className="rg-input"
        ref={refs.token}
        type="password"
        maxLength={HERMES_LIMITS.tokenMax}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="rg-field__hint">
        The API_SERVER_KEY of your Hermes. The office keeps it encrypted, uses it only for this
        agent, and never shows it again: not to you, not to admins, not to other agents.
      </div>
      <div className="rg-office-agent__actions">
        <Button size="sm" disabled={testing} onClick={() => void test()}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
      </div>
      <TestResult result={result} />
      <details>
        <summary className="rg-field__label">More: continue an existing Hermes session</summary>
        <label className="rg-field__label" htmlFor={ids.session}>
          Hermes session to continue (optional)
        </label>
        <input
          id={ids.session}
          className="rg-input"
          ref={refs.session}
          maxLength={HERMES_LIMITS.sessionIdMax}
          placeholder="leave empty for a session of the office's own"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="rg-field__hint">
          Left empty, the office gets its own conversation with your Hermes; what it remembers about
          you (its memory) is shared with Telegram either way. To write into one existing
          conversation instead, enter its id from <code>hermes sessions list</code>. Experimental:
          answers to office messages appear only in the office, and the id changes when you start a
          new conversation in Hermes.
        </div>
      </details>
      <HermesSetupHelp />
    </div>
  );
}

/** What to set up on the Hermes side, shown right where the connection is entered. */
export function HermesSetupHelp() {
  return (
    <details className="rg-office-agent-hermes__help">
      <summary className="rg-field__label">What to set up in Hermes</summary>
      <ol className="rg-field__hint">
        <li>
          Turn on its API server. In <code>~/.hermes/.env</code> set{" "}
          <code>API_SERVER_ENABLED=true</code> and <code>API_SERVER_KEY</code> to a long random
          secret (for example from <code>openssl rand -hex 32</code>), then restart{" "}
          <code>hermes gateway</code>. Telegram and your other channels keep working.
        </li>
        <li>
          Make it reachable from the office's server. By default Hermes answers only on its own
          machine (<code>127.0.0.1:8642</code>). If the office runs elsewhere, or in a container,
          set <code>API_SERVER_HOST</code> and protect the port, or put it on a private network or
          behind HTTPS. The key lets its holder run commands through your Hermes: do not expose it
          to the internet unprotected.
        </li>
        <li>Enter that address and key above, and press Test connection.</li>
        <li>
          To let your Hermes use the office (read boards and queues, add tasks, ask you a question),
          create the agent, make an access code on its card under "Access codes for a program
          outside the office", and add this to <code>~/.hermes/config.yaml</code>:
          <pre className="rg-office-agent-hermes__code">
            {`mcp_servers:\n  office:\n    url: "${officeMcpUrl()}"\n    headers:\n      Authorization: "Bearer <the access code>"`}
          </pre>
          Then run <code>/reload-mcp</code> in Hermes or restart its gateway. With the code your
          Hermes acts in the office with your rights and nothing more, from Telegram too.
        </li>
      </ol>
    </details>
  );
}

/** On the card of a `hermes-external` agent, for its owner. */
export function HermesConnectionSection({
  api,
  agent,
  busy,
  onReplace,
}: {
  api: OfficeAgentsApi;
  agent: OfficeAgentView;
  busy: boolean;
  /** Resolves true when the new connection was stored. */
  onReplace: (input: HermesConnectionInput) => Promise<boolean>;
}) {
  const refs = useHermesFieldRefs();
  const [replacing, setReplacing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [problem, setProblem] = useState<{ text: string } | null>(null);
  const [result, setResult] = useState<HermesConnectionTestResult | string | null>(null);
  const stored = agent.config?.hermes;

  const test = async () => {
    setTesting(true);
    setResult(null);
    const res = await api.testHermes({ agentId: agent.id });
    setTesting(false);
    setResult(res.ok ? res.data : describeOfficeAgentsError(res));
  };
  const save = async () => {
    const read = readHermesFields(refs);
    if (!read.ok) {
      setProblem({ text: read.problem });
      return read.focus();
    }
    setProblem(null);
    if (await onReplace(read.value)) {
      setReplacing(false);
      setResult(null);
    }
  };

  return (
    <section className="rg-office-agent-hermes" aria-label={`Hermes connection of ${agent.name}`}>
      <div className="rg-field__label">Connection to your Hermes</div>
      <div className="rg-field__hint">
        {stored?.connected
          ? `Stored${stored.continuesSession ? ", continuing a Hermes session you named" : ""}. The address and the token are kept encrypted and are not shown again.`
          : "Not connected yet: enter the address and the access token of your Hermes."}
      </div>
      <div className="rg-office-agent__actions">
        {stored?.connected && (
          <Button size="sm" disabled={testing || busy} onClick={() => void test()}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
        )}
        {!replacing && (
          <Button size="sm" disabled={busy} onClick={() => setReplacing(true)}>
            {stored?.connected ? "Replace connection…" : "Connect…"}
          </Button>
        )}
      </div>
      {!replacing && <TestResult result={result} />}
      {replacing ? (
        <>
          <HermesFields api={api} refs={refs} problem={problem} />
          <div className="rg-office-agent__actions">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void save()}>
              Save connection
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReplacing(false)}>
              Cancel
            </Button>
          </div>
          <div className="rg-field__hint">
            Saving stops the agent; your next message connects it again.
          </div>
        </>
      ) : (
        <HermesSetupHelp />
      )}
    </section>
  );
}
