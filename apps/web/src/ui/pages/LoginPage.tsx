import { Link } from "react-router";
import { buttonClassName } from "../components/Button.tsx";
import { ROUTE_PATHS } from "../routes.ts";

/** Placeholder until Better Auth lands (issue #11). Never handles provider tokens. */
export function LoginPage() {
  return (
    <main className="centered">
      <section className="rg-modal" aria-labelledby="login-title" style={{ width: 380 }}>
        <h1 id="login-title" className="rg-modal__title">
          Regulus Office
        </h1>
        <p className="rg-muted" style={{ marginTop: 0 }}>
          Sign-in arrives with the auth work (#11). For now the office is open.
        </p>
        <Link
          to={ROUTE_PATHS.office}
          className={buttonClassName({ variant: "primary", block: true })}
        >
          Enter the office
        </Link>
      </section>
    </main>
  );
}
