/**
 * Browser client for a henchman's changes window (#38; shapes in
 * `@regulus/protocol` changes-api.ts). The session cookie is the only
 * credential; every answer is schema-checked before the UI sees it.
 */
import {
  CHANGES_BLOB_MAX_BYTES,
  type ChangesError,
  ChangesSnapshot,
  CommitChangesResponse,
  changesPath,
  DiscardChangeResponse,
  FileDiff,
  type FileSig,
  type ImageSide,
  sniffImageType,
} from "@regulus/protocol";

export interface ChangesFailure {
  ok: false;
  status: number;
  code: ChangesError | "network_error" | "unexpected_response" | `http_${number}`;
  message?: string;
  files?: string[];
}
export type ChangesResult<T> = { ok: true; data: T } | ChangesFailure;

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface ImageBytes {
  bytes: Uint8Array;
  type: string;
}

export function createChangesApi(options: { fetch?: typeof fetch; baseUrl?: string } = {}) {
  const base = options.baseUrl ?? "";
  const doFetch = (path: string, init: RequestInit) =>
    (options.fetch ?? fetch)(`${base}${path}`, { credentials: "same-origin", ...init });

  async function failure(res: Response): Promise<ChangesFailure> {
    let body: Record<string, unknown> = {};
    try {
      const json = (await res.json()) as unknown;
      if (json && typeof json === "object") body = json as Record<string, unknown>;
    } catch {}
    const files = Array.isArray(body.files)
      ? body.files.filter((f): f is string => typeof f === "string")
      : undefined;
    return {
      ok: false,
      status: res.status,
      code: typeof body.error === "string" ? (body.error as ChangesError) : `http_${res.status}`,
      message: typeof body.message === "string" ? body.message : undefined,
      files,
    };
  }

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    schema: Parser<T>,
    body?: unknown,
  ): Promise<ChangesResult<T>> {
    let res: Response;
    try {
      res = await doFetch(path, {
        method,
        headers: { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: "network_error" };
    }
    if (!res.ok) return failure(res);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, status: res.status, code: "unexpected_response" };
    }
    const parsed = schema.safeParse(json);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, status: res.status, code: "unexpected_response" };
  }

  const q = (path: string, params: Record<string, string>) =>
    `${path}?${new URLSearchParams(params).toString()}`;

  return {
    snapshot: (agentId: string) => call("GET", changesPath(agentId), ChangesSnapshot),
    file: (agentId: string, path: string) =>
      call("GET", q(changesPath(agentId, "file"), { path }), FileDiff),
    /** Image bytes, accepted only when their magic number is a raster image. */
    async image(
      agentId: string,
      path: string,
      side: ImageSide,
    ): Promise<ChangesResult<ImageBytes>> {
      let res: Response;
      try {
        res = await doFetch(q(changesPath(agentId, "blob"), { path, side }), { method: "GET" });
      } catch {
        return { ok: false, status: 0, code: "network_error" };
      }
      if (!res.ok) return failure(res);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = sniffImageType(bytes);
      if (!type || bytes.byteLength > CHANGES_BLOB_MAX_BYTES) {
        return { ok: false, status: res.status, code: "not_image" };
      }
      return { ok: true, data: { bytes, type } };
    },
    commit: (agentId: string, message: string, files: FileSig[]) =>
      call("POST", changesPath(agentId, "commit"), CommitChangesResponse, { message, files }),
    discard: (agentId: string, file: FileSig) =>
      call("POST", changesPath(agentId, "discard"), DiscardChangeResponse, file),
  };
}

export type ChangesApi = ReturnType<typeof createChangesApi>;

/** Human wording for a failed call. */
export function describeChangesFailure(f: ChangesFailure): string {
  switch (f.code) {
    case "owner_only":
      return "Only the henchman's owner can commit or discard.";
    case "changed_since_viewed":
      return "The henchman changed these files after you looked. Review them and try again.";
    case "not_changed":
      return "That file has no uncommitted changes any more.";
    case "git_busy":
      return "The henchman's git is busy right now. Try again in a moment.";
    case "unavailable":
      return f.message ?? "The henchman's workspace cannot be reached.";
    case "not_found":
      return "This henchman is not in an operation you can see.";
    case "network_error":
      return "The office could not be reached.";
    case "too_large":
      return "Too large to show.";
    case "not_image":
      return "Not an image the office previews.";
    default:
      return f.message ?? `Something went wrong (${f.code}).`;
  }
}
