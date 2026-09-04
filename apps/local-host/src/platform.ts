/**
 * Vxture platform integration for the desktop Runtime (liaison L3(a)/(b);
 * design: docs/30-design/40-context-architecture.md section 9, platform
 * authority: the integration general spec / product_200 C1+C2).
 *
 * C1 identity: OIDC Authorization Code + PKCE S256 as a PUBLIC client (no
 * client_secret - the shipped binary holds zero secrets). The system browser
 * performs the login; the daemon's loopback callback completes the exchange.
 * Tokens never reach the UI (browser-zero-token); the refresh token is
 * persisted sealed under the master key (DPAPI-protected on win32).
 *
 * C2 entitlements: read-only envelope fetch with the USER access token,
 * short-TTL in-memory cache honouring Cache-Control, never persisted
 * (product_220 section 3 discipline applies client-side unchanged).
 */

import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { KeyManager } from "./keys.js";

export interface PlatformConfig {
  /** OIDC issuer, e.g. https://accounts.vxture.com */
  issuer: string;
  /** Public client id (ruyin / ruyin-beta per channel). */
  clientId: string;
  /** Loopback redirect URI registered for this client. */
  redirectUri: string;
  /** Platform API base for /platform/entitlements (empty = not configured). */
  platformApiBase: string;
  /** Console base for subscribe deep links, e.g. https://vxture.com */
  consoleBase: string;
}

export function platformConfigFromEnv(port: number): PlatformConfig {
  return {
    issuer: process.env["RUYIN_ACCOUNTS_ISSUER"] ?? "https://accounts.vxture.com",
    clientId: process.env["RUYIN_OIDC_CLIENT_ID"] ?? "ruyin",
    redirectUri: `http://127.0.0.1:${port}/oauth/callback`,
    platformApiBase: process.env["RUYIN_PLATFORM_API_BASE"] ?? "",
    consoleBase: process.env["RUYIN_CONSOLE_BASE"] ?? "https://vxture.com",
  };
}

interface DiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
}

interface Jwk {
  kid?: string;
  kty: string;
  [k: string]: unknown;
}

export interface IdClaims {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  /** OIDC `phone` scope（授权请求里一直在要，此前没投射出来）。 */
  phone_number?: string;
  phone_number_verified?: boolean;
  locale?: string;
  picture?: string;
  active_org?: string;
  active_org_name?: string;
  /** personal | team —— 平台契约 §8 说这是判个人/团队的唯一可靠信号。 */
  active_org_type?: string;
  active_workspace?: string;
  active_workspace_name?: string;
  roles?: string[];
  [k: string]: unknown;
}

export interface SessionSummary {
  signedIn: boolean;
  /**
   * 会话身份的**投射**，不是原始 claims：只挑界面要展示的那几项。
   * 2026-09-04 补齐 —— 授权请求要的是 `openid profile email phone`，而此前只
   * 投射了四个字段，用户名 / 电话 / 角色 / 地区拿到了却没人看得见。
   */
  profile?: {
    sub: string;
    name?: string;
    username?: string;
    email?: string;
    emailVerified?: boolean;
    phone?: string;
    phoneVerified?: boolean;
    locale?: string;
    roles?: string[];
    picture?: string;
  };
  org?: { id?: string; name?: string; type?: string };
  workspace?: { id?: string; name?: string };
  issuer: string;
  consoleBase: string;
  entitlementsConfigured: boolean;
}

/** Base64url without padding. */
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48)); // 64 chars, within RFC 7636 43..128
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Verify a compact JWT (RS256 only) against a JWKS and return its payload.
 * Enforces the client-side subset of the platform's entry-check discipline:
 * explicit alg allowlist (rejects none/HS*), iss exact match, aud contains
 * our client_id, exp with 60s skew.
 */
export function verifyJwt(
  token: string,
  jwks: Jwk[],
  expect: { issuer: string; audience: string; nowSec?: number },
): IdClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("id_token: not a compact JWT");
  const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== "RS256") {
    throw new Error(`id_token: alg ${String(header.alg)} rejected (RS256 only)`);
  }
  const jwk =
    jwks.find((k) => header.kid !== undefined && k.kid === header.kid) ??
    (jwks.length === 1 ? jwks[0] : undefined);
  if (!jwk) throw new Error("id_token: no matching JWKS key");
  const key = createPublicKey({ key: jwk as never, format: "jwk" });
  const ok = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2]!, "base64url"),
  );
  if (!ok) throw new Error("id_token: signature verification failed");
  const claims = JSON.parse(
    Buffer.from(parts[1]!, "base64url").toString("utf8"),
  ) as IdClaims & { iss?: string; aud?: string | string[]; exp?: number };
  if (claims.iss !== expect.issuer) throw new Error("id_token: iss mismatch");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expect.audience)) throw new Error("id_token: aud mismatch");
  const now = expect.nowSec ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + 60 < now) {
    throw new Error("id_token: expired");
  }
  return claims;
}

interface PersistedSession {
  refresh_token: string;
  claims: IdClaims;
  saved_at: string;
}

const SESSION_FILE = "platform-session.enc";
const PENDING_TTL_MS = 10 * 60 * 1000;

export class PlatformService {
  private discovery?: DiscoveryDoc;
  private jwks?: Jwk[];
  private pending = new Map<string, { verifier: string; createdAt: number }>();
  private accessToken?: { value: string; expiresAt: number };
  private refreshToken?: string;
  private claims?: IdClaims;
  private readonly sessionPath: string;
  private entCache = new Map<string, { body: unknown; expiresAt: number }>();

  constructor(
    readonly config: PlatformConfig,
    private readonly keys: KeyManager,
    dataDir: string,
  ) {
    const dir = join(dataDir, "runtime");
    mkdirSync(dir, { recursive: true });
    this.sessionPath = join(dir, SESSION_FILE);
    this.restore();
  }

  private restore(): void {
    if (!existsSync(this.sessionPath)) return;
    try {
      const raw = this.keys.open(readFileSync(this.sessionPath));
      const saved = JSON.parse(raw.toString("utf8")) as PersistedSession;
      this.refreshToken = saved.refresh_token;
      this.claims = saved.claims;
      // 恢复的 claims 是上次 id_token 的，可能缺 access_token 的上下文
      // （active_org / active_workspace / name / email）。后台刷新一次补全身份，
      // 不阻塞启动；失败（refresh 被吊销）则由 ensureAccessToken 自行登出。
      void this.ensureAccessToken().catch(() => {});
    } catch (cause) {
      console.warn(
        `[ruyin] platform session restore failed (dropping it): ${
          cause instanceof Error ? cause.message : cause
        }`,
      );
      rmSync(this.sessionPath, { force: true });
    }
  }

  private persist(): void {
    if (!this.refreshToken || !this.claims) {
      rmSync(this.sessionPath, { force: true });
      return;
    }
    const body: PersistedSession = {
      refresh_token: this.refreshToken,
      claims: this.claims,
      saved_at: new Date().toISOString(),
    };
    writeFileSync(this.sessionPath, this.keys.seal(Buffer.from(JSON.stringify(body))));
  }

  private async discover(): Promise<DiscoveryDoc> {
    if (this.discovery) return this.discovery;
    const res = await fetch(`${this.config.issuer}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
    this.discovery = (await res.json()) as DiscoveryDoc;
    return this.discovery;
  }

  private async fetchJwks(): Promise<Jwk[]> {
    if (this.jwks) return this.jwks;
    const doc = await this.discover();
    const res = await fetch(doc.jwks_uri);
    if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    this.jwks = body.keys ?? [];
    return this.jwks;
  }

  /** Start a login: returns the authorize URL for the system browser. */
  async beginLogin(): Promise<string> {
    const doc = await this.discover();
    const { verifier, challenge } = pkcePair();
    const state = b64url(randomBytes(24));
    // Drop stale pending flows.
    const now = Date.now();
    for (const [k, v] of this.pending) {
      if (now - v.createdAt > PENDING_TTL_MS) this.pending.delete(k);
    }
    this.pending.set(state, { verifier, createdAt: now });
    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", "openid profile email phone");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  /** Loopback callback: exchange the code (PKCE, no client secret). */
  async completeLogin(code: string, state: string): Promise<void> {
    const flow = this.pending.get(state);
    if (!flow || Date.now() - flow.createdAt > PENDING_TTL_MS) {
      throw new Error("login flow expired or unknown state - start again from the app");
    }
    this.pending.delete(state);
    const doc = await this.discover();
    const res = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId,
        code_verifier: flow.verifier,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `token exchange failed: HTTP ${res.status} ${String(body["error"] ?? "")} ${String(body["error_description"] ?? "")}`.trim(),
      );
    }
    const idToken = body["id_token"];
    if (typeof idToken !== "string") throw new Error("token response missing id_token");
    this.claims = verifyJwt(idToken, await this.fetchJwks(), {
      issuer: this.config.issuer,
      audience: this.config.clientId,
    });
    this.applyTokens(body);
    await this.mergeAccessClaims();
    this.persist();
  }

  private applyTokens(body: Record<string, unknown>): void {
    const access = body["access_token"];
    if (typeof access !== "string") throw new Error("token response missing access_token");
    const expiresIn = typeof body["expires_in"] === "number" ? body["expires_in"] : 300;
    this.accessToken = { value: access, expiresAt: Date.now() + expiresIn * 1000 };
    if (typeof body["refresh_token"] === "string") {
      this.refreshToken = body["refresh_token"];
    }
  }

  /**
   * access_token 也是 RS256 JWT，其上下文 claims（active_org / active_workspace /
   * name / preferred_username / email / roles，见 140-ruyin-contract §8）不在
   * id_token 里。验签后合并进会话身份 —— 否则 org/workspace 恒空、权益查不到 key。
   */
  private async mergeAccessClaims(): Promise<void> {
    const at = this.accessToken?.value;
    if (!at) return;
    try {
      const ac = verifyJwt(at, await this.fetchJwks(), {
        issuer: this.config.issuer,
        audience: this.config.clientId,
      });
      // id_token 打底（稳定 sub/sid），access_token 覆盖补充上下文。
      this.claims = { ...(this.claims ?? ({ sub: ac.sub } as IdClaims)), ...ac };
    } catch {
      // access token 非可验签 JWT：保守，仅保留 id_token claims。
    }
  }

  /**
   * The user's access token for outbound calls that need to prove who is
   * asking - the capability surface verifies it to learn user / org /
   * workspace (ADR-009). Returns undefined when signed out rather than
   * throwing: a capability call without identity should be refused by the
   * callee, not crash the task here.
   */
  async bearerToken(): Promise<string | undefined> {
    try {
      return await this.ensureAccessToken();
    } catch {
      return undefined;
    }
  }

  /** Valid access token, refreshing near expiry. Throws when signed out. */
  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt - 60_000) {
      return this.accessToken.value;
    }
    if (!this.refreshToken) throw new NotSignedInError();
    const doc = await this.discover();
    const res = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
        client_id: this.config.clientId,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // Refresh rejected = session revoked upstream; drop local session.
      this.signOutLocal();
      throw new NotSignedInError(
        `session refresh rejected (HTTP ${res.status} ${String(body["error"] ?? "")})`.trim(),
      );
    }
    this.applyTokens(body);
    if (typeof body["id_token"] === "string") {
      try {
        this.claims = verifyJwt(body["id_token"], await this.fetchJwks(), {
          issuer: this.config.issuer,
          audience: this.config.clientId,
        });
      } catch {
        // keep previous claims; access token is what matters here
      }
    }
    await this.mergeAccessClaims();
    this.persist();
    return this.accessToken!.value;
  }

  async logout(): Promise<void> {
    const refresh = this.refreshToken;
    this.signOutLocal();
    if (!refresh) return;
    try {
      const doc = await this.discover();
      if (doc.revocation_endpoint) {
        await fetch(doc.revocation_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: refresh,
            token_type_hint: "refresh_token",
            client_id: this.config.clientId,
          }),
        });
      }
    } catch {
      // best effort - local sign-out already done
    }
  }

  private signOutLocal(): void {
    this.accessToken = undefined;
    this.refreshToken = undefined;
    this.claims = undefined;
    this.entCache.clear();
    this.persist();
  }

  session(): SessionSummary {
    const c = this.claims;
    return {
      signedIn: !!this.refreshToken,
      ...(c
        ? {
            profile: {
              sub: c.sub,
              name: c.name ?? c.preferred_username,
              username: c.preferred_username,
              email: c.email,
              emailVerified: c.email_verified,
              phone: c.phone_number,
              phoneVerified: c.phone_number_verified,
              locale: c.locale,
              roles: c.roles,
              picture: c.picture,
            },
            org: { id: c.active_org, name: c.active_org_name, type: c.active_org_type },
            workspace: { id: c.active_workspace, name: c.active_workspace_name },
          }
        : {}),
      issuer: this.config.issuer,
      consoleBase: this.config.consoleBase,
      entitlementsConfigured: this.config.platformApiBase.length > 0,
    };
  }

  /**
   * C2 envelope fetch for one or more product codes, keyed by the platform
   * workspace from the token claims. Cached in memory per Cache-Control
   * (default 45s), never persisted.
   */
  async entitlements(products: string[]): Promise<unknown> {
    if (!this.config.platformApiBase) {
      throw new PlatformNotConfiguredError();
    }
    const projectId = this.claims?.active_workspace;
    if (!projectId) throw new NotSignedInError("no active_workspace claim on this session");
    const key = `${projectId}:${[...products].sort().join(",")}`;
    const hit = this.entCache.get(key);
    if (hit && Date.now() < hit.expiresAt) return hit.body;

    const token = await this.ensureAccessToken();
    const url = new URL(`${this.config.platformApiBase}/platform/entitlements`);
    url.searchParams.set("workspace_id", projectId);
    // Always the batch parameter - one consistent envelope shape downstream
    // ({ workspace_id, entitlements: { [code]: envelope } }).
    url.searchParams.set("products", products.join(","));
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`entitlements fetch failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as unknown;
    const cc = res.headers.get("cache-control") ?? "";
    const maxAge = /max-age=(\d+)/.exec(cc)?.[1];
    const ttl = (maxAge ? Number(maxAge) : 45) * 1000;
    this.entCache.set(key, { body, expiresAt: Date.now() + ttl });
    return body;
  }
}

export class NotSignedInError extends Error {
  constructor(message = "not signed in") {
    super(message);
  }
}

export class PlatformNotConfiguredError extends Error {
  constructor() {
    super("RUYIN_PLATFORM_API_BASE is not configured");
  }
}
