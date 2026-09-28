/**
 * /login (SPEC §4.2 Auth): email + password sign-in; while the office has no
 * accounts, registration of the first one, who becomes owner. After that,
 * sign-up is invite-only (owner decision on #79): newcomers are pointed at
 * their invite link. GitHub only when the server has it configured.
 * Already signed-in visitors go straight to /office.
 */
import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useSessionStore } from "../../state/session.ts";
import { AuthCard, FormAlert } from "../auth/AuthCard.tsx";
import { type AuthConfig, describeAuthError } from "../auth/api.ts";
import { useAuthDeps, useCompleteSignIn } from "../auth/context.tsx";
import { RegisterForm, SignInForm } from "../auth/forms.tsx";
import { Button } from "../components/Button.tsx";
import { ROUTE_PATHS } from "../routes.ts";

type ConfigState =
  | { kind: "loading" }
  | { kind: "ready"; config: AuthConfig }
  | { kind: "error"; message: string };

export function LoginPage() {
  const { api, fetch: fetchFn } = useAuthDeps();
  const status = useSessionStore((s) => s.status);
  const complete = useCompleteSignIn();
  const [params] = useSearchParams();
  const [config, setConfig] = useState<ConfigState>({ kind: "loading" });
  const [githubError, setGithubError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (useSessionStore.getState().status === "unknown")
      void useSessionStore.getState().fetchSession(fetchFn);
  }, [fetchFn]);

  // `attempt` is a dependency on purpose: bumping it re-runs the load (Try again).
  useEffect(() => {
    let live = true;
    setConfig({ kind: "loading" });
    void api.getConfig().then((r) => {
      if (!live) return;
      setConfig(
        r.ok ? { kind: "ready", config: r.data } : { kind: "error", message: describeAuthError(r) },
      );
    });
    return () => {
      live = false;
    };
  }, [api, attempt]);

  if (status === "authenticated") return <Navigate to={ROUTE_PATHS.office} replace />;

  if (config.kind === "loading") return <AuthCard title="Regulus Office">Loading…</AuthCard>;
  if (config.kind === "error")
    return (
      <AuthCard title="Regulus Office">
        <FormAlert>{config.message}</FormAlert>
        <Button variant="primary" block onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </AuthCard>
    );

  const { hasUsers, githubEnabled } = config.config;
  // Better Auth sends failed OAuth round trips back here with ?error=<code>.
  const oauthError = params.get("error");
  const startGithub = async () => {
    setGithubError(null);
    const r = await api.githubSignIn();
    if (r.ok) window.location.assign(r.data);
    else setGithubError(describeAuthError(r));
  };
  const github = githubEnabled && (
    <>
      <div className="rg-auth__divider">or</div>
      <Button variant="secondary" block onClick={() => void startGithub()}>
        Sign in with GitHub
      </Button>
      {githubError && <FormAlert>{githubError}</FormAlert>}
    </>
  );

  if (!hasUsers)
    return (
      <AuthCard title="Set up your office">
        <p className="rg-auth__lead">
          Nobody has signed up yet. The first account becomes the office <strong>owner</strong> and
          can invite everyone else.
        </p>
        <RegisterForm
          submit={api.signUp}
          onSuccess={complete}
          submitLabel="Create the owner account"
        />
        {github}
      </AuthCard>
    );

  return (
    <AuthCard title="Sign in">
      {oauthError && (
        <FormAlert>
          {describeAuthError({ ok: false, status: 400, code: oauthError.toLowerCase() })}
        </FormAlert>
      )}
      <SignInForm submit={api.signIn} onSuccess={complete} />
      {github}
      <p className="rg-auth__alt rg-muted">New here? Ask an owner or admin for an invite link.</p>
    </AuthCard>
  );
}
