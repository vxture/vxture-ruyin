/**
 * 预置服务器**开了什么端口**（RY-001 §07 任务 50）。
 *
 * 起因是真机上实测到的一件事：`aas-ee.open-websearch` 默认在 **`0.0.0.0:3000`** 上
 * 开了一个 HTTP 服务器 —— 不是回环，是这台电脑的每一个网络接口。于是 Windows 弹出
 * 「是否允许 Node.js JavaScript Runtime 通信」，用户看到的是一个莫名其妙的弹窗；
 * 而**真正的问题是那个端口本身**：同一个局域网里的任何人都能访问它，而它是随包
 * 默认启用的工具，没有任何人被问过。
 *
 * 这一条**静态检查看不见**：它是某个第三方包在某个版本上的默认行为，藏在它自己的
 * 配置分支里。只有**真起一次、再去数一遍端口**才看得见 —— 所以审计放在打包冒烟里
 * （`pack.mjs` 断言那一行说「没有非回环监听」），与「装好的应用真起得来」同一个路子。
 *
 * 回环（127.0.0.1 / ::1）不算：守护进程自己就听在 127.0.0.1:7420，MCP 服务器要是
 * 用回环做进程间通信也没问题 —— 出不了这台机器。
 */

import { execFileSync } from "node:child_process";

export interface Listener {
  address: string;
  port: number;
  pid: number;
}

/** 回环地址：出不了这台机器，不在审计范围里。 */
export function isLoopback(address: string): boolean {
  const a = address.replace(/^\[|\]$/g, "").toLowerCase();
  return a === "::1" || a === "127.0.0.1" || a.startsWith("127.");
}

/**
 * `netstat -ano` 的 LISTENING 行。**只认监听行** —— 已建立的连接不是我们要问的问题。
 *
 * 形状（Windows，中英文系统都一样，状态词是英文）：
 * ```
 *   TCP    0.0.0.0:3000     0.0.0.0:0      LISTENING       23392
 *   TCP    [::]:7420        [::]:0         LISTENING       1234
 * ```
 */
export function parseNetstat(text: string): Listener[] {
  const out: Listener[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (!m) continue;
    out.push({ address: m[1]!, port: Number(m[2]), pid: Number(m[3]) });
  }
  return out;
}

/**
 * 这些进程里，谁在非回环地址上监听。
 *
 * `0.0.0.0` 与 `[::]` 是「所有接口」，正是要抓的那一种；具体的网卡地址同样算。
 */
export function nonLoopbackListeners(all: Listener[], pids: readonly number[]): Listener[] {
  const mine = new Set(pids);
  return all.filter((l) => mine.has(l.pid) && !isLoopback(l.address));
}

/**
 * 真去数一遍。**数不出来就说数不出来**（返回 `undefined`），不返回空数组 ——
 * 空数组读起来是「查过了，没有」，而那正是这条审计最不能撒的谎。
 */
export function auditListeners(pids: readonly number[]): Listener[] | undefined {
  if (pids.length === 0) return [];
  if (process.platform !== "win32") return undefined;
  try {
    const text = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true });
    return nonLoopbackListeners(parseNetstat(text), pids);
  } catch {
    return undefined;
  }
}

/** 给日志的一行。打包冒烟按它断言（pack.mjs）。 */
export function describeAudit(found: Listener[] | undefined): string {
  if (found === undefined) return "not checked (this platform cannot be asked)";
  if (found.length === 0) return "ok (no non-loopback listener)";
  return `FOUND ${found.map((l) => `${l.address}:${l.port} (pid ${l.pid})`).join(", ")}`;
}
