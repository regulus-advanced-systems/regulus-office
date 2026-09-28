import { Link, useParams } from "react-router";
import { Panel } from "../Panel.tsx";
import { ROUTE_PATHS } from "../routes.ts";
import { colors } from "../theme.ts";

/** Invite landing page; redemption is wired up by the auth work (#11). */
export function JoinPage() {
  const { token = "" } = useParams<{ token: string }>();
  const shown = token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : token;
  return (
    <main className="centered">
      <Panel modal style={{ width: 360 }}>
        <h1 style={{ margin: "0 0 8px", color: colors.navy }}>You're invited</h1>
        <p style={{ color: colors.inkMuted }}>
          Invite <code>{shown}</code> will be redeemed once invites are implemented.
        </p>
        <Link to={ROUTE_PATHS.login} style={{ color: colors.blue }}>
          Go to sign-in
        </Link>
      </Panel>
    </main>
  );
}
