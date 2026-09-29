/**
 * A fake GitHub REST API for the agents e2e (OFFICE_GITHUB_API_BASE points here). It records
 * every request and answers the two calls the one-click PR makes (apps/server/src/github/pulls.ts):
 * `POST /repos/{o}/{r}/pulls` creates PR #1, #2, … and `GET /repos/{o}/{r}/pulls` lists them.
 * Listens on 127.0.0.1 only; nothing here talks to the real GitHub.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface FakeGitHub {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

const PULLS = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/;

export async function startFakeGitHub(): Promise<FakeGitHub> {
  const requests: RecordedRequest[] = [];
  const pulls: { number: number; html_url: string; draft: boolean; head: string }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://fake-github");
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      requests.push({ method: req.method ?? "", path: url.pathname, headers: req.headers, body });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const m = PULLS.exec(url.pathname);
      if (!m) return send(404, { message: "Not Found" });
      const [, owner, repo] = m;
      if (req.method === "GET") return send(200, pulls);
      if (req.method !== "POST") return send(405, { message: "Method Not Allowed" });
      const input = body as { head?: string; draft?: boolean };
      const number = pulls.length + 1;
      const pull = {
        number,
        html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
        draft: input.draft === true,
        head: input.head ?? "",
      };
      pulls.push(pull);
      return send(201, pull);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
