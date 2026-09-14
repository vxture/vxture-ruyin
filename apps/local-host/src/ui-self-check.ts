/**
 * 冒烟里的「工作台界面真的被端出来了」自检（TD-061）。
 *
 * 这里说的是守护进程从 `uiDir` 端出来的**工作台界面**（server.ts 的 `/` 与 `/assets/*`
 * 路由，即 apps/ui-workspace 的构建产物），不是产品界面 —— 本目录里 `ui-fetch.ts`
 * 与 `product-ui-server.ts` 说的都是后者（ADR-023），别接错服务器。
 *
 * 为什么要有它：壳的 `--smoke` 在 `openWindow()` 之前就宣布通过并退出，窗口要加载
 * 的那个 `/` 在冒烟里从没被人请求过。而 `/health` 在 resources/ui 缺席时照样 200 ——
 * 守护进程对 `RUYIN_UI_DIR` 不查存在性，它指向一个不存在的目录时 `/` 是 404 JSON；
 * 开发态没构建界面时退回 Dev Console，也是 200 text/html。三种样子里只有一种是用户
 * 会看到的界面，而冒烟此前对三种都说 OK —— 又是那句：**一条从没被走过的路径，坏了
 * 和好了长得一模一样。**
 *
 * 做的事：像浏览器一样取一次 `/`，再把页面引用的每个文件取一遍 —— `/assets/*`
 * 走静态路由，`/logo.svg` 走根级白名单（server.ts 里记着一次图标碎掉、控制台一声
 * 不响的事故），两条路各挡一层。Vite 的资产名带内容哈希，只能从端出来的页面里读，
 * 不能写死。取不到、取到的不是工作台界面、引用的文件缺一个或 MIME 端错 —— 都是
 * 「装进包不等于端得出来」的样子，各给一句指向根因的话，而不是一个状态码。
 *
 * 为什么「至少引用一个 /assets/*.js」能把 Dev Console 结构性地排除：`/assets/*` 与
 * 根级白名单两条路由都以 `deps.uiDir` 为前提（server.ts），而 Dev Console 只在 uiDir
 * 为空时才坐在 `/` 上 —— 它引用的任何资产都会落到令牌闸门上 401，所以它从不引用。
 * 这条判定与守护进程只路由 `/assets/` 是绑在一起的：vite 的 `build.assetsDir` 一改，
 * 两边一起坏，这里会红，而不是静默放过。
 *
 * 纯模块：不碰 fs，fetch 可注入 —— 为了能对着一个几行代码的假服务器把每条路都钉住。
 * 走 Node 自带的 fetch，与壳的 waitForHealth 同一个：它不读 HTTP_PROXY（除非开了
 * NODE_USE_ENV_PROXY，而那时壳的 /health 已经先死了）。`main.ts` 只负责把它排进冒烟
 * 序列（PDF 之前，理由见那里的注释）。
 */

export interface UiSelfCheckResult {
  /** 页面引用、且逐个取到的文件路径（不带前导斜杠，按出现顺序）。 */
  assets: string[];
  /** 页面与所有引用文件的字节数之和 —— 给日志一个能看出「太小了」的数。 */
  bytes: number;
}

export interface UiSelfCheckOptions {
  fetchImpl?: typeof fetch;
  /** 每个请求的期限。壳的 60 秒窗口是整条冒烟链共用的，这里不能挂太久。 */
  timeoutMs?: number;
}

/**
 * 从页面里读出它引用的文件：`<script src>` 与 `<link href>` 都算，只认根相对路径
 * （`/assets/...`、`/logo.svg`），带协议的、`data:` 的、`//` 开头的一律不算 —— 那些
 * 不是守护进程端出来的东西。去重、按出现顺序。
 */
export function assetRefs(html: string): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  // 注释里的引用不算：首页源码里就有一大段说明性的 <!-- --> —— 今天里面没有 href，
  // 但哪天有了，不该为一段注释去取一个并不存在的文件。做法是**按注释切段、只看注释
  // 之外的片段**，而不是把注释 replace 掉：这里不是在清洗输入（CodeQL 会把「删一次
  // <!-- … -->」判成不完整的清洗），只是在决定去哪些片段里找引用。查询串与片段也
  // 不处理：vite 不产出。
  for (const segment of html.split(/<!--[\s\S]*?-->/)) {
    // 负向后顾而不是 \b：`data-src=` 里 `-` 与 `s` 之间也算词边界，\b 挡不住它。
    for (const m of segment.matchAll(/(?<![\w-])(?:src|href)="([^"]+)"/g)) {
      const raw = m[1]!;
      if (!raw.startsWith("/") || raw.startsWith("//")) continue;
      const ref = raw.slice(1);
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs;
}

/** 浏览器会拒绝的 MIME 组合：状态码 200 而页面一片空白，就是这一类。 */
const EXPECTED_TYPE: Array<[ext: string, pattern: RegExp, why: string]> = [
  [".js", /javascript/, "浏览器不会把它当模块脚本执行"],
  [".css", /^text\/css/, "不是 text/css"],
  [".svg", /^image\/svg\+xml/, "不是 image/svg+xml"],
];

export async function checkWorkspaceUi(
  baseUrl: string,
  opts: UiSelfCheckOptions = {},
): Promise<UiSelfCheckResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const base = baseUrl.replace(/\/+$/, "");

  // 不带 Authorization：`/`、`/assets/*`、`/logo.svg` 本来就在令牌闸门之前，浏览器取
  // 它们时也不会带 —— 带了反而测不到「页面直接引用的东西能不能不凭令牌拿到」。
  const get = async (path: string): Promise<{ status: number; type: string; body: Uint8Array }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${path}`, { signal: controller.signal });
      return {
        status: res.status,
        type: res.headers.get("content-type") ?? "",
        body: new Uint8Array(await res.arrayBuffer()),
      };
    } catch (cause) {
      if (controller.signal.aborted) throw new Error(`GET ${path} 超过 ${timeoutMs} ms 没有应答`);
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  };

  const index = await get("/");
  if (index.status === 404) {
    throw new Error(
      "GET / 返回 404 —— uiDir 指向的目录里没有 index.html。打包态多半是 resources/ui 没装进包" +
        "（electron-builder.yml 的 extraResources）或壳传的 RUYIN_UI_DIR 指错；" +
        "开发态多半是 apps/ui-workspace/dist 空了，重跑 pnpm -r build",
    );
  }
  if (index.status !== 200) throw new Error(`GET / 返回 ${index.status}`);
  if (!/^text\/html/.test(index.type)) {
    throw new Error(`GET / 的 content-type 是「${index.type}」，不是 text/html`);
  }
  const html = new TextDecoder().decode(index.body);
  if (/Dev Console/.test(html)) {
    throw new Error(
      "GET / 端出来的是 Dev Console，不是工作台界面 —— 守护进程没拿到 uiDir" +
        "（打包态多半是壳没把 RUYIN_UI_DIR 传过去或传了空串；开发态多半是 apps/ui-workspace/dist 没构建）",
    );
  }
  const refs = assetRefs(html);
  if (!refs.some((r) => r.startsWith("assets/") && r.endsWith(".js"))) {
    throw new Error(
      "index.html 没有引用任何 /assets/*.js —— 这不是 Vite 构建出来的工作台界面（源码 index.html、占位页都长这样），" +
        "或 vite 的 assetsDir 不再是 assets/、base 不再是根路径（守护进程只路由根相对的 /assets/，server.ts）",
    );
  }

  let bytes = index.body.byteLength;
  for (const ref of refs) {
    const asset = await get(`/${ref}`);
    if (asset.status !== 200) {
      throw new Error(
        `GET /${ref} 返回 ${asset.status} —— index.html 与它引用的文件不是同一次构建的产物` +
          "（或那个文件没装进包；根级文件还要在 server.ts 的 UI_ROOT_FILES 白名单里）",
      );
    }
    if (asset.body.byteLength === 0) throw new Error(`GET /${ref} 是空的`);
    // MIME 也要对：一个以 octet-stream 端出来的 .js，浏览器不会把它当模块脚本执行，
    // 页面会是一片空白，而状态码是 200。
    const expected = EXPECTED_TYPE.find(([ext]) => ref.endsWith(ext));
    if (expected && !expected[1].test(asset.type)) {
      throw new Error(`GET /${ref} 的 content-type 是「${asset.type}」，${expected[2]}`);
    }
    bytes += asset.body.byteLength;
  }
  return { assets: refs, bytes };
}
