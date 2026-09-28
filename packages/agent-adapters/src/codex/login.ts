/**
 * ChatGPT device-code login through the app-server (SPEC §8 rule 1).
 *
 * A short-lived `codex app-server` runs in the human's runner (same HOME and
 * CODEX_HOME as their agents) and is asked for `account/login/start
 * { type: "chatgptDeviceCode" }`. The office shows `{ verificationUrl,
 * userCode }`; the human approves on their own device; Codex itself polls,
 * receives the tokens and writes them into CODEX_HOME. The office only sees
 * `account/login/completed { success, error }`: it never reads, stores or
 * forwards a ChatGPT token.
 *
 * Docs: https://learn.chatgpt.com/docs/app-server ("3b) Log in with ChatGPT
 * (device-code flow)", "4) Cancel a ChatGPT login").
 */
import type { DeviceCodeLogin, LoginOutcome, RunnerContext, SpawnPlan } from "../types.ts";
import { clip } from "./items.ts";
import { CodexRpcClient } from "./rpc.ts";

/** Upper bound for a pending login; device codes expire server-side well before this. */
export const DEFAULT_LOGIN_TIMEOUT_MS = 30 * 60_000;

export interface DeviceLoginOptions {
  timeoutMs?: number;
  requestTimeoutMs?: number;
}

export async function beginDeviceLogin(
  plan: SpawnPlan,
  ctx: RunnerContext,
  opts: DeviceLoginOptions = {},
): Promise<DeviceCodeLogin> {
  let loginId: string | undefined;
  let settle: (outcome: LoginOutcome) => void = () => {};
  const completion = new Promise<LoginOutcome>((resolve) => {
    settle = resolve;
  });
  let done = false;
  const finish = (outcome: LoginOutcome) => {
    if (done) return;
    done = true;
    settle(outcome);
  };

  const proc = await ctx.runner.spawnPiped(plan);
  const client = new CodexRpcClient(proc, {
    requestTimeoutMs: opts.requestTimeoutMs,
    onNotification: (n) => {
      if (n.method !== "account/login/completed") return;
      if (loginId !== undefined && n.params.loginId !== null && n.params.loginId !== loginId)
        return;
      finish(
        n.params.success
          ? { ok: true }
          : { ok: false, reason: clip(n.params.error ?? "login failed", 500) },
      );
      void client.close();
    },
    onExit: () => finish({ ok: false, reason: "codex app-server exited before login completed" }),
  });

  try {
    await client.initialize();
    const res = await client.request("account/login/start", { type: "chatgptDeviceCode" });
    if (res.type !== "chatgptDeviceCode") {
      throw new Error(`unexpected login response type: ${res.type}`);
    }
    const id = res.loginId;
    loginId = id;
    const timer = setTimeout(
      () => void cancel("device code login timed out"),
      opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS,
    );
    void completion.then(() => clearTimeout(timer));

    async function cancel(why = "cancelled"): Promise<void> {
      if (done) return;
      finish({ ok: false, reason: why });
      try {
        await client.request("account/login/cancel", { loginId: id }, 5_000);
      } catch {
        // already finished or exited
      }
      await client.close();
    }

    return {
      verificationUrl: res.verificationUrl,
      userCode: res.userCode,
      completion,
      cancel: () => cancel(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
