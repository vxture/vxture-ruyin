/**
 * 产品界面静态服务器（product-ui-server.ts，ADR-022 片三 a；ADR-023 片 3b-3 起按摘要出）。
 *
 * 这台服务器存在的理由是**给每个产品一个自己的 origin**：
 *   - 与工作台不同 → 碰不到工作台 `localStorage` 里的会话令牌；
 *   - 与别的产品不同 → 同源策略替我们把产品之间隔开。
 *
 * 第二条是第一版漏掉的：所有产品共用一个 origin、按路径分，结果按路径分根本不是
 * 边界（见实现的文件头，那条越权路径五步都走得通）。这里的用例因此直接对着**origin**
 * 断言，而不只是对着路径。
 *
 * 请求一律打 127.0.0.1、手工带 `Host` 头：Node 在 Windows 上不保证能解析
 * `*.localhost`，而服务器认的正是 Host 头，不是连到哪个地址。
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createProductUiServer,
  productFromHost,
  productOrigin,
  productUiPortFor,
} from "./product-ui-server.js";

const WORKSPACE = "http://127.0.0.1:7420";
/** 两份界面包的摘要。服务器不重算摘要（目录在 = 取回时校验过），所以这里用固定串。 */
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

interface Reply {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function get(port: number, host: string, path: string, method = "GET"): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: res.headers,
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

async function withServer(body: (port: number) => Promise<void>): Promise<void> {
  // 布局与真实的产品库一致（ADR-023）：<root>/<产品>/ui/<摘要>/…，旁边是版本目录。
  const root = mkdtempSync(join(tmpdir(), "ruyin-product-ui-"));
  const a = join(root, "bidproposal", "ui", SHA_A);
  mkdirSync(join(a, "assets"), { recursive: true });
  writeFileSync(join(a, "index.html"), "<p>bid</p>");
  writeFileSync(join(a, "assets", "app.js"), "console.log(1)");
  // 同一个产品目录下的契约与来源记录：**界面的 origin 上一个都不该取得到**。
  mkdirSync(join(root, "bidproposal", "1.0.0"), { recursive: true });
  writeFileSync(join(root, "bidproposal", "1.0.0", "ruyin.product.yaml"), "CONTRACT-NOT-FOR-THE-UI");
  // 另一个产品。名字以 bidproposal 开头 —— 第一版正是在这个形状上漏的。
  mkdirSync(join(root, "bidproposal2", "ui", SHA_B), { recursive: true });
  writeFileSync(join(root, "bidproposal2", "ui", SHA_B, "secret.js"), "SECRET-OF-ANOTHER-PRODUCT");

  // 端口交给系统分配 —— 服务器按**实际绑到的**端口认 Host，不需要事先知道是几。
  const server: Server = createProductUiServer({ root, workspaceOrigin: WORKSPACE });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await body(port);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** **两个产品的 origin 不同。** 这一条是隔离的全部基础 —— 同源策略只认 origin。 */
void test("产品界面服务器: 每个产品一个 origin —— 不同产品的 origin 互不相同，也不同于工作台", () => {
  const a = productOrigin("bidproposal", 7421);
  const b = productOrigin("bidproposal2", 7421);
  assert.equal(a, "http://bidproposal.localhost:7421");
  assert.notEqual(a, b);
  assert.notEqual(a, WORKSPACE);
  assert.notEqual(b, WORKSPACE);
});

void test("产品界面服务器: 按 Host 与摘要出该产品那一份界面包，缺省是 index.html", async () => {
  await withServer(async (port) => {
    const host = `bidproposal.localhost:${port}`;
    const index = await get(port, host, `/${SHA_A}/`);
    assert.equal(index.status, 200);
    assert.equal(index.body, "<p>bid</p>");
    assert.match(String(index.headers["content-type"]), /text\/html/);

    const js = await get(port, host, `/${SHA_A}/assets/app.js`);
    assert.equal(js.status, 200);
    assert.match(String(js.headers["content-type"]), /javascript/);
  });
});

/** 不带摘要的地址一律没有：界面只从校验过的那一份出。 */
void test("产品界面服务器: 路径第一段不是摘要 → 404（包括根）", async () => {
  await withServer(async (port) => {
    const host = `bidproposal.localhost:${port}`;
    for (const path of ["/", "/index.html", "/assets/app.js", `/${SHA_A.slice(1)}/`, `/${SHA_A.toUpperCase()}/`]) {
      assert.equal((await get(port, host, path)).status, 404, path);
    }
    // 摘要格式对、但本地没有这一份 → 404，不回退到别的摘要。
    assert.equal((await get(port, host, `/${"c".repeat(64)}/`)).status, 404);
  });
});

/** `/<摘要>` 不带斜杠时包里的相对引用会按 `/` 解析、全部落空 —— 补上斜杠。 */
void test("产品界面服务器: /<摘要> 补斜杠（308），相对引用才解析得对", async () => {
  await withServer(async (port) => {
    const res = await get(port, `bidproposal.localhost:${port}`, `/${SHA_A}`);
    assert.equal(res.status, 308);
    assert.equal(res.headers["location"], `/${SHA_A}/`);
    assert.match(String(res.headers["content-security-policy"] ?? ""), /connect-src 'none'/);
  });
});

/**
 * **同一个产品目录下的契约，界面的 origin 上取不到。** 判断「在不在里面」对着的是
 * 那一份界面包的目录，不是产品目录 —— 否则 `/<摘要>/../../1.0.0/ruyin.product.yaml`
 * 这类路径离契约只差一次规整。
 */
void test("产品界面服务器: 界面包之外的东西（同产品的契约）取不到", async () => {
  await withServer(async (port) => {
    const host = `bidproposal.localhost:${port}`;
    for (const path of [
      `/${SHA_A}/../../1.0.0/ruyin.product.yaml`,
      `/${SHA_A}/%2e%2e/%2e%2e/1.0.0/ruyin.product.yaml`,
      `/${SHA_A}/..%2f..%2f1.0.0%2fruyin.product.yaml`,
      "/1.0.0/ruyin.product.yaml",
    ]) {
      const res = await get(port, host, path);
      assert.ok(!res.body.includes("CONTRACT-NOT-FOR-THE-UI"), `${path} 漏出了契约`);
    }
  });
});

/**
 * **A 产品的 origin 下取不到 B 产品的任何文件。**
 *
 * 断言的是**回应体里没有那串秘密**，不只是状态码：状态码对了而内容漏了的写法是
 * 存在的。三个探针覆盖三种写法 —— 直接要、`..` 往上走、编码过的 `..`。
 */
void test("产品界面服务器: A 的 origin 下取不到 B 的文件（名字前缀相同也不行）", async () => {
  await withServer(async (port) => {
    const hostA = `bidproposal.localhost:${port}`;
    for (const path of [
      `/${SHA_B}/secret.js`,
      `/${SHA_A}/../../../bidproposal2/ui/${SHA_B}/secret.js`,
      `/${SHA_A}/%2e%2e/%2e%2e/%2e%2e/bidproposal2/ui/${SHA_B}/secret.js`,
    ]) {
      const res = await get(port, hostA, path);
      assert.ok(!res.body.includes("SECRET-OF-ANOTHER-PRODUCT"), `${path} 漏出了别的产品的文件`);
    }
    // 对照：用 B 自己的 origin 就取得到 —— 证明上面拦住的是「跨产品」，不是「文件不存在」。
    const own = await get(port, `bidproposal2.localhost:${port}`, `/${SHA_B}/secret.js`);
    assert.equal(own.status, 200);
  });
});

/**
 * 只认 `<产品>.localhost:<本端口>` 这一种 Host。裸 IP、裸 localhost、别的端口、
 * 别的域名、嵌套子域 —— 一律不认。
 *
 * 端口也要对上：Host 是客户端说了算的，只比子域不比端口，等于默许一个指向别处的
 * Host 头也能在这里取到文件。
 */
void test("产品界面服务器: 形状不对的 Host 一律 404", async () => {
  await withServer(async (port) => {
    for (const host of [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `bidproposal.localhost:${port + 1}`,
      `bidproposal.evil.com:${port}`,
      `a.bidproposal.localhost:${port}`,
      `-bad.localhost:${port}`,
    ]) {
      const res = await get(port, host, `/${SHA_A}/`);
      assert.equal(res.status, 404, host);
    }
  });
});

void test("productFromHost: 只认合规的产品标签，大小写不敏感", () => {
  assert.equal(productFromHost("bidproposal.localhost:7421", 7421), "bidproposal");
  assert.equal(productFromHost("BidProposal.LOCALHOST:7421", 7421), "bidproposal");
  assert.equal(productFromHost("bid_proposal.localhost:7421", 7421), undefined, "下划线不是合法 DNS 标签");
  assert.equal(productFromHost(undefined, 7421), undefined);
});

/**
 * **这台服务器上一个 API 都没有。** 把 `/bridge` 或 `/projects` 挂到产品界面的
 * origin 上，等于在沙箱墙上开一扇门。
 */
void test("产品界面服务器: 没有任何 API；写方法 405", async () => {
  await withServer(async (port) => {
    const host = `bidproposal.localhost:${port}`;
    for (const path of ["/bridge/context", "/projects", "/health", "/auth/session"]) {
      assert.equal((await get(port, host, path)).status, 404, path);
    }
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      assert.equal((await get(port, host, "/", method)).status, 405, method);
    }
  });
});

/**
 * 每个回应都带安全头 —— **失败的回应也带**。一个不带 CSP 的 404 页，就是沙箱墙上
 * 的一个缺口。两条最要紧的逐字钉住：`connect-src 'none'` 与 `frame-ancestors`。
 */
void test("产品界面服务器: 成功与失败的回应都带 CSP，且锁死外连与嵌入方", async () => {
  await withServer(async (port) => {
    const cases: Array<[string, string]> = [
      [`bidproposal.localhost:${port}`, `/${SHA_A}/`],
      [`bidproposal.localhost:${port}`, `/${SHA_A}/missing.js`],
      [`127.0.0.1:${port}`, "/"],
    ];
    for (const [host, path] of cases) {
      const res = await get(port, host, path);
      const csp = String(res.headers["content-security-policy"] ?? "");
      assert.match(csp, /connect-src 'none'/, `${host}${path} 缺 connect-src 'none'`);
      assert.ok(csp.includes(`frame-ancestors ${WORKSPACE}`), `${host}${path} 缺 frame-ancestors`);
      assert.equal(res.headers["x-content-type-options"], "nosniff");
    }
  });
});

/**
 * **守护进程端口是 0 时，产品界面也请求 0 —— 不是 1。**
 *
 * CI 教的：观察台冒烟用 `PORT=0`，第一版写「+1」于是请求了端口 1。Linux 上 1024 以下
 * 是特权端口，EACCES 直接把观察台带走；**Windows 没有这个限制**，本地一路绿。
 * 抽成纯函数钉住，这一支在任何系统上都测得到，不用等 Linux 来报。
 */
void test("productUiPortFor: 固定端口 +1；端口 0 仍是 0；显式给了就用显式的", () => {
  assert.equal(productUiPortFor(7420, {}), 7421);
  assert.equal(productUiPortFor(17420, {}), 17421);
  assert.equal(productUiPortFor(0, {}), 0, "端口 0 推成 1 是特权端口，Linux 上 EACCES");
  assert.equal(productUiPortFor(7420, { RUYIN_PRODUCT_UI_PORT: "9000" }), 9000);
  assert.equal(productUiPortFor(0, { RUYIN_PRODUCT_UI_PORT: "" }), 0, "空串不算显式给了");
});

/** 服务器按**实际绑到的**端口认 Host —— 系统分配端口时它也得认得出自己。 */
void test("产品界面服务器: 端口由系统分配时照样认得出自己的 Host", async () => {
  await withServer(async (port) => {
    assert.ok(port > 0);
    const res = await get(port, `bidproposal.localhost:${port}`, `/${SHA_A}/`);
    assert.equal(res.status, 200);
  });
});
