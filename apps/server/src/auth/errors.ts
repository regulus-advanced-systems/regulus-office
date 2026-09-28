/** HTTP-shaped errors raised by the auth layer and turned into JSON responses by the routes. */
import { json } from "../http/router.ts";

export class AuthHttpError extends Error {
  override name = "AuthHttpError";
  readonly status: number;
  readonly code: string;
  readonly detail: Record<string, unknown>;

  constructor(status: number, code: string, detail: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  toResponse(): Response {
    return json({ error: this.code, ...this.detail }, { status: this.status });
  }
}

export const unauthorized = () => new AuthHttpError(401, "unauthorized");
export const forbidden = (code = "forbidden") => new AuthHttpError(403, code);
