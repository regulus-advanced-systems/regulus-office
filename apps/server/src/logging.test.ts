import { describe, expect, test } from "bun:test";
import { createLogger, redactPaths, SECRET_FIELDS } from "./logging.ts";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = {
    write(chunk: string) {
      for (const l of chunk.split("\n")) if (l) lines.push(JSON.parse(l));
    },
  };
  return { lines, destination };
}

describe("createLogger", () => {
  test("emits JSON lines with service binding and ISO time", () => {
    const { lines, destination } = capture();
    createLogger({ level: "info", destination }).info({ a: 1 }, "hi");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: "hi", a: 1, service: "office-server", level: 30 });
    expect(typeof lines[0]?.time).toBe("string");
  });

  test("honours the level", () => {
    const { lines, destination } = capture();
    const log = createLogger({ level: "warn", destination });
    log.info("dropped");
    log.warn("kept");
    expect(lines.map((l) => l.msg)).toEqual(["kept"]);
  });

  test("redacts secret fields at top level and nested, and auth headers", () => {
    const { lines, destination } = capture();
    const log = createLogger({ level: "info", destination });
    log.info(
      {
        masterKey: "k",
        OFFICE_MASTER_KEY: "k",
        provider: { apiKey: "sk-1", token: "t" },
        config: { secrets: { password: "p" } },
        req: { headers: { authorization: "Bearer x", cookie: "s=1", accept: "*/*" } },
      },
      "dump",
    );
    const text = JSON.stringify(lines[0]);
    for (const leaked of ['"k"', "sk-1", '"t"', '"p"', "Bearer x", "s=1"]) {
      expect(text).not.toContain(leaked);
    }
    expect(lines[0]).toMatchObject({
      masterKey: "[redacted]",
      provider: { apiKey: "[redacted]", token: "[redacted]" },
      req: { headers: { authorization: "[redacted]", accept: "*/*" } },
    });
  });

  test("redact paths cover every listed secret field", () => {
    const paths = redactPaths();
    for (const f of SECRET_FIELDS) expect(paths).toContain(f);
  });
});
