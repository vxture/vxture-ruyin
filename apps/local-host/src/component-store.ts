/**
 * 获取通道（ADR-018 §7.2；TD-042）—— 随包不带、要用户点一次才落到本机的载荷。
 *
 * 预置层的存在理由是气隙 / 域受限企业：客户的机器可能连不上 GitHub 与 npm，
 * 首启必须离线可用（§2.3）。而安装包已经很大。两条约束同时成立的唯一解是：
 * **能装进包、且没有网络时真有用的装进包；装不进的走一条经校验的通道，而那条
 * 通道必须有一种不需要网络的运输方式。** 所以这里有两条运输，走**完全同一段
 * 校验与落地代码**，只有取字节那一步不同：
 *
 *   POST /components/:id/acquire                      → HTTPS，从清单里那个 URL 取
 *   POST /components/:id/acquire { from: "E:\\…" }    → 本地文件 / 目录（U 盘、内网共享）
 *
 * 第二条是这份设计对气隙机器的真正回答：那台机器点不动下载按钮，但管理员可以把
 * 离线包里的 zip 指给它，**校验和还是随安装包同行的那一条**。
 *
 * ## 这里能证明什么、不能证明什么（照 registry-client.ts 的写法说清）
 *
 * 能证明的只有一件事：**落到盘上的字节，就是仓里那份清单说的那串摘要**。
 * 不证明上游主机的身份（TLS 之外什么都没有）、不验签名、任何函数都不返回
 * 「已验证」。安装包本身也未签名（TD-001 转 standing，owner 定不采购），所以
 * 这套的信任地板与 ruyin 其余部分**同高，不更高**；回执里 `signed: false` 照实写
 * （`verifySignature` 恒 false 的同一条纪律，TD-012）。
 *
 * 与产品包那条路（registry-client.ts）声称的是同一件事，区别只在**摘要从哪来**：
 * 那条路的 sha256 来自一份经 TLS 取回的 index.json（TD-037 明说清单本身可能被换）；
 * 这条路的 sha256 写在 `resources/skill-manifest.json` 里、随安装包同行、评审时有人
 * 看过、不经网络。上游若换了字节，校验不过，什么都不落地 —— 失败模式是「用不了」，
 * 不是「被换掉」。所以**不需要 `RUYIN_ALLOW_UNSIGNED_*` 那类开关**：信任锚随包
 * 而来，本来就在。
 *
 * ## 四道校验一条不减，加第五道
 *
 *   1. **协议必须是 https**，且 origin ∈ 清单的 `allowedOrigins`（发请求**之前**
 *      就查），**并且不跟任何重定向**（`redirect: "manual"`）—— 白名单是在发请求
 *      之前查的一份闭合名单，跟着 302 跳等于把「去哪台主机取」的决定权交给上游，
 *      默认的 `follow` 还允许跳 20 次。清单里那几条是直链，一次都不需要跳。
 *   2. 字节数不超过 `size`（超一个字节立即 abort，不等下完）
 *   3. 字节数等于 `size` 且 sha256 等于清单值
 *   4. 解压走 pkg.ts 那套护栏（穿越 / 反斜杠 / 绝对路径 / 控制字符 / 加密条目 /
 *      未知压缩方法 / zip64 / 重名一律拒）
 *   5. **许可证文件解压后必须存在** —— 缺一条即回滚整棵暂存树，获取算失败
 *
 * ## 「用的时候」也要看一眼（不是只在落地那一次）
 *
 * 落地之后有人会动那棵树：杀毒软件隔离掉 `headless_shell.exe`、用户清盘时删了
 * 半棵。回执还在，于是「已获取」照说不误，而 `pathOf` 交出的是一条指向空处的
 * 路径。所以判定收在 `acquiredTree` 一处，而它会查**回执里 `verify` 点名的那几个
 * 文件还在不在**。不重算整包 sha256：那是 120 MB 的一次磁盘读，而这个判定每次
 * 列出、每次 `plan()`、每次起服务器都要跑一遍。
 *
 * ## 「取不到」与「上游已经没有它了」是两回事
 *
 * 404 / 410 是**永久**的：清单里那条 pin 被上游删了（Chrome for Testing 会删旧
 * 构建），重试一百次还是 404，该说的是「这条 pin 没了，清单要更新」。网络错误、
 * 5xx、408、429 才是「等会儿再试」。摘要不符同样永久 —— 再点一次还是同一串字节。
 *
 * 唯一的实现改动是**流式**：registry-client.ts 的 `Buffer.from(await
 * res.arrayBuffer())` 把整个 body 收进内存，256 MB 的上限对 120 MB 的下载 /
 * 234 MB 的单个文件是错的形状。解压同理 —— 不建 `Map<string, Buffer>`，逐条目
 * 边解边写盘。
 *
 * ## v1 不做断点续传
 *
 * 失败或中断就删暂存、把原因说清楚、用户再点一次。**这不是疏漏**：续传会引入
 * 「续上来的那段前缀从没被校验过」的信任问题，而最大的一件也就 120 MB —— 重来
 * 比多一套信任面便宜。下一个人想补上它之前，先想清楚那段前缀由谁担保。
 *
 * ## 绝不下载的三种时机（硬规则，check-update-policy.mjs 钉住）
 *
 * 启动时；刷新清单时；**以及任务需要某个工具时**。最后一条最要紧：契约要的工具
 * 若落在未获取的组件后面，`startTask` 在开跑前按名拒绝（与缺技能、缺工具同一条
 * 既有路径，ADR-018 §7）。**模型的一次工具调用永远不能触发下载。** 反面教材是
 * 实测到的：executeautomation 的 dist/toolHandler.js 在启动失败时 spawn
 * `npx playwright install` —— 一次模型工具调用引发 311 MB 无人值守下载。
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { createInflateRaw } from "node:zlib";

import { assertSafeEntryName, PackageError } from "./pkg.js";

/** 清单里一条组件（载荷）的规格。随 resources/tools/index.json 进安装包。 */
export interface ComponentSpec {
  id: string;
  kind: string;
  version: string;
  /** 这份载荷解锁了哪些服务器（清单的双向闭合，lint:skill-manifest 第 7 条）。 */
  unlocks: string[];
  source: { url: string };
  sha256: string;
  size: number;
  unpackedBytes: number;
  install: { kind: "zip"; into: string; expect?: string; marker?: string };
  license: string;
  licenseSource?: string;
  /** 解压后必须存在的许可证文件（相对 install.into）。缺一条即回滚。 */
  licenseFile: string[];
  redistribution: "redistributable" | "download-only";
  sourceOffer?: string;
  note?: string;
}

/**
 * 组件此刻的样子。**失败各说各的，绝不折叠进「未获取」** —— 照 updates.ts 里
 * `unreachable` 的先例：把「没问到」说成「问过了」，用户会以为是产品坏了。
 */
export type ComponentState =
  /** 装好了，回执在位。 */
  | "acquired"
  /** 没获取过，可以点。**这是一个正常状态，不是错误。** */
  | "not-acquired"
  /** 正在取。 */
  | "acquiring"
  /** 网络到不了（离线时就是这一种）。**这一种可以重试**：5xx / 408 / 429 也算。 */
  | "unreachable"
  /**
   * 上游已经没有这个构建了（404 / 410）。**永久，不是「等会儿再试」** —— 清单里
   * 那条 pin 需要更新，重试一百次还是 404。
   */
  | "gone"
  /**
   * 回执在，载荷不在了（杀毒隔离、手工清盘）。**用时才发现的一种**，因此不能只在
   * 落地那一次判。
   */
  | "payload-missing"
  /** 字节到了但摘要 / 长度不符 —— 字节丢弃。**这是要说响的一种。** */
  | "mismatch"
  /** 磁盘不够，开工前就拒了，没白下。 */
  | "no-space"
  /** 声明的尺寸越过硬天花板，或对方发来的比声明的多。 */
  | "too-large"
  /** 解压后缺许可证文件 —— 整棵树回滚。 */
  | "license-missing"
  /** URL 的 origin 不在清单的白名单里，请求根本没发出去。 */
  | "refused-origin"
  /** 目标路径太长（Windows MAX_PATH，实测会发生）。 */
  | "path-too-long"
  /** 用户取消。 */
  | "cancelled"
  /** 其余（解压护栏拒绝、本地文件读不了…），reason 里说清。 */
  | "failed";

/** `GET /components` 返回的一条。界面按它渲染，点之前就看得见要下多少。 */
export interface ComponentStatus {
  id: string;
  kind: string;
  version: string;
  state: ComponentState;
  /** 要下多少字节。 */
  downloadBytes: number;
  /** 装完占多少盘。 */
  diskBytes: number;
  license: string;
  /** 从哪个主机来（界面显示在按钮左边）。 */
  origin: string;
  redistribution: "redistributable" | "download-only";
  unlocks: string[];
  /** acquiring 时的进度；别的状态没有。 */
  receivedBytes?: number;
  totalBytes?: number;
  /** 失败 / 未获取时那句话。 */
  reason?: string;
  acquiredAt?: string;
  transport?: "https" | "local";
  path?: string;
  sourceOffer?: string;
  note?: string;
}

/** 落在 `<dataDir>/c/<id>/<version>/.ruyin-component.json` 的回执。 */
export interface ComponentReceipt {
  id: string;
  version: string;
  sha256: string;
  size: number;
  acquiredAt: string;
  sourceUrl: string;
  /** **照实写取字节那一步真走的哪条路**，不是按参数猜的。 */
  transport: "https" | "local";
  licenseFile: string[];
  /**
   * 用时要查还在不在的那几个相对路径（相对 `install.into`）：入口、marker、
   * 许可证。**记在回执里**而不是每次从清单推 —— 清单换了一版之后，这棵树当初
   * 按什么装的，只有它自己知道。
   */
  verify: string[];
  /** 照实写：这条通道不验签名，也没有可验的签名根（TD-012）。 */
  signed: false;
}

/** `acquiredTree` 的答案：装好了（给出路径与回执），或没有（并说清哪一种没有）。 */
type TreeCheck =
  | { ok: true; path: string; receipt: ComponentReceipt }
  | { ok: false; state?: ComponentState; reason?: string };

export class ComponentError extends Error {
  constructor(
    readonly state: ComponentState,
    message: string,
  ) {
    super(message);
  }
}

const RECEIPT = ".ruyin-component.json";
/**
 * 单件载荷的硬天花板。按组件的 `unpackedBytes` 给上限，再加这一道 —— 清单是随包
 * 的、评审过的，但天花板挡的是「清单本身写错了一个数量级」。
 */
const MAX_COMPONENT_BYTES = 2 * 1024 * 1024 * 1024;
/**
 * `unpackedBytes` 是一次实测的近似，不是逐字节相等的承诺（上游重打一次包，几个
 * 字节的差别就会让严丝合缝的上限变成一次假失败）。留 25% 余量，再撞天花板。
 */
const UNPACK_SLACK = 1.25;
/**
 * 目标根路径的长度阈值。Windows 的 MAX_PATH 是**实测会发生**的失败：深路径下
 * docling[local] 的一个 sdist 构建直接报 `No such file or directory`，换到
 * `C:\uvt` 就过。所以落盘路径刻意短：`<dataDir>\c\<id>\<version>\`，而不是
 * `<dataDir>\components\<id>\<version>\payload\`。
 */
const MAX_TARGET_ROOT = 120;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export interface ComponentStoreOptions {
  dataDir: string;
  components: () => ComponentSpec[];
  /** 清单的闭合白名单。空 = 一条 HTTPS 都不许发（本地文件那条路照常）。 */
  allowedOrigins: () => string[];
  fetchImpl?: typeof fetch;
  /** 磁盘可用字节；缺省真的问一次文件系统。注入是为了测试。 */
  freeBytes?: (dir: string) => number;
  /** 有东西变了（只说什么变了、不带数值 —— events.ts 的既有规矩）。 */
  onChanged?: (id: string) => void;
  now?: () => string;
}

/** 取字节那一步的答案：摘要，加上**真走了哪条运输**（回执照这个写）。 */
interface Fetched {
  digest: string;
  transport: "https" | "local";
}

interface Progress {
  receivedBytes: number;
  totalBytes: number;
  controller: AbortController;
}

export class ComponentStore {
  private readonly root: string;
  private readonly staging: string;
  private readonly inFlight = new Map<string, Progress>();
  /** 上一次失败的原因，按 id 记 —— 界面刷新时还看得见（不是「未获取」）。 */
  private readonly lastFailure = new Map<string, { state: ComponentState; reason: string }>();
  private lastEventAt = 0;

  constructor(private readonly options: ComponentStoreOptions) {
    this.root = join(options.dataDir, "c");
    this.staging = join(this.root, ".staging");
  }

  /**
   * 装好的那棵树在哪（未获取、或树已经不在了就是 undefined）。tool-servers.ts 的
   * 解析顺序用它。
   *
   * **判定只有 `acquiredTree` 一处**：上一版这里只看回执在不在，而 `statusOf` 另
   * 解析一遍并可能说「失败」—— 于是一份截断的回执让界面显示失败，启动路径却照样
   * 把那棵树交给 playwright。两个函数各判各的，就一定会有一天说不到一块去。
   */
  pathOf(id: string): string | undefined {
    const spec = this.spec(id);
    if (!spec) return undefined;
    const found = this.acquiredTree(spec);
    return found.ok ? found.path : undefined;
  }

  isAcquired(id: string): boolean {
    return this.pathOf(id) !== undefined;
  }

  spec(id: string): ComponentSpec | undefined {
    return this.options.components().find((c) => c.id === id);
  }

  list(): ComponentStatus[] {
    return this.options.components().map((c) => this.statusOf(c));
  }

  status(id: string): ComponentStatus | undefined {
    const spec = this.spec(id);
    return spec ? this.statusOf(spec) : undefined;
  }

  /** 取消一次进行中的获取。没在跑就回 false（不是错误）。 */
  cancel(id: string): boolean {
    const live = this.inFlight.get(id);
    if (!live) return false;
    live.controller.abort();
    return true;
  }

  /** 把已获取的那棵树删掉。用户点「移除」。 */
  remove(id: string): boolean {
    const spec = this.spec(id);
    if (!spec) return false;
    const dir = join(this.root, spec.id, spec.version);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    this.lastFailure.delete(id);
    this.options.onChanged?.(id);
    return true;
  }

  /**
   * 获取一件载荷。**只有用户点了才走到这里** —— 启动路径、清单刷新、模型与任务
   * 路径都不许调它（check-update-policy.mjs 钉住这三处）。
   *
   * `from` 给了就走本地文件那条路：一个 zip，或一个按 `<id>-<version>.zip` 命名
   * 的离线目录。校验与落地和 HTTPS 那条完全一样。
   */
  async acquire(id: string, opts: { from?: string } = {}): Promise<ComponentStatus> {
    const spec = this.spec(id);
    if (!spec) throw new ComponentError("failed", `"${id}" 不在预置清单的组件表里`);
    if (this.isAcquired(id)) return this.statusOf(spec);
    if (this.inFlight.has(id)) throw new ComponentError("failed", `"${id}" 正在获取中`);

    const controller = new AbortController();
    this.inFlight.set(id, { receivedBytes: 0, totalBytes: spec.size, controller });
    this.lastFailure.delete(id);
    this.emit(id, true);
    const part = join(this.staging, `${safeStem(spec)}.part`);
    const tree = join(this.staging, `${safeStem(spec)}.tree`);
    try {
      // 1. 开工前先拒：磁盘不够就当场报数字，不下 114 MB 再失败。
      this.assertRoom(spec);
      this.assertPathLength(spec);
      mkdirSync(this.staging, { recursive: true });
      rmSync(part, { force: true });
      rmSync(tree, { recursive: true, force: true });

      // 2. 取字节（两条运输，之后完全共用）。**运输方式由真走了哪条路报回来**，
      //    不是按参数推的 —— HTTPS 那条要先证明自己真是 https，才有资格这么写。
      const { digest, transport } = opts.from
        ? await this.copyLocal(spec, opts.from, part, controller.signal, id)
        : await this.download(spec, part, controller.signal, id);

      // 3. 校验。任一不符即删暂存、报错 —— 字节丢弃，不留半成品。
      const bytes = statSync(part).size;
      if (bytes !== spec.size) {
        throw new ComponentError("mismatch", `取到 ${bytes} 字节，清单说 ${spec.size}`);
      }
      if (digest !== spec.sha256) {
        throw new ComponentError("mismatch", `sha256 ${digest} 与清单的 ${spec.sha256} 不符 —— 字节已丢弃`);
      }

      // 4. 校验之后才解压。
      const into = join(tree, spec.install.into);
      await unpackZipStreaming(part, into, spec.unpackedBytes);
      if (spec.install.expect && !existsSync(join(into, spec.install.expect))) {
        throw new ComponentError("failed", `解压后没有 ${spec.install.expect}`);
      }

      // 5. 许可证必须随树同行 —— 缺一条即回滚整棵暂存树。
      for (const rel of spec.licenseFile) {
        assertSafeEntryName(rel);
        if (!existsSync(join(into, rel))) {
          throw new ComponentError("license-missing", `解压后缺许可证文件 ${rel} —— 整棵树已回滚`);
        }
      }
      if (spec.install.marker) writeFileSync(join(into, spec.install.marker), "");

      // 6. 落地是一次改名（同盘原子，installer.ts 的先例）。半棵树永远不会被
      //    plan() 看成装好了 —— 回执和树是同一次 rename 进去的。
      const receipt: ComponentReceipt = {
        id: spec.id,
        version: spec.version,
        sha256: spec.sha256,
        size: spec.size,
        acquiredAt: this.options.now?.() ?? new Date().toISOString(),
        sourceUrl: transport === "local" ? String(opts.from) : spec.source.url,
        transport,
        licenseFile: [...spec.licenseFile],
        // 用时查这几个还在不在（见 acquiredTree）。刚刚每一个都核过存在，所以
        // 记下来的是**这一棵树当初确实有过什么**，而不是清单以后会说什么。
        verify: verifyList(spec),
        signed: false,
      };
      writeFileSync(join(tree, RECEIPT), JSON.stringify(receipt, null, 2));
      const target = join(this.root, spec.id, spec.version);
      mkdirSync(dirname(target), { recursive: true });
      rmSync(target, { recursive: true, force: true });
      renameSync(tree, target);
      this.writeNotices();
    } catch (cause) {
      const state = cause instanceof ComponentError ? cause.state : "failed";
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.lastFailure.set(id, { state, reason });
      throw cause instanceof ComponentError ? cause : new ComponentError("failed", reason);
    } finally {
      rmSync(part, { force: true });
      rmSync(tree, { recursive: true, force: true });
      this.inFlight.delete(id);
      this.emit(id, true);
    }
    // 状态在 finally 之后再算：在 try 里算，inFlight 还没清，回给调用方的会是
    // 「获取中」—— 一次刚刚成功的获取报成进行中，界面会一直转着那个圈。
    return this.statusOf(spec);
  }

  /**
   * 一个离线目录整体导入：按 `<id>-<version>.zip` 的文件名自动配对。
   * 离线客户拿到的 `Ruyin-Offline-Tools-<version>.zip` 解开就是这个形状。
   */
  async acquireFromDir(dir: string): Promise<{ acquired: string[]; skipped: Array<{ id: string; reason: string }> }> {
    const acquired: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const spec of this.options.components()) {
      if (this.isAcquired(spec.id)) {
        skipped.push({ id: spec.id, reason: "已获取" });
        continue;
      }
      const file = join(dir, `${spec.id}-${spec.version}.zip`);
      if (!existsSync(file)) {
        skipped.push({ id: spec.id, reason: `目录里没有 ${spec.id}-${spec.version}.zip` });
        continue;
      }
      try {
        await this.acquire(spec.id, { from: file });
        acquired.push(spec.id);
      } catch (cause) {
        skipped.push({ id: spec.id, reason: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    return { acquired, skipped };
  }

  // ---- 内部 ---------------------------------------------------------------

  /**
   * 「这件到底算不算装好了」**只在这里判**，`pathOf` / `isAcquired` / `statusOf` /
   * `writeNotices` 全走它。
   *
   * 四件事按顺序看：回执在不在 → 读不读得出来 → 是不是按清单现在这条摘要装的 →
   * **它点名的那几个文件还在不在**。最后一条是「用时才知道」的一种坏：杀毒软件把
   * `headless_shell.exe` 隔离走、用户清盘时删了半棵树 —— 回执还在，上一版照样报
   * 「已获取」，而 `pathOf` 交出的路径指向空处，浏览器梯子把它递给 playwright，
   * 用户看到的是一句 playwright 的报错。
   *
   * **不重算整包 sha256。** 那是一次 120 MB 的磁盘读，而这个判定在每次列出、每次
   * `plan()`、每次起服务器时都要跑一遍 —— 几秒的停顿会被当成界面卡死。字节的校验
   * 发生在落地那一次（长度 + sha256，且校验之前一个字节都不进最终位置）；这里查的
   * 是**落地之后有没有人动过它**，靠回执里 `verify` 记下的入口 / marker / 许可证
   * 文件。少一个就是不算数。
   */
  private acquiredTree(spec: ComponentSpec): TreeCheck {
    const dir = join(this.root, spec.id, spec.version);
    const receiptFile = join(dir, RECEIPT);
    if (!existsSync(receiptFile)) return { ok: false };
    let receipt: ComponentReceipt;
    try {
      const parsed = JSON.parse(readFileSync(receiptFile, "utf8")) as ComponentReceipt;
      if (!parsed || typeof parsed !== "object" || typeof parsed.sha256 !== "string") throw new Error("回执缺字段");
      receipt = parsed;
    } catch {
      // 回执读不了 = 这棵树不算数。宁可让用户再取一次，也不谎称装好了。
      return { ok: false, state: "failed", reason: "回执读不了，这棵树不算数 —— 移除后再取一次" };
    }
    if (receipt.sha256 !== spec.sha256) {
      return {
        ok: false,
        state: "mismatch",
        reason: "这棵树是按另一条摘要装的（清单更新过了）—— 移除后重新获取",
      };
    }
    const path = join(dir, spec.install.into);
    const must = Array.isArray(receipt.verify) && receipt.verify.length > 0 ? receipt.verify : verifyList(spec);
    for (const rel of must) {
      if (!existsSync(join(path, rel))) {
        return {
          ok: false,
          state: "payload-missing",
          reason: `回执在，载荷里的 ${rel} 不在了（杀毒隔离、手工清盘都会这样）—— 移除后重新获取`,
        };
      }
    }
    return { ok: true, path, receipt };
  }

  private statusOf(spec: ComponentSpec): ComponentStatus {
    const base: ComponentStatus = {
      id: spec.id,
      kind: spec.kind,
      version: spec.version,
      state: "not-acquired",
      downloadBytes: spec.size,
      diskBytes: spec.unpackedBytes,
      license: spec.license,
      origin: hostOf(spec.source.url),
      redistribution: spec.redistribution,
      unlocks: [...spec.unlocks],
      ...(spec.sourceOffer ? { sourceOffer: spec.sourceOffer } : {}),
      ...(spec.note ? { note: spec.note } : {}),
    };
    const live = this.inFlight.get(spec.id);
    if (live) {
      return { ...base, state: "acquiring", receivedBytes: live.receivedBytes, totalBytes: live.totalBytes };
    }
    // 与 pathOf 同一个判定函数：界面说「已获取」的那一刻，启动路径拿到的一定是
    // 同一个答案。
    const found = this.acquiredTree(spec);
    if (found.ok) {
      return {
        ...base,
        state: "acquired",
        acquiredAt: found.receipt.acquiredAt,
        transport: found.receipt.transport,
        path: found.path,
      };
    }
    if (found.state) return { ...base, state: found.state, reason: found.reason ?? "" };
    const failed = this.lastFailure.get(spec.id);
    if (failed) return { ...base, state: failed.state, reason: failed.reason };
    return base;
  }

  private assertRoom(spec: ComponentSpec): void {
    if (spec.size > MAX_COMPONENT_BYTES || spec.unpackedBytes > MAX_COMPONENT_BYTES) {
      throw new ComponentError("too-large", `清单说这件要 ${spec.size} 字节 / 占盘 ${spec.unpackedBytes}，越过 ${MAX_COMPONENT_BYTES} 的天花板`);
    }
    mkdirSync(this.root, { recursive: true });
    const free = this.options.freeBytes ? this.options.freeBytes(this.root) : freeBytesOf(this.root);
    const need = spec.size + spec.unpackedBytes;
    if (free >= 0 && free < need) {
      throw new ComponentError(
        "no-space",
        `磁盘还剩 ${mib(free)}，这一件要 ${mib(spec.size)} 下载加 ${mib(spec.unpackedBytes)} 占盘（共 ${mib(need)}）`,
      );
    }
  }

  private assertPathLength(spec: ComponentSpec): void {
    const target = join(this.root, spec.id, spec.version, spec.install.into);
    if (target.length > MAX_TARGET_ROOT) {
      throw new ComponentError(
        "path-too-long",
        `落盘路径 ${target.length} 字符，超过 ${MAX_TARGET_ROOT} —— Windows 的 MAX_PATH 会在解压深路径时炸，` +
          `把数据目录换到更短的路径（设置 → 数据位置）再试`,
      );
    }
  }

  /** HTTPS：协议 + origin 白名单 + 不跟跳 → 流式落盘 → 边写边算摘要。超了就地 abort。 */
  private async download(spec: ComponentSpec, part: string, signal: AbortSignal, id: string): Promise<Fetched> {
    let url: URL;
    try {
      url = new URL(spec.source.url);
    } catch {
      throw new ComponentError("failed", `组件的 url 不是合法 url：${spec.source.url}`);
    }
    // 协议先查。`new URL("http://cdn.example").origin` 会等于一条写成 http 的白名单
    // 项 —— 光比 origin，明文那条会从白名单的缝里过去，而回执上照写 `https`。
    if (url.protocol !== "https:") {
      throw new ComponentError("refused-origin", `组件的 url 不是 https：${url.protocol}//… —— 明文取字节这条路不存在`);
    }
    // 白名单化的同源规则：registry-client.ts 钉的是「索引自己的 origin」，这里放宽
    // 成一份闭合白名单 —— pandoc 与 Chrome for Testing 我们没有再分发权，镜像到
    // 自己的主机本身就是再分发，所以必须允许指向上游。
    const allowed = new Set(this.options.allowedOrigins());
    if (!allowed.has(url.origin)) {
      throw new ComponentError("refused-origin", `${url.origin} 不在清单的 allowedOrigins 里，请求没有发出`);
    }
    const doFetch = this.options.fetchImpl ?? fetch;
    let res: Response;
    try {
      // **`redirect: "manual"` 不能省。** 缺省的 `follow` 允许跳 20 次，而每一次
      // 都可以跳到白名单外的任意主机 —— 那道「发请求之前查的闭合白名单」就只挡住
      // 了第一跳。清单里那几条是直链，一次都不需要跳。
      res = await doFetch(url, { signal, redirect: "manual" });
    } catch (cause) {
      if (signal.aborted) throw new ComponentError("cancelled", "已取消");
      throw new ComponentError("unreachable", `取不到 ${url.origin}：${cause instanceof Error ? cause.message : String(cause)}`);
    }
    // 3xx（以及 fetch 规范里那个 status 为 0 的 opaqueredirect）一律拒：跟着跳等于
    // 让上游选目的地。要换地址就改清单里那条 pin，那一行有人评审过。
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      const to = res.headers.get("location") ?? "（未给 Location）";
      throw new ComponentError(
        "refused-origin",
        `${url.origin} 要把请求重定向到 ${to} —— 白名单是发请求之前查的一份闭合名单，这里不跟跳；要换地址就改清单里那条 pin`,
      );
    }
    if (!res.ok) throw this.httpFailure(spec, url, res.status);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > spec.size) {
      throw new ComponentError("too-large", `对方声明 ${declared} 字节，清单说 ${spec.size}`);
    }
    if (!res.body) throw new ComponentError("unreachable", "下载没有响应体");
    const digest = await this.drain(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), spec, part, signal, id);
    return { digest, transport: "https" };
  }

  /**
   * HTTP 状态分两类，**因为「要不要再点一次」的答案相反**。
   *
   * 404 / 410：上游把这个构建删了（Chrome for Testing 明确会删旧版本）。这是永久的
   * ——「等会儿再试」是一句假话，该说的是「清单里那条 pin 没了，得更新清单」。
   * 5xx / 408 / 429：对面此刻不行，等会儿真的可能行。
   * 其余（401 / 403 …）：也不是重试能解决的，但原因不明，照实报状态码。
   */
  private httpFailure(spec: ComponentSpec, url: URL, status: number): ComponentError {
    if (status === 404 || status === 410) {
      return new ComponentError(
        "gone",
        `${url.host} 上已经没有这个构建了（HTTP ${status}）—— 清单里 ${spec.id} ${spec.version} 那条 pin 需要更新，重试没有用`,
      );
    }
    if (status === 408 || status === 429 || status >= 500) {
      return new ComponentError("unreachable", `下载返回 HTTP ${status} —— 对方此刻不行，等会儿再试`);
    }
    return new ComponentError("failed", `下载返回 HTTP ${status}`);
  }

  /** 本地文件 / 目录：气隙机器那条路。取字节之外的每一步都和 HTTPS 一样。 */
  private async copyLocal(spec: ComponentSpec, from: string, part: string, signal: AbortSignal, id: string): Promise<Fetched> {
    let file = resolve(from);
    if (!existsSync(file)) throw new ComponentError("failed", `本地文件不存在：${file}`);
    if (statSync(file).isDirectory()) {
      const named = join(file, `${spec.id}-${spec.version}.zip`);
      if (!existsSync(named)) {
        throw new ComponentError("failed", `目录 ${file} 里没有 ${spec.id}-${spec.version}.zip`);
      }
      file = named;
    }
    const digest = await this.drain(createReadStream(file), spec, part, signal, id);
    return { digest, transport: "local" };
  }

  /** 边写盘边算摘要，字节数一超 size 立即停 —— 不能等下完再看。 */
  private async drain(source: NodeJS.ReadableStream, spec: ComponentSpec, part: string, signal: AbortSignal, id: string): Promise<string> {
    const hash = createHash("sha256");
    let received = 0;
    const live = this.inFlight.get(id);
    const meter = new Transform({
      transform: (chunk: Buffer, _enc, done) => {
        if (signal.aborted) return done(new ComponentError("cancelled", "已取消"));
        received += chunk.length;
        // 超一个字节就停。等下完再看，等于替对方把 3 GB 写进用户的盘。
        if (received > spec.size) {
          return done(new ComponentError("too-large", `对方发来的字节已超过清单说的 ${spec.size}`));
        }
        hash.update(chunk);
        if (live) live.receivedBytes = received;
        this.emit(id, false);
        done(null, chunk);
      },
    });
    try {
      await pipeline(source, meter, createWriteStream(part));
    } catch (cause) {
      if (signal.aborted && !(cause instanceof ComponentError)) throw new ComponentError("cancelled", "已取消");
      if (cause instanceof ComponentError) throw cause;
      throw new ComponentError("unreachable", `传输中断：${cause instanceof Error ? cause.message : String(cause)}`);
    }
    return hash.digest("hex");
  }

  /** 装完的许可证汇总一处，界面上「许可证」那一行点得开。 */
  private writeNotices(): void {
    const lines = ["# 已获取组件的许可证", "", "由 ruyin 的获取通道在每次成功获取后重写（ADR-018 §7.2）。", ""];
    for (const spec of this.options.components()) {
      // 同一个判定：汇总里只写真的装着、且正文还在的那几件。
      const found = this.acquiredTree(spec);
      if (!found.ok) continue;
      lines.push(`## ${spec.id} ${spec.version}`, "", `- 许可证：${spec.license}`, `- 来源：${spec.source.url}`);
      if (spec.sourceOffer) lines.push(`- 源码：${spec.sourceOffer}`);
      for (const rel of spec.licenseFile) lines.push(`- 正文：${join(found.path, rel)}`);
      lines.push("");
    }
    mkdirSync(this.root, { recursive: true });
    writeFileSync(join(this.root, "NOTICES.md"), lines.join("\n"));
  }

  /** 事件节流到约每秒一次：进度是连续的，事件不该是。 */
  private emit(id: string, force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastEventAt < 1000) return;
    this.lastEventAt = now;
    this.options.onChanged?.(id);
  }
}

/**
 * 用时要查还在不在的那几个相对路径：入口、marker、许可证正文。
 *
 * 为什么是这三类：入口不在 = 交给 playwright 的路径指向空处；marker 不在 =
 * playwright 自己会认为这棵浏览器树没装完；许可证不在 = 我们分发它的前提没了
 * （落地那一次的第五道校验，删了之后同样不成立）。
 */
function verifyList(spec: ComponentSpec): string[] {
  return [
    ...(spec.install.expect ? [spec.install.expect] : []),
    ...(spec.install.marker ? [spec.install.marker] : []),
    ...spec.licenseFile,
  ].filter((rel, i, all) => all.indexOf(rel) === i);
}

function safeStem(spec: ComponentSpec): string {
  return `${spec.id}@${spec.version}`.replace(/[^A-Za-z0-9._@-]/g, "_");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function mib(n: number): string {
  return `${(n / 1048576).toFixed(1)} MB`;
}

function freeBytesOf(dir: string): number {
  try {
    const fs = statfsSync(dir);
    return Number(fs.bavail) * Number(fs.bsize);
  } catch {
    // 问不到就别拦：一个问不出磁盘余量的文件系统上，拒绝获取比让它试一次更糟。
    return -1;
  }
}

/**
 * 逐条目流式解压。
 *
 * **为什么不用 pkg.ts 的 readPackage**：那一份把整个包读进 `Buffer`、把每个条目
 * 解成 `Buffer` 存进 `Map`，上限是单条目 64 MB / 全包 256 MB —— 对产品包合适，
 * 对组件是错的形状：pandoc.exe 一个文件就 233,626,888 B，chromium 解开 270 MB。
 * 所以这里另起一份读法：头部解析照抄同一套判断，**条目名护栏直接 import 复用**
 * （复制出来的护栏会各自漂移），数据部分边解边写盘，一个字节都不驻留。
 *
 * 上限按调用方给的 `unpackedBytes` 定，再撞一道硬天花板。
 */
export async function unpackZipStreaming(zipPath: string, destDir: string, unpackedBytes: number): Promise<void> {
  const cap = Math.min(Math.ceil(Math.max(unpackedBytes, 1024) * UNPACK_SLACK), MAX_COMPONENT_BYTES);
  const fd = openSync(zipPath, "r");
  try {
    const fileSize = statSync(zipPath).size;
    const eocd = findEocd(fd, fileSize);
    const entryCount = eocd.readUInt16LE(10);
    const centralSize = eocd.readUInt32LE(12);
    const centralOffset = eocd.readUInt32LE(16);
    if (entryCount === 0xffff || centralOffset === 0xffffffff) {
      throw new PackageError("zip64 containers are not supported");
    }
    if (centralOffset + centralSize > fileSize) throw new PackageError("central directory out of bounds");
    const central = readAt(fd, centralOffset, centralSize);

    const seen = new Set<string>();
    let total = 0;
    let p = 0;
    mkdirSync(destDir, { recursive: true });
    for (let i = 0; i < entryCount; i++) {
      if (p + 46 > central.length || central.readUInt32LE(p) !== SIG_CENTRAL) {
        throw new PackageError("malformed central directory header");
      }
      const flags = central.readUInt16LE(p + 8);
      const method = central.readUInt16LE(p + 10);
      const compressedSize = central.readUInt32LE(p + 20);
      const uncompressedSize = central.readUInt32LE(p + 24);
      const nameLen = central.readUInt16LE(p + 28);
      const extraLen = central.readUInt16LE(p + 30);
      const commentLen = central.readUInt16LE(p + 32);
      const localOffset = central.readUInt32LE(p + 42);
      const name = central.toString("utf8", p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;

      if (name.endsWith("/")) continue;
      assertSafeEntryName(name);
      if ((flags & 0x0001) !== 0) throw new PackageError(`encrypted entry not supported: ${name}`);
      if (method !== 0 && method !== 8) throw new PackageError(`unsupported compression method ${method}: ${name}`);
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
        throw new PackageError(`zip64 sizes not supported: ${name}`);
      }
      if (seen.has(name)) throw new PackageError(`duplicate entry: ${name}`);
      seen.add(name);
      total += uncompressedSize;
      if (total > cap) throw new PackageError(`unpacked size exceeds the ${cap}-byte limit for this component`);

      const local = readAt(fd, localOffset, 30);
      if (local.readUInt32LE(0) !== SIG_LOCAL) throw new PackageError(`malformed local header: ${name}`);
      const dataStart = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (dataStart + compressedSize > fileSize) throw new PackageError(`entry data out of bounds: ${name}`);

      const out = join(destDir, name);
      mkdirSync(dirname(out), { recursive: true });
      const sink = createWriteStream(out);
      const reader = createReadStream("", { fd, start: dataStart, end: dataStart + compressedSize - 1, autoClose: false });
      // maxOutputLength 是解压炸弹的那道闸：一个条目声称 1 KB 却解出 4 GB，
      // 没有这个上限时会先把内存吃光，再报别的错。
      await (method === 0 ? pipeline(reader, sink) : pipeline(reader, createInflateRaw({ maxOutputLength: cap }), sink));
      if (sink.bytesWritten !== uncompressedSize) throw new PackageError(`entry size mismatch: ${name}`);
    }
  } finally {
    closeSync(fd);
  }
}

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const read = readSync(fd, buf, 0, length, position);
  if (read !== length) throw new PackageError("unexpected end of zip container");
  return buf;
}

/** 从尾部定位 EOCD（允许有 comment）—— 与 pkg.ts 同一条读法，只是不整包读进内存。 */
function findEocd(fd: number, fileSize: number): Buffer {
  const min = 22;
  if (fileSize < min) throw new PackageError("not a zip container (too small)");
  const window = Math.min(fileSize, min + 0xffff);
  const tail = readAt(fd, fileSize - window, window);
  for (let i = tail.length - min; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD) return tail.subarray(i);
  }
  throw new PackageError("zip end-of-central-directory not found");
}

/** 读随包索引里的组件表（`resources/tools/index.json`）。缺就是没有获取通道。 */
/**
 * 清单里的 id / version —— 它们**是路径段**（`<root>/<id>/<version>/`、离线包名
 * `<id>-<version>.zip`），所以必须当路径段来查，不能只查「是不是字符串」。
 *
 * 为什么单列一条而不是复用 `assertSafeEntryName`：那一条允许 `a/b` 这种多段
 * 相对路径（包内条目本来就有目录），而 id 与 version 只能是**一段**。一个带
 * `/` 的 id 会把组件树种到别人家里去，而它读起来完全正常。
 */
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function isSafeSegment(value: unknown): value is string {
  return typeof value === "string" && PATH_SEGMENT.test(value) && !value.includes("..");
}

/**
 * 清单条目里所有会被当路径用的字段，一次查完。
 *
 * `licenseFile` 此前是**唯一**过了 `assertSafeEntryName` 的那个（解压后那一步），
 * 而它的三个兄弟 `install.into` / `install.expect` / `install.marker` 一路直接
 * 进 `join()` —— 护栏用在四个同类字段里的一个，比四个都没有更难发现。
 */
function specPathsAreSafe(c: ComponentSpec, warn?: (line: string) => void): boolean {
  const bad = (why: string): false => {
    warn?.(`[ruyin] components: 跳过条目 ${String((c as { id?: unknown }).id).slice(0, 64)} —— ${why}`);
    return false;
  };
  if (!isSafeSegment(c.id)) return bad("id 不是一个合法的路径段");
  if (!isSafeSegment(c.version)) return bad("version 不是一个合法的路径段");
  const install = c.install as { into?: unknown; expect?: unknown; marker?: unknown } | undefined;
  if (!install || typeof install.into !== "string") return bad("install.into 缺失");
  for (const [key, value] of [
    ["install.into", install.into],
    ["install.expect", install.expect],
    ["install.marker", install.marker],
  ] as const) {
    if (value === undefined) continue;
    try {
      assertSafeEntryName(value as string);
    } catch (cause) {
      return bad(`${key} 不安全：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  for (const rel of Array.isArray(c.licenseFile) ? c.licenseFile : []) {
    try {
      assertSafeEntryName(rel);
    } catch (cause) {
      return bad(`licenseFile 不安全：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return true;
}

export function readComponentSpecs(indexFile: string, warn?: (line: string) => void): { components: ComponentSpec[]; allowedOrigins: string[] } {
  try {
    const parsed = JSON.parse(readFileSync(indexFile, "utf8")) as {
      components?: unknown;
      allowedOrigins?: unknown;
    };
    // 不安全的条目**在这里就消失**，不是留到用的时候再查：留下来它就会被
    // 界面列出来、被 acquire 找到，而每一处都得记得自己再查一遍。
    const components = Array.isArray(parsed.components)
      ? (parsed.components as ComponentSpec[]).filter(
          (c) => c && typeof c.id === "string" && /^[0-9a-f]{64}$/.test(c.sha256) && specPathsAreSafe(c, warn),
        )
      : [];
    const allowedOrigins = Array.isArray(parsed.allowedOrigins) ? (parsed.allowedOrigins as string[]).map(String) : [];
    return { components, allowedOrigins };
  } catch {
    return { components: [], allowedOrigins: [] };
  }
}

/** 离线目录里都有些什么（界面上「从本地文件导入」用来先告诉用户会装哪几件）。 */
export function scanOfflineDir(dir: string, specs: ComponentSpec[]): Array<{ id: string; file: string }> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const files = new Set(readdirSync(dir));
  return specs
    .filter((s) => files.has(`${s.id}-${s.version}.zip`))
    .map((s) => ({ id: s.id, file: join(dir, `${s.id}-${s.version}.zip`) }));
}
