/**
 * 品牌信息块：「关于」页与标题栏 RUYIN 信息面板共用同一份内容（owner
 * 2026-09-16）——只讲**本软件自己的事**：品牌、版本、条款、三方许可；不含
 * 本机信息（机器型号、固件……那些留在「关于」页自己的「本机配置」板块，
 * 本组件不管，标题栏那个面板也不显示它们）。
 *
 * 单独成一个文件而不是从 `settings.tsx` 导出：那个文件很大，被 Vite 分进了
 * 自己的 chunk（进设置页才下载）；工作台标题栏是首屏就挂载的，从那里
 * `import` 一个 `settings.tsx` 的具名导出会把整个设置页代码拖进主 chunk。
 */

import { Icon } from "@vxture/design-system";
import type { SessionInfo, SystemInfo } from "./api";
import { ThirdPartyNotices } from "./third-party-notices";

/**
 * 关于页要链哪几页 —— **逐条实测过在不在**（2026-09-10，跟到语言前缀跳转之后）。
 *
 * 在的：`privacy` `terms` `cookies` `refund`（200）。
 * 不在的：`dpa` `security` `subprocessors` `open-source` `acceptable-use` `licenses`
 * 全是 404 —— 所以这里一条都不写。**一个点开是 404 的法律链接，比没有这个链接
 * 糟得多**：用户会以为自己没找到，而不是它不存在。
 *
 * **`cookies` 在，但故意不链。** 那份《Cookie 使用政策》讲的是网站的必要 / 偏好 /
 * 分析 / 第三方 Cookie；桌面应用不设分析 Cookie、也没有第三方 Cookie。链过去等于
 * 替产品宣称了一件不成立的事。
 */
export const LEGAL_LINKS: Array<{ path: string; label: string }> = [
  { path: "/legal/privacy", label: "隐私政策" },
  { path: "/legal/terms", label: "服务条款" },
  { path: "/legal/refund", label: "退款政策" },
];

export function BrandInfoBlock({
  system,
  session,
}: {
  system: SystemInfo | null;
  session: SessionInfo | null;
}) {
  // 未登录时也要能看条款 —— 落到与登录页同一个缺省，不是空链接。
  const consoleBase = session?.consoleBase || "https://vxture.com";
  return (
    <div className="about-block">
      {/* 图形标 + 品牌两行，左对齐、品牌色（owner 2026-09-15）。图形标复用
          登录页那一份（/logo.svg），不是这一页专门画一份 —— 同一个产品只有
          一个图形标。 */}
      <div className="about-brand">
        <img className="about-mark" src="/logo.svg" alt="" aria-hidden />
        <div className="about-brand-text">
          <p className="brand-name">RUYIN</p>
          <p className="brand-tag">Intelligent Workbench</p>
        </div>
      </div>
      <p className="about-desc text-body-md text-muted-foreground">
        Vxture AI 原生智能体的本地智能工作环境
      </p>
      <div className="about-runtime mono text-muted-foreground">
        Runtime {system?.version ?? "…"} · {system?.platform ?? ""}-
        {system?.arch ?? ""}
      </div>
      <p className="about-copyright text-body-sm text-muted-foreground">
        © 2026 Vxture · 保留所有权利
      </p>
      {/* 三条条款做成按钮式（owner 2026-09-10），但**仍然是 `<a>`**：真链接才能
          中键新开、右键复制地址；用按钮 + onClick 去 window.open 会把这两样
          都弄丢，而它看起来一模一样。「三方许可」与它们同一行、同一个版式
          （owner 2026-09-15）——它底层是个 `<button>`（就地展开一份清单，不是
          去别处），所以留着 `.about-third-party` 自己的类，只是外观对齐。 */}
      <div className="about-legal">
        {LEGAL_LINKS.map((l) => (
          <a
            key={l.path}
            className="about-legal-btn"
            href={`${consoleBase}${l.path}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {l.label}
            <Icon name="external-link" size="xs" />
          </a>
        ))}
        <ThirdPartyNotices />
      </div>
    </div>
  );
}
