# 50-deployment 索引

本仓是桌面分发型仓库：无 tag→环境部署，发布模型见 `../30-design/70-repo-organization.md` §7。

| 文件 | 内容 |
|---|---|
| `rebuild/main-ruleset.json` | main 分支保护 ruleset（照 org 模板；apply 时机见 TD-002） |
| `90-store-beta.md` | Store 认证、安装验收与历史状态 |
| `100-beta-021.md` | 0.2.1 候选说明与交付门槛 |
| `110-agent-packages.md` | 智能体包签名、信任配置和独立交付 |

bootstrap 顺序（本仓已有 main 与历史，非空仓流程）：
治理文件落 main → CI 在 main 跑绿一次（五个 context 产生）→
`gh api repos/vxture/vxture-ruyin/rulesets` apply ruleset → 此后只走 PR。
另需在仓库 Settings 开启 secret scanning + push protection。
