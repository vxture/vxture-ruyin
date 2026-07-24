# 50-deployment 索引

本仓是桌面分发型仓库：无 tag→环境部署，发布模型见 `../30-design/70-repo-organization.md` §7。

| 文件 | 内容 |
|---|---|
| `rebuild/main-ruleset.json` | main 分支保护 ruleset（照 org 模板；apply 时机见 TD-002） |

bootstrap 顺序（本仓已有 main 与历史，非空仓流程）：
治理文件落 main → CI 在 main 跑绿一次（五个 context 产生）→
`gh api repos/vxture/vxture-ruyin/rulesets` apply ruleset → 此后只走 PR。
另需在仓库 Settings 开启 secret scanning + push protection。
