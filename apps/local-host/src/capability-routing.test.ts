/**
 * 能力路由（ADR-025）的判据。三件事是这一层存在的理由，每件都钉住：
 *
 *   1. **默认只许本机**（owner 2026-09-15）—— 没有任何配置时，一次出域的可能都没有。
 *   2. **不许悄悄出域** —— 只许本机时本机做不了，结果是 unavailable，不是 cloud。
 *   3. **云端通路未开放前恒不可用** —— 配置写优先云端也收紧到本机，并说出原因。
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  CLOUD_ROUTE_OPEN,
  DEFAULT_ROUTING_POLICY,
  LOCAL_PLANE_NOTE,
  ROUTE_MODES,
  ROUTE_MODE_LABEL,
  decideRoute,
  loadRoutingPolicy,
  modeFor,
  parseRoutingPolicy,
  routingPolicyPath,
  type RoutingPolicy,
} from "./capability-routing.js";

const policy = (over: Partial<RoutingPolicy> = {}): RoutingPolicy => ({
  default: "local_only",
  tenants: {},
  workspaces: {},
  capabilities: {},
  ...over,
});

describe("capability-routing", () => {
  it("默认策略是只许本机，云端通路此刻未开放", () => {
    assert.equal(DEFAULT_ROUTING_POLICY.default, "local_only");
    assert.equal(CLOUD_ROUTE_OPEN, false);
    assert.deepEqual([...ROUTE_MODES], ["local_only", "prefer_local", "prefer_cloud"]);
    assert.equal(ROUTE_MODE_LABEL.local_only, "只许本机");
  });

  it("modeFor：能力 > 工作区 > 租户 > 默认，越具体越优先", () => {
    const p = policy({
      default: "local_only",
      tenants: { t1: "prefer_local" },
      workspaces: { w1: "prefer_cloud" },
      capabilities: { "tavily.search": "prefer_local" },
    });
    assert.deepEqual(modeFor(p, { tenantId: "t1", workspaceId: "w1", capabilityId: "tavily.search" }), {
      mode: "prefer_local",
      source: "capability",
    });
    assert.deepEqual(modeFor(p, { tenantId: "t1", workspaceId: "w1", capabilityId: "other" }), {
      mode: "prefer_cloud",
      source: "workspace",
    });
    assert.deepEqual(modeFor(p, { tenantId: "t1", workspaceId: "w9" }), { mode: "prefer_local", source: "tenant" });
    assert.deepEqual(modeFor(p, { tenantId: "t9" }), { mode: "local_only", source: "default" });
    assert.deepEqual(modeFor(p, {}), { mode: "local_only", source: "default" });
  });

  it("只许本机：本机做得了就本机；做不了是 unavailable，绝不改走云端（即使云端开着）", () => {
    const p = policy();
    const ok = decideRoute(p, {}, { localAvailable: true, cloudOpen: true });
    assert.equal(ok.route, "local");
    assert.ok(ok.reason.includes(LOCAL_PLANE_NOTE), "走本机的原因里要带「兼容 Runos 协议的本地能力面」");

    const missing = decideRoute(p, {}, { localAvailable: false, cloudOpen: true });
    assert.equal(missing.route, "unavailable");
    assert.match(missing.reason, /不改走云端/);

    const needsKey = decideRoute(p, {}, { localAvailable: true, requiresCredential: true, cloudOpen: true });
    assert.equal(needsKey.route, "unavailable", "要密钥的能力本机做不了，哪怕登记册里有它");
    assert.match(needsKey.reason, /第三方密钥/);
  });

  it("优先本机：本机优先；做不了且云端可用才走云端；云端未开放时说清是通路没开", () => {
    const p = policy({ default: "prefer_local" });
    assert.equal(decideRoute(p, {}, { localAvailable: true }).route, "local");

    const viaCloud = decideRoute(p, {}, { localAvailable: false, cloudOpen: true });
    assert.equal(viaCloud.route, "cloud");
    assert.match(viaCloud.reason, /改走云端/);

    const closed = decideRoute(p, {}, { localAvailable: false });
    assert.equal(closed.route, "unavailable");
    assert.match(closed.reason, /云端 Runos 通路尚未开放/);

    const offline = decideRoute(p, {}, { localAvailable: false, cloudOpen: true, online: false });
    assert.equal(offline.route, "unavailable");
    assert.match(offline.reason, /离线/);

    const intranet = decideRoute(p, {}, { localAvailable: false, intranetOnly: true, cloudOpen: true });
    assert.equal(intranet.route, "unavailable");
    assert.match(intranet.reason, /内网/);
  });

  it("优先云端：通路未开放时退到本机并说明；本机也做不了就 unavailable", () => {
    const p = policy({ default: "prefer_cloud" });
    const fallback = decideRoute(p, {}, { localAvailable: true });
    assert.equal(fallback.route, "local");
    assert.match(fallback.reason, /云端 Runos 通路尚未开放/);

    assert.equal(decideRoute(p, {}, { localAvailable: true, cloudOpen: true }).route, "cloud");
    // 内网能力哪怕配置优先云端、云端开着，也只能本机
    assert.equal(decideRoute(p, {}, { localAvailable: true, intranetOnly: true, cloudOpen: true }).route, "local");

    const none = decideRoute(p, {}, { localAvailable: false, requiresCredential: true });
    assert.equal(none.route, "unavailable");
    assert.match(none.reason, /尚未开放.*第三方密钥/);
  });

  it("决定里带着档位与档位的来源，界面与审计照它说话", () => {
    const d = decideRoute(policy({ workspaces: { w1: "prefer_local" } }), { workspaceId: "w1" }, { localAvailable: true });
    assert.deepEqual({ mode: d.mode, modeSource: d.modeSource }, { mode: "prefer_local", modeSource: "workspace" });
  });

  it("parseRoutingPolicy：认得的照用，认不出的丢掉并说明，不抛", () => {
    assert.deepEqual(parseRoutingPolicy({}).policy, policy());
    const { policy: p, errors } = parseRoutingPolicy({
      default: "prefer_cloud",
      tenants: { t1: "prefer_local", t2: "cloud_only" },
      workspaces: [],
      capabilities: { "": "prefer_local", "a.b": "local_only" },
    });
    assert.deepEqual(p, policy({ default: "prefer_cloud", tenants: { t1: "prefer_local" }, capabilities: { "a.b": "local_only" } }));
    assert.equal(errors.length, 3);
    assert.ok(errors.some((e) => e.includes("tenants.t2")));
    assert.ok(errors.some((e) => e.includes("workspaces 不是一个对象")));

    const bad = parseRoutingPolicy({ default: "yes" });
    assert.equal(bad.policy.default, "local_only");
    assert.match(bad.errors[0]!, /default/);

    for (const raw of [null, "local_only", [1]]) {
      const r = parseRoutingPolicy(raw);
      assert.deepEqual(r.policy, policy());
      assert.match(r.errors[0]!, /不是一个对象/);
    }
  });

  it("loadRoutingPolicy：没有文件是默认、不是错误；有文件照读；读坏了按默认并说明", () => {
    const dir = mkdtempSync(join(tmpdir(), "ruyin-routing-"));
    assert.deepEqual(loadRoutingPolicy(dir), { policy: DEFAULT_ROUTING_POLICY, source: "default", errors: [] });

    mkdirSync(join(dir, "capabilities"), { recursive: true });
    writeFileSync(routingPolicyPath(dir), JSON.stringify({ default: "prefer_local" }));
    const fromFile = loadRoutingPolicy(dir);
    assert.equal(fromFile.source, "file");
    assert.equal(fromFile.policy.default, "prefer_local");
    assert.deepEqual(fromFile.errors, []);

    writeFileSync(routingPolicyPath(dir), "{ not json");
    const broken = loadRoutingPolicy(dir);
    assert.equal(broken.source, "default");
    assert.equal(broken.policy.default, "local_only");
    assert.match(broken.errors[0]!, /读不出来/);

    // 策略文件就在数据目录下的 capabilities/ 里，与技能、工具的状态文件并列
    assert.equal(routingPolicyPath("/x").replace(/\\/g, "/"), "/x/capabilities/routing.json");
  });
});
