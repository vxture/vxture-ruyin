# Liaison report: ruyin 桌面分发剖面报备（L1）

- Stamp: 2607241430 (2026-07-24 14:30)
- From: ruyin line
- To: platform line (owns 140-repo-governance-standard / vxture-template)
- Status: **closed on this line (2026-09-02, owner) — the premise was withdrawn, not met.**
  Ruyin no longer follows the platform standard here and no longer waits for it: as a desktop
  distribution repo the platform template explicitly excludes (product_240 §0.3), it made its own
  call and promoted `packaged-smoke` to a required check without waiting. TD-007 closed with it.
  **Nothing on the platform side changed**, and this is not dressed up as acknowledgement: the
  branch below is still unmerged and `vxture-platform#131` still has no reply. It stays tracked
  there, where it is that line's to act on — a letter this line keeps open for something it has
  decided not to wait for reads as still waiting.

  Original status, kept because the correction in it is the useful part: open - awaiting
  platform-line acknowledgement (re-verified 2026-09-02; a 2026-09-02
  entry here briefly said "partially acknowledged" citing a rule change in
  `140-repo-governance-standard.md` that named this repo's `packaged-smoke` job as the reference
  implementation - that was wrong. The text existed only on a pushed-but-unmerged branch
  (`docs/governance-distribution-launch-check`, commit `981d378`) in `vxture-platform`, not on its
  `main` (confirmed via `git merge-base --is-ancestor 981d378 origin/main` = false, and no PR has
  ever been opened for that branch). Per the standing cross-repo boundary — this line only
  branches/commits/pushes in vxture-platform, PR/merge is platform line's to execute — that branch
  is sitting there waiting for exactly that step. Still genuinely unacknowledged until it lands.
- 性质: 纪律性报备（非阻塞）；`product_240` §0 结论 3 已裁定 ruyin 不适用产品仓模板，本函报备替换剖面并建议补标准

## Context

vxture-ruyin 是桌面分发型仓库（Electron 壳 + Node Runtime 守护进程，构件分发给最终用户），
无部署态服务、无服务器业务库、无 RP 服务端。治理基座已全盘落地并通过验收
（五项 required checks 全绿、ruleset active、密钥四层、SCA 零忽略基线、docs 编号）。

设计权威: 本仓 `docs/30-design/70-repo-organization.md`（§3 为逐条治理映射表）。

## 剖面替换摘要（照 140 §4-§7 对照）

| 140 条款 | ruyin 处置 |
|---|---|
| §4 tag→环境 CD | 替换为 **tag→渠道**: `beta-*`→beta 更新渠道、`v*`→stable 渠道 + production 环境必审人门；稳健 CD 构件（tailnet-ssh-connect / rsync staging / VERSION 溯源）全部复用，载荷从 compose 栈换为安装包 |
| §5 镜像仓库 profile | 不适用（无容器镜像；npm 包走 GitHub Packages org 基建） |
| §6 部署 bootstrap | 缩减为 beta/production 两个 Environment，指向下载主机（见 L2 函） |
| §7 数据层 | 不适用（数据在用户设备 SQLite，应用内管理；无 vxturebiz 库） |
| C3 用量上报 | **反转**: 桌面客户端不可信，AI 用量在 AI Gateway 服务端计量（见 L3 函） |

## Request (platform line)

1. 确认上述过渡态可接受（或指出需调整项）。
2. 建议平台侧沉淀一份「桌面分发型仓库 profile」标准（模板家族空缺；ruyin 的
   `30-design/70` 可作底稿），未来 hermes 等非 Web 形态仓库可复用。

## 附: 对模板的两条实证反馈（时点 2026-07-24, pnpm 11.1.1）

1. **pnpm 11 迁移坑**: `pnpm.overrides` 与构建脚本白名单在 pnpm 11 已迁至
   `pnpm-workspace.yaml`（键 `overrides:` / `allowBuilds:`）；写在 package.json
   `pnpm` 字段会**静默失效**（本仓实测: ini 漏洞 override 不生效、原
   `onlyBuiltDependencies` 语法被 install 硬报错）。vxture-template 目前
   pin pnpm@10.30.3 且 overrides 写在 package.json —— 升 pnpm 11 时会踩。
2. **SCA 门实战记录**: 本仓三次被 audit 硬门拦截（ini@1.3.0 原型污染 /
   electron@35 十九条通告 / semver@6.2.0 ReDoS），均按 140 §9 三分法处置，
   忽略基线保持为零。门的设计有效。
