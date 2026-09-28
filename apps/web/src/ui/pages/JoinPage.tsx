import { Link, useParams } from "react-router";
import { ROUTE_PATHS } from "../routes.ts";
import { colors } from "../theme.ts";

/** Invite landing page; redemption is wired up by the auth work (#11). */
export function JoinPage() {
  const { token = "" } = useParams<{ token: string }>();
  const shown = token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : token;
  return (
    <main className="centered">
      <section className="rg-modal" aria-labelledby="join-title" style={{ width: 380 }}>
        <h1 id="join-title" className="rg-modal__title">
          You're invited
        </h1>
        <p className="rg-muted">
          Invite <code>{shown}</code> will be redeemed once invites are implemented.
        </p>
        <Link to={ROUTE_PATHS.login} style={{ color: colors.blue }}>
          Go to sign-in
        </Link>
      </section>
    </main>
  );
}
