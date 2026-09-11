/**
 * 「这个路径在不在那个根目录里」—— **只有这一种写法是对的**。
 *
 * 此前 `server.ts` 的 `serveStatic` 用的是 `full.startsWith(resolve(root))`。那是
 * 一个经典错误：不带分隔符比前缀，**名字以根目录名开头的兄弟目录也会被放行**。
 * 根是 `…/product-ui/bidproposal` 时，`../bidproposal2/secret.js` 与
 * `../bidproposal-evil/x` 都解析成以 `…/product-ui/bidproposal` 开头的路径，于是
 * 被当成「在里面」（2026-09-10 实测过，四个样本见用例）。
 *
 * 对工作台自己的静态目录它今天打不穿 —— WHATWG URL 解析会先把 `..` 规整掉，还有
 * `/assets/` 前缀挡着。但产品界面服务器按产品 id 各放一个兄弟目录，`bidproposal`
 * 与 `bidproposal2` 正是它会咬到的形状：**一个产品能读到另一个产品的界面包**。
 *
 * 用 `path.relative` 而不是再拼一个分隔符去比前缀：Windows 上大小写、正反斜杠、
 * 盘符都能让「手拼分隔符」的写法换一种方式错一次。`relative` 已经把这些都处理了。
 */

import { isAbsolute, relative, resolve } from "node:path";

/** `full` 是否就是 `root` 本身、或落在 `root` 之下。两者都会先被解析成绝对路径。 */
export function isInside(root: string, full: string): boolean {
  const rel = relative(resolve(root), resolve(full));
  if (rel === "") return true;
  // 跨盘符时 `relative` 直接给回一个绝对路径 —— 那当然不在里面。
  if (isAbsolute(rel)) return false;
  // 只看**第一段**是不是 `..`：一个真叫 `..foo` 的目录名是合法的，不该被误伤。
  const first = rel.split(/[\\/]/)[0];
  return first !== "..";
}
