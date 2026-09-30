/** Webhook signature checks and the capped body reader (#35). */
import { describe, expect, test } from "bun:test";
import { readCappedBody, signWebhookBody, verifyWebhookSignature } from "./webhook-signature.ts";

// The worked example from GitHub's docs:
// https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries#testing-the-webhook-payload-validation
const DOC_SECRET = "It's a Secret to Everybody";
const DOC_BODY = new TextEncoder().encode("Hello, World!");
const DOC_SIGNATURE = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

describe("verifyWebhookSignature", () => {
  test("accepts GitHub's documented example", () => {
    expect(signWebhookBody(DOC_SECRET, DOC_BODY)).toBe(DOC_SIGNATURE);
    expect(verifyWebhookSignature(DOC_SECRET, DOC_BODY, DOC_SIGNATURE)).toBe(true);
    expect(
      verifyWebhookSignature(
        DOC_SECRET,
        DOC_BODY,
        DOC_SIGNATURE.toUpperCase().replace("SHA256", "sha256"),
      ),
    ).toBe(true);
  });

  test("refuses a wrong secret, a changed body and malformed headers", () => {
    expect(verifyWebhookSignature("another secret", DOC_BODY, DOC_SIGNATURE)).toBe(false);
    expect(
      verifyWebhookSignature(DOC_SECRET, new TextEncoder().encode("Hello, World?"), DOC_SIGNATURE),
    ).toBe(false);
    const hex = DOC_SIGNATURE.slice("sha256=".length);
    for (const header of [
      null,
      "",
      hex,
      `sha1=${hex}`,
      `sha256=${hex.slice(0, 63)}`,
      `sha256=${hex}00`,
      `sha256=${"z".repeat(64)}`,
    ]) {
      expect(verifyWebhookSignature(DOC_SECRET, DOC_BODY, header)).toBe(false);
    }
    expect(verifyWebhookSignature("", DOC_BODY, signWebhookBody("", DOC_BODY))).toBe(false);
  });
});

describe("readCappedBody", () => {
  test("reads a body within the cap", async () => {
    const res = await readCappedBody(new Request("http://x/", { method: "POST", body: "abc" }), 10);
    expect(res.ok && new TextDecoder().decode(res.bytes)).toBe("abc");
  });

  test("refuses a declared length over the cap without reading", async () => {
    let pulled = false;
    const body = new ReadableStream(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const req = new Request("http://x/", {
      method: "POST",
      body,
      headers: { "content-length": "999999" },
    });
    expect(await readCappedBody(req, 1000)).toEqual({ ok: false, reason: "too_large" });
    expect(pulled).toBe(false);
  });

  test("stops a stream that grows past the cap", async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(new Uint8Array(400));
        if (sent > 100) controller.close();
      },
    });
    const req = new Request("http://x/", { method: "POST", body });
    expect(await readCappedBody(req, 1000)).toEqual({ ok: false, reason: "too_large" });
    expect(sent).toBeLessThan(10);
  });
});
