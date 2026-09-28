import { Link } from "react-router";
import { Panel } from "../Panel.tsx";
import { ROUTE_PATHS } from "../routes.ts";
import { colors, gradients, radii } from "../theme.ts";

/** Placeholder until Better Auth lands (issue #11). Never handles provider tokens. */
export function LoginPage() {
  return (
    <main className="centered">
      <Panel modal style={{ width: 360 }}>
        <h1 style={{ margin: "0 0 8px", color: colors.navy }}>Regulus Office</h1>
        <p style={{ color: colors.inkMuted, marginTop: 0 }}>
          Sign-in arrives with the auth work (#11). For now the office is open.
        </p>
        <Link
          to={ROUTE_PATHS.office}
          style={{
            display: "block",
            textAlign: "center",
            padding: "10px 16px",
            borderRadius: radii.button,
            background: gradients.primary,
            color: "#fff",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Enter the office
        </Link>
      </Panel>
    </main>
  );
}
