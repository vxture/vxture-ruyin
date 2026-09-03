# @vxture/ruyin-contract-schema

如影（Ruyin）产品契约：TypeScript 类型、JSON Schema、以及校验器（L1 结构层 + R 系列语义规则）。

- 设计权威：`docs/30-design/30-contract-schema.md`（vxture-ruyin 仓库），规则清单见其 §15 —— 编号稀疏，不要按区间理解。
- 入口：`parseContract(yaml)` / `validateContract(value)` / `validateContractYaml(yaml)`。
- 同一份契约在本地 Runtime 与云端 Runtime 上跑出一致行为（Same Contract, Any Runtime）；契约不得绑定模型或 Provider（R6）。

版本是「契约规范实现版本」，与桌面应用版本无关。All rights reserved.
