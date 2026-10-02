/**
 * LiveKit access tokens (#48): an HS256 JWT signed with the office's
 * LiveKit API secret, in the claim layout livekit-server reads (`iss` the
 * API key, `sub` the identity, `video` the grants; see
 * https://docs.livekit.io/home/get-started/authentication/). Minted here
 * rather than with livekit-server-sdk: twenty lines of HMAC instead of a
 * protobuf runtime in the office image, and every claim visible in one place.
 *
 * Only ever minted for one room and one identity, with the grants the
 * human's role allows (protocol media.ts), and short-lived. The token and
 * the secret are never logged.
 */
import { createHmac } from "node:crypto";
import type { MediaGrants } from "@regulus/protocol";

export interface AccessTokenInput {
  apiKey: string;
  apiSecret: string;
  /** Unique per connection: the building room session id. */
  identity: string;
  /** Shown to other participants (the human's display name). */
  name: string;
  room: string;
  grants: MediaGrants;
  ttlSeconds: number;
  /** Unix ms. */
  now: number;
}

/** What livekit-server reads from the token (`VideoGrant` in livekit/protocol auth). */
export interface LiveKitClaims {
  iss: string;
  sub: string;
  name: string;
  nbf: number;
  exp: number;
  jti: string;
  video: {
    room: string;
    roomJoin: true;
    canSubscribe: boolean;
    canPublish: boolean;
    canPublishSources: string[];
    canPublishData: boolean;
    canUpdateOwnMetadata: boolean;
  };
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** Small clock skew allowance for `nbf` between the office and LiveKit. */
const NOT_BEFORE_SKEW_S = 10;

export function mintAccessToken(input: AccessTokenInput): { token: string; expiresAt: number } {
  if (!input.apiKey || !input.apiSecret) throw new Error("LiveKit API key and secret are required");
  if (!input.identity) throw new Error("identity is required");
  const nowS = Math.floor(input.now / 1000);
  const exp = nowS + input.ttlSeconds;
  const claims: LiveKitClaims = {
    iss: input.apiKey,
    sub: input.identity,
    name: input.name,
    nbf: nowS - NOT_BEFORE_SKEW_S,
    exp,
    jti: `${input.identity}.${nowS}`,
    video: {
      room: input.room,
      roomJoin: true,
      canSubscribe: input.grants.canSubscribe,
      canPublish: input.grants.canPublish,
      canPublishSources: [...input.grants.canPublishSources],
      canPublishData: input.grants.canPublishData,
      canUpdateOwnMetadata: input.grants.canUpdateOwnMetadata,
    },
  };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const signature = createHmac("sha256", input.apiSecret).update(`${head}.${body}`).digest();
  return { token: `${head}.${body}.${b64url(signature)}`, expiresAt: exp * 1000 };
}

/**
 * Check a token's signature and expiry and return its claims (tests, and
 * the e2e helper); null when it does not verify.
 */
export function verifyAccessToken(
  token: string,
  apiSecret: string,
  now: number,
): LiveKitClaims | null {
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  const expected = createHmac("sha256", apiSecret).update(`${head}.${body}`).digest("base64url");
  if (expected !== sig) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LiveKitClaims;
  const nowS = Math.floor(now / 1000);
  if (claims.exp <= nowS || claims.nbf > nowS) return null;
  return claims;
}
