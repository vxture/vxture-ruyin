/**
 * Unit tests for the platform auth primitives (platform.ts): PKCE S256
 * derivation and the id_token verifier's accept/reject paths - the
 * client-side subset of the platform entry-check discipline (explicit alg
 * allowlist, iss/aud/exp).
 */

import { strict as assert } from "node:assert";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { pkcePair, verifyJwt } from "./platform.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1" } as {
  kid: string;
  kty: string;
};

const ISSUER = "https://accounts.vxture.com";
const CLIENT = "ruyin";
const NOW = 1_900_000_000;

function b64url(data: string | Buffer): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", typ: "JWT", kid: "k1" },
  sign = true,
): string {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  if (!sign) return `${h}.${p}.`;
  const signer = createSign("RSA-SHA256");
  signer.update(`${h}.${p}`);
  return `${h}.${p}.${b64url(signer.sign(privateKey))}`;
}

const goodClaims = {
  iss: ISSUER,
  aud: CLIENT,
  sub: "user-1",
  exp: NOW + 300,
  name: "测试用户",
  active_workspace: "ws-1",
};

void test("pkcePair derives the S256 challenge from the verifier", () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.equal(challenge, b64url(createHash("sha256").update(verifier).digest()));
});

void test("verifyJwt accepts a valid RS256 token", () => {
  const claims = verifyJwt(makeJwt(goodClaims), [jwk], {
    issuer: ISSUER,
    audience: CLIENT,
    nowSec: NOW,
  });
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.active_workspace, "ws-1");
});

void test("verifyJwt rejects alg none", () => {
  const token = makeJwt(goodClaims, { alg: "none", typ: "JWT" }, false);
  assert.throws(
    () => verifyJwt(token, [jwk], { issuer: ISSUER, audience: CLIENT, nowSec: NOW }),
    /alg none rejected/,
  );
});

void test("verifyJwt rejects HS256", () => {
  const token = makeJwt(goodClaims, { alg: "HS256", typ: "JWT", kid: "k1" }, false);
  assert.throws(
    () => verifyJwt(token, [jwk], { issuer: ISSUER, audience: CLIENT, nowSec: NOW }),
    /alg HS256 rejected/,
  );
});

void test("verifyJwt rejects a foreign audience", () => {
  const token = makeJwt({ ...goodClaims, aud: "some-other-product" });
  assert.throws(
    () => verifyJwt(token, [jwk], { issuer: ISSUER, audience: CLIENT, nowSec: NOW }),
    /aud mismatch/,
  );
});

void test("verifyJwt rejects a wrong issuer", () => {
  const token = makeJwt({ ...goodClaims, iss: "https://evil.example" });
  assert.throws(
    () => verifyJwt(token, [jwk], { issuer: ISSUER, audience: CLIENT, nowSec: NOW }),
    /iss mismatch/,
  );
});

void test("verifyJwt rejects an expired token (beyond 60s skew)", () => {
  const token = makeJwt({ ...goodClaims, exp: NOW - 120 });
  assert.throws(
    () => verifyJwt(token, [jwk], { issuer: ISSUER, audience: CLIENT, nowSec: NOW }),
    /expired/,
  );
});

void test("verifyJwt rejects a tampered payload", () => {
  const good = makeJwt(goodClaims);
  const [h, , s] = good.split(".");
  const forged = `${h}.${b64url(JSON.stringify({ ...goodClaims, sub: "user-2" }))}.${s}`;
  assert.throws(
    () => verifyJwt(forged, [jwk], { issuer: ISSUER, audience: CLIENT, nowSec: NOW }),
    /signature verification failed/,
  );
});
