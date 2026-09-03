# @vxture/ruyin-core

如影（Ruyin）Workspace Runtime 的同构内核：项目容器生命周期、业务状态机、任务执行 Harness（能力回合、Tool Gate、人在回路、验证与恢复）、审计哈希链、上下文选择与传输门。

- 宿主无关：内核不引用任何 Node / Electron / 浏览器 API，宿主通过 `RuntimePorts` 提供存储、时钟、加密、能力网关、连接器、工具执行器。
- 两个宿主实现同一套规范：本地守护进程（随如影安装包发出）与云端 Runtime（消费本包）。
- 一致性套件：`runConformance(ports)` —— 接第三套 ports 时直接复用。
- 设计权威：vxture-ruyin 仓库 `docs/30-design/`（10 / 40 / 50 / 60 及 decisions/）。

版本是「规范实现版本」（契约 `runtime.minimum` 的校验对象），与桌面应用版本无关。All rights reserved.
