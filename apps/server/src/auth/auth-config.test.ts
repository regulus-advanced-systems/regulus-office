import { afterEach, describe, expect, test } from "bun:test";
import { AUTH_CONFIG_PATH } from "./routes.ts";
import { type Office, startOffice } from "./test-helpers.ts";

let office: Office | undefined;
afterEach(async () => {
  await office?.stop();
  office = undefined;
});

const config = async (o: Office) => {
  const res = await o.request(AUTH_CONFIG_PATH);
  expect(res.status).toBe(200);
  return res.json();
};

describe("GET /api/auth-config", () => {
  test("reports an empty office until the owner registers, without a session", async () => {
    office = startOffice({ openSignup: false });
    expect(await config(office)).toEqual({
      hasUsers: false,
      githubEnabled: false,
      openSignup: false,
    });
    await office.signUp("Ante");
    expect(await config(office)).toMatchObject({ hasUsers: true });
  });

  test("reflects OFFICE_OPEN_SIGNUP", async () => {
    office = startOffice({ openSignup: true });
    expect(await config(office)).toMatchObject({ openSignup: true });
  });

  test("does not shadow Better Auth's own endpoints", async () => {
    office = startOffice();
    const res = await office.request("/api/auth/get-session");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});
