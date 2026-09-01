/**
 * Unit tests for the platform auth primitives (platform.ts): PKCE S256
 * derivation and the id_token verifier's accept/reject paths - the
 * client-side subset of the platform entry-check discipline (explicit alg
 * allowlist, iss/aud/exp).
 */

import { strict as assert } from "node:assert";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { KeyManager } from "./keys.js";
import {
  NotSignedInError,
  PlatformNotConfiguredError,
  PlatformService,
  pkcePair,
  platformConfigFromEnv,
  verifyJwt,
  type PlatformConfig,
} from "./platform.js";

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

// --- PlatformService: the OIDC login/session/entitlements class itself ----
//
// Everything above only exercised the two pure helpers. The class that
// actually drives login, persists the sealed session, refreshes near expiry
// and fetches entitlements had no test at all - 17% function coverage. It is
// also the exact area a prior real incident traced to (see repo memory:
// login-root-cause-public-client). fetch is mocked by URL pathname; KeyManager
// is real (a tmpdir), so sealing/unsealing the session file is genuine.

function testConfig(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    issuer: ISSUER,
    clientId: CLIENT,
    redirectUri: "http://127.0.0.1:0/oauth/callback",
    platformApiBase: "",
    consoleBase: "https://vxture.com",
    ...overrides,
  };
}

async function newKeys(): Promise<{ keys: KeyManager; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-platform-test-"));
  return { keys: await KeyManager.open(dataDir), dataDir };
}

function tokenResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 300,
    id_token: makeJwt(goodClaims),
    ...overrides,
  };
}

interface MockRoutes {
  tokenExchange?: (params: URLSearchParams) => { status: number; body: Record<string, unknown> };
  refresh?: (params: URLSearchParams) => { status: number; body: Record<string, unknown> };
  entitlements?: (
    url: URL,
  ) => { status: number; body: unknown; headers?: Record<string, string> };
  revoke?: () => { status: number };
}

/** Installs a fetch mock routed by pathname; returns the ordered call log. */
function installOidcMock(t: import("node:test").TestContext, routes: MockRoutes): string[] {
  const calls: string[] = [];
  const discovery = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
    revocation_endpoint: `${ISSUER}/revoke`,
  };
  t.mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      return new Response(JSON.stringify(discovery), { status: 200 });
    }
    if (url.pathname === "/jwks") {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    if (url.pathname === "/token") {
      const params = new URLSearchParams(String(init?.body ?? ""));
      const handler = params.get("grant_type") === "refresh_token" ? routes.refresh : routes.tokenExchange;
      const result = handler?.(params) ?? { status: 200, body: {} };
      return new Response(JSON.stringify(result.body), { status: result.status });
    }
    if (url.pathname === "/revoke") {
      const result = routes.revoke?.() ?? { status: 200 };
      return new Response(null, { status: result.status });
    }
    if (url.pathname === "/platform/entitlements") {
      const result = routes.entitlements?.(url) ?? { status: 200, body: {} };
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: result.headers,
      });
    }
    throw new Error(`unmocked fetch: ${url}`);
  });
  return calls;
}

async function loggedIn(
  svc: PlatformService,
  code = "auth-code-1",
): Promise<void> {
  const state = new URL(await svc.beginLogin()).searchParams.get("state")!;
  await svc.completeLogin(code, state);
}

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const keys = Object.keys(overrides);
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

void test("platformConfigFromEnv: defaults when unset", () => {
  const cfg = withEnv(
    {
      RUYIN_ACCOUNTS_ISSUER: undefined,
      RUYIN_OIDC_CLIENT_ID: undefined,
      RUYIN_PLATFORM_API_BASE: undefined,
      RUYIN_CONSOLE_BASE: undefined,
    },
    () => platformConfigFromEnv(17123),
  );
  assert.equal(cfg.issuer, "https://accounts.vxture.com");
  assert.equal(cfg.clientId, "ruyin");
  assert.equal(cfg.redirectUri, "http://127.0.0.1:17123/oauth/callback");
  assert.equal(cfg.platformApiBase, "");
  assert.equal(cfg.consoleBase, "https://vxture.com");
});

void test("platformConfigFromEnv: env vars override defaults", () => {
  const cfg = withEnv(
    {
      RUYIN_ACCOUNTS_ISSUER: "https://accounts.example.test",
      RUYIN_OIDC_CLIENT_ID: "ruyin-beta",
      RUYIN_PLATFORM_API_BASE: "https://api.example.test",
      RUYIN_CONSOLE_BASE: "https://console.example.test",
    },
    () => platformConfigFromEnv(9),
  );
  assert.equal(cfg.issuer, "https://accounts.example.test");
  assert.equal(cfg.clientId, "ruyin-beta");
  assert.equal(cfg.platformApiBase, "https://api.example.test");
  assert.equal(cfg.consoleBase, "https://console.example.test");
});

void test("PlatformService.beginLogin returns a well-formed PKCE authorize URL", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {});
  const svc = new PlatformService(testConfig(), keys, dataDir);
  const authorizeUrl = new URL(await svc.beginLogin());
  assert.equal(authorizeUrl.origin + authorizeUrl.pathname, `${ISSUER}/authorize`);
  assert.equal(authorizeUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizeUrl.searchParams.get("client_id"), CLIENT);
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizeUrl.searchParams.get("code_challenge"));
  assert.ok(authorizeUrl.searchParams.get("state"));
});

void test("PlatformService: login completes, session reflects claims, and persists sealed to disk", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, { tokenExchange: () => ({ status: 200, body: tokenResponse() }) });
  const svc = new PlatformService(testConfig(), keys, dataDir);
  assert.equal(svc.session().signedIn, false);

  await loggedIn(svc);

  const session = svc.session();
  assert.equal(session.signedIn, true);
  assert.equal(session.profile?.sub, "user-1");
  assert.equal(session.workspace?.id, "ws-1");

  const sessionPath = join(dataDir, "runtime", "platform-session.enc");
  assert.ok(existsSync(sessionPath));
  // 落盘是密文：明文字段名不能整段出现在文件字节里。
  assert.ok(!readFileSync(sessionPath).toString("latin1").includes("refresh_token"));
});

void test("PlatformService.completeLogin rejects an unknown state", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {});
  const svc = new PlatformService(testConfig(), keys, dataDir);
  await assert.rejects(
    () => svc.completeLogin("code", "not-a-real-state"),
    /login flow expired or unknown state/,
  );
});

void test("PlatformService.completeLogin rejects a pending flow past its TTL", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {});
  const svc = new PlatformService(testConfig(), keys, dataDir);
  let fakeNow = Date.now();
  t.mock.method(Date, "now", () => fakeNow);
  const state = new URL(await svc.beginLogin()).searchParams.get("state")!;
  fakeNow += 11 * 60 * 1000; // PENDING_TTL_MS is 10 minutes
  await assert.rejects(
    () => svc.completeLogin("code", state),
    /login flow expired or unknown state/,
  );
});

void test("PlatformService.completeLogin surfaces a token-exchange HTTP failure", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {
    tokenExchange: () => ({
      status: 400,
      body: { error: "invalid_grant", error_description: "code already used" },
    }),
  });
  const svc = new PlatformService(testConfig(), keys, dataDir);
  const state = new URL(await svc.beginLogin()).searchParams.get("state")!;
  await assert.rejects(
    () => svc.completeLogin("code", state),
    /HTTP 400.*invalid_grant.*code already used/,
  );
});

void test("PlatformService.bearerToken resolves to undefined when signed out", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {});
  const svc = new PlatformService(testConfig(), keys, dataDir);
  assert.equal(await svc.bearerToken(), undefined);
});

void test("PlatformService.bearerToken refreshes a near-expiry token, then serves from cache", async (t) => {
  const { keys, dataDir } = await newKeys();
  let refreshCalls = 0;
  installOidcMock(t, {
    tokenExchange: () => ({ status: 200, body: tokenResponse({ expires_in: 1 }) }),
    refresh: (params) => {
      refreshCalls++;
      // 没重新发 refresh_token：轮换是可选的，旧的那份必须还能用。
      assert.equal(params.get("refresh_token"), "rt-1");
      return { status: 200, body: { access_token: "at-2", expires_in: 300 } };
    },
  });
  const svc = new PlatformService(testConfig(), keys, dataDir);
  await loggedIn(svc);

  assert.equal(await svc.bearerToken(), "at-2");
  assert.equal(refreshCalls, 1);
  assert.equal(await svc.bearerToken(), "at-2");
  assert.equal(refreshCalls, 1, "a still-valid token must not trigger a second refresh");
});

void test("PlatformService: a rejected refresh signs the session out locally", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {
    tokenExchange: () => ({ status: 200, body: tokenResponse({ expires_in: 1 }) }),
    refresh: () => ({ status: 400, body: { error: "invalid_grant" } }),
  });
  const svc = new PlatformService(testConfig(), keys, dataDir);
  await loggedIn(svc);
  assert.equal(svc.session().signedIn, true);

  assert.equal(await svc.bearerToken(), undefined);
  assert.equal(svc.session().signedIn, false);
  assert.ok(!existsSync(join(dataDir, "runtime", "platform-session.enc")));
});

void test("PlatformService: a session persisted by one instance restores in a fresh instance", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {
    tokenExchange: () => ({ status: 200, body: tokenResponse() }),
    refresh: () => ({ status: 200, body: { access_token: "at-2", expires_in: 300 } }),
  });
  const first = new PlatformService(testConfig(), keys, dataDir);
  await loggedIn(first);

  const second = new PlatformService(testConfig(), keys, dataDir);
  // 恢复对 claims/refreshToken 是同步的：不必等后台补全就该已经"已登录"。
  const session = second.session();
  assert.equal(session.signedIn, true);
  assert.equal(session.profile?.sub, "user-1");

  // restore() 后台补一次 access token；把它在本测试的 mock 生命周期内等定，
  // 不要让一个未决的 fetch 漏到下一个测试（那时 mock 已经卸载，会打真网络）。
  await new Promise((resolve) => setImmediate(resolve));
});

void test("PlatformService: a corrupted session file is dropped, not thrown", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {});
  writeFileSync(join(dataDir, "runtime", "platform-session.enc"), Buffer.from("not a sealed blob"));

  const svc = new PlatformService(testConfig(), keys, dataDir);
  assert.equal(svc.session().signedIn, false);
  assert.ok(!existsSync(join(dataDir, "runtime", "platform-session.enc")));
});

void test("PlatformService.logout revokes the refresh token and clears local state", async (t) => {
  const { keys, dataDir } = await newKeys();
  let revokeCalls = 0;
  installOidcMock(t, {
    tokenExchange: () => ({ status: 200, body: tokenResponse() }),
    revoke: () => {
      revokeCalls++;
      return { status: 200 };
    },
  });
  const svc = new PlatformService(testConfig(), keys, dataDir);
  await loggedIn(svc);

  await svc.logout();
  assert.equal(svc.session().signedIn, false);
  assert.equal(revokeCalls, 1);
  assert.ok(!existsSync(join(dataDir, "runtime", "platform-session.enc")));
});

void test("PlatformService.logout signs out locally even when revocation itself fails", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {
    tokenExchange: () => ({ status: 200, body: tokenResponse() }),
    revoke: () => {
      throw new Error("network unreachable");
    },
  });
  const svc = new PlatformService(testConfig(), keys, dataDir);
  await loggedIn(svc);

  await assert.doesNotReject(() => svc.logout());
  assert.equal(svc.session().signedIn, false);
});

void test("PlatformService.logout on an already-signed-out session is a no-op", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {});
  const svc = new PlatformService(testConfig(), keys, dataDir);
  await assert.doesNotReject(() => svc.logout());
});

void test("PlatformService.entitlements throws when the platform API is not configured", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {});
  const svc = new PlatformService(testConfig({ platformApiBase: "" }), keys, dataDir);
  await assert.rejects(() => svc.entitlements(["bid"]), PlatformNotConfiguredError);
});

void test("PlatformService.entitlements throws when signed out", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {});
  const svc = new PlatformService(
    testConfig({ platformApiBase: "https://api.example.test" }),
    keys,
    dataDir,
  );
  await assert.rejects(() => svc.entitlements(["bid"]), NotSignedInError);
});

void test("PlatformService.entitlements fetches, caches per Cache-Control, and keys by workspace", async (t) => {
  const { keys, dataDir } = await newKeys();
  let entitlementCalls = 0;
  installOidcMock(t, {
    tokenExchange: () => ({ status: 200, body: tokenResponse() }),
    entitlements: (url) => {
      entitlementCalls++;
      assert.equal(url.searchParams.get("workspace_id"), "ws-1");
      assert.equal(url.searchParams.get("products"), "bid");
      return {
        status: 200,
        body: { workspace_id: "ws-1", entitlements: { bid: { active: true } } },
        headers: { "cache-control": "max-age=60" },
      };
    },
  });
  const svc = new PlatformService(
    testConfig({ platformApiBase: "https://api.example.test" }),
    keys,
    dataDir,
  );
  await loggedIn(svc);

  const first = await svc.entitlements(["bid"]);
  const second = await svc.entitlements(["bid"]);
  assert.deepEqual(first, { workspace_id: "ws-1", entitlements: { bid: { active: true } } });
  assert.deepEqual(second, first);
  assert.equal(entitlementCalls, 1, "a second call within the TTL must be served from cache");
});

void test("PlatformService.entitlements surfaces an HTTP failure", async (t) => {
  const { keys, dataDir } = await newKeys();
  installOidcMock(t, {
    tokenExchange: () => ({ status: 200, body: tokenResponse() }),
    entitlements: () => ({ status: 500, body: {} }),
  });
  const svc = new PlatformService(
    testConfig({ platformApiBase: "https://api.example.test" }),
    keys,
    dataDir,
  );
  await loggedIn(svc);
  await assert.rejects(() => svc.entitlements(["bid"]), /entitlements fetch failed: HTTP 500/);
});
