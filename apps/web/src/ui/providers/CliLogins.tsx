/**
 * Subscription logins (SPEC §8 rule 1): Claude Code and Codex sign in with
 * their own CLI inside the human's runner. Codex shows the device code the
 * CLI got (open the link, enter the code); Claude opens the human's login
 * terminal running `claude auth login`. Connected state is the CLI's own
 * answer. Closing the panel cancels a pending login.
 */
import type { CliLoginProvider, LoginFlowInfo, ProviderLoginStatus } from "@regulus/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import type { TerminalDeps } from "../terminal/host.ts";
import { describeProvidersError, type ProvidersApi } from "./api.ts";
import { LoginTerminal } from "./LoginTerminal.tsx";

const LABELS: Record<CliLoginProvider, { name: string; plan: string }> = {
  "claude-code": { name: "Claude Code", plan: "Claude Pro / Max subscription" },
  codex: { name: "Codex", plan: "ChatGPT account" },
};

type Statuses = Partial<Record<CliLoginProvider, ProviderLoginStatus>>;

export interface CliLoginsProps {
  api: ProvidersApi;
  pollMs?: number;
  focus?: string | null;
  terminalDeps?: TerminalDeps;
}

export function CliLogins({ api, pollMs = 2000, focus, terminalDeps }: CliLoginsProps) {
  const [statuses, setStatuses] = useState<Statuses | null>(null);
  const [flows, setFlows] = useState<Partial<Record<CliLoginProvider, LoginFlowInfo>>>({});
  const [error, setError] = useState<string | null>(null);
  /** Why a sign-in could not start, per provider (#151), shown with "Try again". */
  const [startErrors, setStartErrors] = useState<Partial<Record<CliLoginProvider, string>>>({});
  const pending = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const res = await api.loginStatus();
    if (!res.ok) {
      setError(describeProvidersError(res));
      setStatuses({});
      return;
    }
    const next: Statuses = {};
    for (const s of res.data.providers) next[s.provider] = s;
    setStatuses(next);
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Cancel logins still pending when the panel closes (kills the login terminal, stops polling).
  useEffect(() => {
    const open = pending.current;
    return () => {
      for (const id of open) void api.cancelLogin(id);
      open.clear();
    };
  }, [api]);

  const pendingIds = Object.values(flows)
    .filter((f) => f?.state === "pending")
    .map((f) => f?.loginId ?? "")
    .join(",");
  useEffect(() => {
    if (!pendingIds) return;
    const timer = setInterval(() => {
      for (const id of pendingIds.split(",")) {
        void api.flow(id).then((res) => {
          if (!res.ok) return;
          const info = res.data;
          setFlows((f) => ({ ...f, [info.provider]: info }));
          if (info.state !== "pending") {
            pending.current.delete(info.loginId);
            void refresh();
          }
        });
      }
    }, pollMs);
    return () => clearInterval(timer);
  }, [api, pendingIds, pollMs, refresh]);

  const start = async (provider: CliLoginProvider) => {
    setError(null);
    setStartErrors((e) => ({ ...e, [provider]: undefined }));
    const res = await api.startLogin(provider);
    if (!res.ok) {
      setStartErrors((e) => ({ ...e, [provider]: describeProvidersError(res) }));
      return;
    }
    pending.current.add(res.data.loginId);
    setFlows((f) => ({ ...f, [provider]: res.data }));
  };

  const cancel = async (flow: LoginFlowInfo) => {
    pending.current.delete(flow.loginId);
    await api.cancelLogin(flow.loginId);
    setFlows((f) => ({ ...f, [flow.provider]: undefined }));
  };

  return (
    <section className="rg-providers__section" aria-label="Subscription logins">
      <h3 className="rg-providers__heading">Subscriptions</h3>
      <p className="rg-field__hint">
        Signing in happens inside your own runner, with the provider's own CLI. The office shows the
        prompt but never sees or stores the login.
      </p>
      {error && <FormAlert>{error}</FormAlert>}
      {(Object.keys(LABELS) as CliLoginProvider[]).map((provider) => {
        const flow = flows[provider];
        const status = statuses?.[provider];
        return (
          <div
            key={provider}
            className="rg-providers__row"
            data-provider={provider}
            data-focus={focus === provider || undefined}
          >
            <div className="rg-providers__row-head">
              <div>
                <strong>{LABELS[provider].name}</strong>{" "}
                <span className="rg-muted">{LABELS[provider].plan}</span>
              </div>
              <StatusBadge status={status} loading={statuses === null} />
              {flow?.state === "pending" ? (
                <Button size="sm" onClick={() => void cancel(flow)}>
                  Cancel
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => void start(provider)}>
                  {status?.connected ? "Sign in again" : "Connect"}
                </Button>
              )}
            </div>
            {startErrors[provider] ? (
              <StartError message={startErrors[provider]} onRetry={() => void start(provider)} />
            ) : (
              flow && (
                <FlowView
                  flow={flow}
                  terminalDeps={terminalDeps}
                  onRetry={() => void start(provider)}
                />
              )
            )}
          </div>
        );
      })}
    </section>
  );
}

function StatusBadge({ status, loading }: { status?: ProviderLoginStatus; loading: boolean }) {
  if (loading) return <span className="rg-providers__badge">Checking…</span>;
  if (status?.connected === true)
    return (
      <span className="rg-providers__badge" data-kind="ok">
        Connected
      </span>
    );
  if (status?.connected === false)
    return <span className="rg-providers__badge">Not connected</span>;
  return (
    <span className="rg-providers__badge" data-kind="unknown" title="The CLI could not be asked">
      Unknown
    </span>
  );
}

function StartError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rg-providers__failed" data-testid="login-start-error">
      <FormAlert>{message}</FormAlert>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function FlowView({
  flow,
  terminalDeps,
  onRetry,
}: {
  flow: LoginFlowInfo;
  terminalDeps?: TerminalDeps;
  onRetry: () => void;
}) {
  if (flow.state === "succeeded") {
    return (
      <p className="rg-providers__done" role="status">
        Signed in.
      </p>
    );
  }
  if (flow.state !== "pending") {
    return (
      <StartError message={flow.reason ?? "The sign-in did not complete."} onRetry={onRetry} />
    );
  }
  if (flow.kind === "device_code") return <DeviceCode flow={flow} />;
  return (
    <div className="rg-providers__login">
      <p className="rg-field__hint">{flow.instructions}</p>
      {flow.terminalId && (
        <LoginTerminal terminalId={flow.terminalId} provider={flow.provider} deps={terminalDeps} />
      )}
    </div>
  );
}

function DeviceCode({ flow }: { flow: LoginFlowInfo }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(flow.userCode ?? "");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="rg-providers__device" data-testid="device-code">
      <p>
        1. Open{" "}
        <a href={flow.verificationUrl} target="_blank" rel="noopener noreferrer">
          {flow.verificationUrl}
        </a>{" "}
        and sign in to ChatGPT.
      </p>
      <p>
        2. Enter this code: <code className="rg-providers__code">{flow.userCode}</code>{" "}
        <Button size="sm" variant="ghost" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </p>
      <p className="rg-muted" role="status">
        Waiting for you to approve…
      </p>
    </div>
  );
}
