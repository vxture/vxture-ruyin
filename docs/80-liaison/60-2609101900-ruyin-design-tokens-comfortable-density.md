# Liaison request: `@vxture/design-tokens` 宽松档在尺度上等于默认档（DS 线）

- Stamp: 2609101900 (2026-09-10 19:00)
- From: ruyin line
- To: **DS 线**（`vxture/vxture-design`，发 `@vxture/design-tokens` / `design-ui` / `design-system`）
- Status: **open** — 2026-09-10 提出
- 关联: 本仓 TD-040
- 阻塞关系: 不阻塞任何开发。ruyin 已在产品仓自行撑开容器作为过渡，**上游修好后整段删除**

## 0. 一句话

`@vxture/design-tokens@3.0.0` 的 `.density-comfortable` 里，**inset 与 row 两组尺度与
`:root, .density-default` 逐字相同**，只有 control 一组抬了一档。于是「宽松」在用户
那里只表现为控件变高，**卡片内边距、卡片间距、板块间距全不动**。

owner 2026-09-04 的原话是「宽松没啥太大变化，基本等于默认」。

## 1. 证据：源文件逐行对照

文件：`src/styles/semantic/spacing-semantic.css`
（`:root, .density-default` 在 L26、`.density-compact` L65、`.density-comfortable` L104）

基准 `--vx-spacing: 0.25rem`（= 4px，`src/styles/primitive/spacing-primitive.css` L18）。

| token | `.density-default` | `.density-compact` | `.density-comfortable` |
|---|---|---|---|
| `--space-md` | `* 4`（16px） | `* 2`（8px） | **`* 4`（16px）— 与默认相同** |
| `--space-lg` | `* 6`（24px） | `* 3`（12px） | **`* 6`（24px）— 与默认相同** |
| `--space-row-md` | `* 14`（56px） | `* 10`（40px） | **`* 14`（56px）— 与默认相同** |
| `--space-control-md` | `* 8`（32px） | `* 7`（28px） | `* 9`（36px）← **只有这一组动了** |

`--space-none/2xs/xs/sm/md/lg/xl/2xl/3xl/4xl/5xl/6xl` 十二个、
`--space-row-sm..4xl` 七个、以及 `--space-page-inset`，在 comfortable 与 default
两个块里**逐字相同**。

## 2. 为什么判断这是漏改，而不是有意设计

**紧凑档三组全动，宽松档只动一组。**

`.density-compact` 把 inset 整套折半（`2xs` 1→0.5、`xs` 2→1、`sm` 2.5→1.5、`md` 4→2、
`lg` 6→3…）、row 也整套收窄（12→8、14→10、16→12…）、control 同时降一档。三组一致
地朝一个方向走。

而 `.density-comfortable` 只把 control 抬了一档，inset 与 row 原封不动。

如果「宽松只放大控件」是有意的，紧凑档没有理由把三组都缩 —— 两档不对称到这个
程度，最合理的解释是宽松档那两组**忘了改**。

## 3. 请求

补齐 `.density-comfortable` 的 inset 与 row 两组尺度（方向与幅度由 DS 线定，
我们不预设数值 —— 定尺度是 DS 的活）。

## 4. ruyin 这一侧现在怎么办的（过渡，不是主张）

在 `apps/ui-workspace/src/app.css` 里用 `html.density-comfortable` **逐条抬自己的容器**
（卡片、状态卡、产品卡、设置行与板块、设置页那一摞）。

**有意不改 `--space-*` / `--spacing-*` 的尺度本身** —— 那等于在产品仓里分叉组织级
尺度。所以过渡方案只动本仓自己的容器类，一个 DS token 都没重定义。

**上游补齐后，那段名单整体删除。**

（顺带记一笔本仓自己的缺陷，已修，与 DS 无关：设置行高原来写死 `--set-row-h: 44px`，
连紧凑档都推不动它，现改为按密度取 36 / 44 / 52。）

## 5. 另一条**不**请求、只是缩小范围的记录

TD-011② 的「`@vxture/design-ui` 无按组件子路径导出，用一个组件要把约 24 个 Radix
组件打进主包」，owner 2026-09-02 已定**有意接受**（桌面应用随安装器落盘，不走网络
下载，体积只影响首屏解析一瞬）。**这里不提请求。**

只留一个复核过、比原文窄得多的范围，省得日后重查：

> 缺 `sideEffects: false` 声明的是 **`@vxture/design-system`**；
> **`@vxture/design-ui` 那一层已经声明了**。

若哪天 ruyin 这套界面要走网络交付（Local Web 访问模式对外开放、或做 Web 版），
体积会重新变成用户能感觉到的东西，届时再提。
