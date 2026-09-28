/**
 * /join/:token (SPEC §4.2 Auth, §5 `invites`): show what the invite grants
 * and until when, then register through `POST /api/join/:token`, which signs
 * the browser in with the invite's role. Expired, used or unknown tokens get
 * a clear message instead of the form.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useSessionStore } from "../../state/session.ts";
import { AuthCard, FormAlert } from "../auth/AuthCard.tsx";
import { describeAuthError, describeInviteRejection, type InviteInfo } from "../auth/api.ts";
import { useAuthDeps, useCompleteSignIn, useSignOut } from "../auth/context.tsx";
import { formatExpiry, roleLabel } from "../auth/format.ts";
import { RegisterForm } from "../auth/forms.tsx";
import { Button, buttonClassName } from "../components/Button.tsx";
import { ROUTE_PATHS } from "../routes.ts";

type InviteState =
  | { kind: "loading" }
  | { kind: "ready"; invite: InviteInfo }
  | { kind: "invalid"; message: string };

export function JoinPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { api, fetch: fetchFn } = useAuthDeps();
  const complete = useCompleteSignIn();
  const signOut = useSignOut();
  const user = useSessionStore((s) => (s.status === "authenticated" ? s.user : null));
  const [state, setState] = useState<InviteState>({ kind: "loading" });

  useEffect(() => {
    if (useSessionStore.getState().status === "unknown")
      void useSessionStore.getState().fetchSession(fetchFn);
  }, [fetchFn]);

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    void api.getInvite(token).then((r) => {
      if (!live) return;
      if (r.ok) setState({ kind: "ready", invite: r.data });
      else
        setState({
          kind: "invalid",
          message:
            r.code === "invite_invalid" ? describeInviteRejection(r.reason) : describeAuthError(r),
        });
    });
    return () => {
      live = false;
    };
  }, [api, token]);

  if (state.kind === "loading")
    return <AuthCard title="You're invited">Checking the invite…</AuthCard>;
  if (state.kind === "invalid")
    return (
      <AuthCard title="Invite not usable">
        <FormAlert>{state.message}</FormAlert>
        <Link
          to={ROUTE_PATHS.login}
          className={buttonClassName({ variant: "secondary", block: true })}
        >
          Go to sign-in
        </Link>
      </AuthCard>
    );

  const { invite } = state;
  if (user)
    return (
      <AuthCard title="You're invited">
        <FormAlert kind="info">
          You are signed in as <strong>{user.displayName}</strong>. This invite creates a new
          account; sign out first to use it.
        </FormAlert>
        <div className="rg-modal__footer">
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
          <Link to={ROUTE_PATHS.office} className={buttonClassName({ variant: "primary" })}>
            Go to the office
          </Link>
        </div>
      </AuthCard>
    );

  return (
    <AuthCard title="You're invited">
      <p className="rg-auth__lead">
        Join this office as <strong>{roleLabel(invite.role)}</strong>. The link works once and is
        valid until {formatExpiry(invite.expiresAt)}.
      </p>
      <RegisterForm
        submit={(f) => api.join(token, f)}
        onSuccess={complete}
        submitLabel="Create account and join"
      />
      <p className="rg-auth__alt">
        Already have an account? <Link to={ROUTE_PATHS.login}>Sign in</Link>
      </p>
    </AuthCard>
  );
}
