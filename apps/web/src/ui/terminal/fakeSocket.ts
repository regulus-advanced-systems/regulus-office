/** A scripted WebSocket for the terminal and screen feed tests. Only imported by tests. */
import type { SocketLike } from "./connection.ts";

export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  binaryType = "blob";
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly sent: (string | Uint8Array)[] = [];
  closedWith: number | undefined;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  static factory = (url: string) => new FakeSocket(url);
  static last(): FakeSocket {
    const s = FakeSocket.all.at(-1);
    if (!s) throw new Error("no socket");
    return s;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  text(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  bytes(text: string): void {
    this.onmessage?.({ data: new TextEncoder().encode(text).buffer });
  }
  /** Server-side close (or a refused upgrade when never opened). */
  drop(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  send(data: string | ArrayBufferView | ArrayBuffer): void {
    this.sent.push(typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer));
  }
  close(code?: number): void {
    this.readyState = 3;
    this.closedWith = code;
  }
}
