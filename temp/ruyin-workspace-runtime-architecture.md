# 如影 Workspace Runtime：AI 原生业务工作空间架构设计

> **Ruyin Workspace Runtime Architecture**
>
> 文档版本：v0.3\
> 文档状态：架构设计基线\
> 所属平台：Vxture Platform\
> 产品：Ruyin（如影智能工作平台）\
> 本版修订：Runtime / Harness 按作用域定界（Workspace 级长生命周期 / Task 级短生命周期）；Task 拆分为 Definition 与 Instance
> 上版修订：确立统一运行时模型 —— 一份规范、两个实现（Cloud / Local），差异仅在数据面

------------------------------------------------------------------------

## 0. 文档定位

本文件是《如影智能工作平台：产品战略与顶层设计》的第二层架构设计文档。

上一层文档回答：

> **Ruyin 是什么？为什么存在？与 Vxture SaaS 的关系是什么？**

本文件回答：

> **Ruyin 如何成为 Vxture AI 原生业务产品的统一工作空间运行时？**

本文件建立 Ruyin 的：

-   核心抽象
-   工作空间模型
-   运行时模型
-   业务上下文模型
-   AI Harness 模型
-   云端 / 本地运行关系
-   业务产品接入边界
-   后续技术架构的设计基础

------------------------------------------------------------------------

# 1. Executive Summary

## 1.1 核心结论

Ruyin 不是：

-   一个通用 AI Chat 客户端
-   一个万能 Agent
-   一个简单的 SaaS Desktop Client
-   一个文件同步工具
-   一个把多个 SaaS 产品放在一起的门户
-   一个以 Project 为最高抽象的 AI 工具

Ruyin 的核心定位是：

> **面向 Vxture AI 原生业务产品的 Business Workspace Runtime。**

中文：

> **AI 原生业务工作空间运行时。**

完整表达：

> **Ruyin 将 Vxture 的 AI
> 原生业务产品、云端智能能力与用户本地工作环境连接起来，为用户提供明确业务导向、数据环境可控、AI
> 能力深度融合的完整业务工作空间。**

核心模型：

``` mermaid
flowchart TB
    BP["Vxture AI 原生业务产品"]
    BW["Business Workspace<br/>业务工作空间"]
    WR["Workspace Runtime<br/>工作空间运行时"]
    CTX["Context Runtime<br/>业务上下文运行时"]
    AI["Vxture AI Capabilities<br/>Model / Knowledge / Skill / Ontology"]
    ENV["Work Environment<br/>Cloud / Local / LAN / Private"]

    BP --> BW
    BW --> WR
    WR --> CTX
    WR --> AI
    CTX --> ENV
```

------------------------------------------------------------------------

## 1.2 统一运行时：一份规范，两个实现

"统一工作空间运行时"中的"统一"，指**规范统一**，而非部署统一。

Workspace Runtime 首先是一份运行时规范（Runtime Specification），定义
Workspace 生命周期、契约加载、上下文解析、能力解析、任务执行、验证、状态与同步的统一语义。

该规范拥有两个对等实现：

| 维度 | Vxture Cloud Runtime | Ruyin Local Runtime |
|---|---|---|
| 规范与契约 | 同一份 | 同一份 |
| 业务产品与业务语义 | 同一个 / 一致 | 同一个 / 一致 |
| AI 能力 | Vxture 云端 | Vxture 云端（当前阶段） |
| 数据驻留 | 云端 | 本地，是否上云由用户控制 |

> **同一个业务产品（如标书编写），既可以在云端完成，也可以在本地完成。
> 两者的本质差异只有一个：用户数据是否上传。**

详细模型见第 15 章《Unified Runtime Model》。

------------------------------------------------------------------------

# 2. Why Workspace Runtime

## 2.1 AI 产品正在经历三个阶段

### 第一阶段：AI Chat

``` text
用户
 ↓
自然语言
 ↓
AI
 ↓
文本回答
```

### 第二阶段：AI Agent

``` text
用户目标
    ↓
Agent
    ↓
自主规划
    ↓
调用工具
    ↓
执行任务
```

### 第三阶段：AI Business Workspace

``` text
Business Product
        ↓
Business Workspace
        ↓
Business Runtime
        ↓
AI Capability
        ↓
Business Result
```

核心变化：

> AI 不再是用户工作的起点，而是业务工作空间中的智能能力。

------------------------------------------------------------------------

# 3. Ruyin 的第一性原理

## 3.1 工作不是"任务"

真实业务工作通常不是一个孤立任务，而是：

``` text
业务目标
    ↓
业务对象
    ↓
业务状态
    ↓
业务流程
    ↓
具体任务
    ↓
业务成果
```

例如"编写标书"：

``` text
投标机会
    ↓
投标项目
    ↓
项目阶段
    ↓
投标工作流
    ↓
需求分析 / 方案编写 / 审核
    ↓
最终投标文件
```

因此：

> **Ruyin 的核心不是 Task Runtime，而是 Business Workspace Runtime。**

------------------------------------------------------------------------

## 3.2 工作空间是业务上下文的边界

``` text
Business Workspace
    =
Business Context
    +
Business State
    +
Business Workflow
    +
Business Capability
    +
Business Result
```

------------------------------------------------------------------------

# 4. Ruyin 的核心产品模型

## 4.1 四层模型

``` mermaid
flowchart TB
    P["Business Product<br/>业务产品"]
    W["Business Workspace<br/>业务工作空间"]
    R["Workspace Runtime<br/>工作空间运行时"]
    E["Work Environment<br/>工作环境"]

    P --> W
    W --> R
    R --> E
```

### Business Product

例如：

-   客户销售
-   标书编写
-   文档编写

定义：

-   业务对象
-   业务流程
-   业务规则
-   用户界面
-   业务成果

### Business Workspace

业务产品中的实际工作环境。

``` text
客户销售
    ↓
销售工作空间

标书编写
    ↓
投标项目 A

文档编写
    ↓
文档工作空间
```

### Workspace Runtime

负责让工作空间真正运行，包括：

-   业务上下文
-   工作状态
-   数据访问
-   AI 能力
-   工具权限
-   任务执行
-   结果验证
-   操作审计
-   同步策略

### Work Environment

实际数据和能力所在的环境：

-   Vxture Cloud
-   用户本地设备
-   企业局域网
-   私有部署环境
-   外部业务系统

------------------------------------------------------------------------

# 5. Business Product ≠ Workspace ≠ Task

## 5.1 Business Product

定义：

> **用户要解决哪类业务问题。**

例如：

``` text
客户销售
标书编写
文档编写
```

## 5.2 Business Workspace

定义：

> **用户当前正在处理哪一个业务上下文。**

例如：

``` text
客户销售
    └── 客户：某能源集团

标书编写
    └── 投标项目：某智慧水务项目

文档编写
    └── 文档：2026 年度销售计划
```

## 5.3 Business Task

定义：

> **在当前业务工作空间中，要完成什么具体工作。**

``` text
投标项目 A
    └── 生成技术方案第三章
```

三者关系：

``` mermaid
flowchart LR
    BP["Business Product<br/>客户销售 / 标书 / 文档"]
    BW["Business Workspace<br/>客户 / 投标项目 / 文档"]
    BT["Business Task<br/>跟进 / 编写 / 审核"]

    BP --> BW
    BW --> BT
```

------------------------------------------------------------------------

# 6. Workspace Types

工作空间类型由业务产品决定。

## 6.1 Persistent Business Workspace

典型：

``` text
客户销售
    ↓
销售工作空间
```

特点：

-   长期存在
-   持续累积业务数据
-   状态不断变化
-   不以一次任务结束

``` text
销售工作空间
│
├── 客户
├── 联系人
├── 商机
├── 拜访记录
├── 跟进记录
├── 合同
├── 销售阶段
└── AI 分析
```

## 6.2 Project Workspace

典型：

``` text
标书编写
    ↓
投标项目 A
```

生命周期：

``` mermaid
flowchart LR
    C["Created<br/>创建"]
    P["Planning<br/>规划"]
    E["Execution<br/>执行"]
    R["Review<br/>审核"]
    F["Finished<br/>完成"]
    A["Archived<br/>归档"]

    C --> P --> E --> R --> F --> A
```

项目结束后：

``` text
项目成果
    ↓
归档
    ↓
沉淀为案例 / 知识 / 数据资产
```

## 6.3 Document Workspace

``` text
文档编写
    ↓
文档工作空间
```

可支持：

-   单文档
-   文档集合
-   长期文档项目
-   版本管理
-   审核流程

## 6.4 Future Workspace Types

未来可以支持：

-   Case Workspace
-   Campaign Workspace
-   Operation Workspace
-   Research Workspace
-   Decision Workspace
-   Incident Workspace

核心原则：

> **Workspace Type 不由 Ruyin 统一规定，而由 Business Product 定义。**

------------------------------------------------------------------------

# 7. Workspace Runtime

Workspace Runtime 是：

> **让一个 Business Workspace
> 能够在特定工作环境中持续运行的运行时系统。**

``` text
Business Workspace
        ↓
识别业务上下文
        ↓
加载相关数据
        ↓
加载业务能力
        ↓
执行具体工作
        ↓
验证工作结果
        ↓
保存业务状态
```

核心组件按**作用域（Scope）**分为两级——这是 Runtime 与 Harness 的定界维度：

## 7.1 Workspace 作用域 —— 长生命周期

跨任务持续存在，随 Workspace 创建与归档：

``` text
Workspace Runtime
├── Workspace Lifecycle        创建 / 打开 / 归档 / 恢复
├── Business State Store       业务状态，跨任务持续
├── Context Runtime            数据源连接与解析（Cloud / Local / LAN / Private）
├── Permission Policy          用户权限策略（Allow / Deny / Ask）
├── Sync Control               同步策略执行
├── Audit Log                  工作空间级审计存储
└── Harness Factory            每次任务执行实例化一个 Harness
```

## 7.2 Task 作用域 —— 短生命周期

随任务生灭，由 Business Runtime Harness 承载（详见第 8 章）：

``` text
Business Runtime Harness
├── Task Instance
├── Context Selection
├── Tool Gate
├── Capability Invocation
├── Verification
├── Human Checkpoint
├── Execution State Machine
└── Audit Emission
```

## 7.3 两级关系

``` mermaid
flowchart TB
    WS["Business Workspace"]

    subgraph WR["Workspace Runtime · 长生命周期"]
        LC["Workspace Lifecycle"]
        BS["Business State Store"]
        CC["Context Runtime"]
        PP["Permission Policy"]
        SY["Sync Control"]
        AU["Audit Log"]
        HF["Harness Factory"]
    end

    subgraph H["Business Runtime Harness · 任务作用域"]
        TI["Task Instance"]
        CS["Context Selection"]
        TG["Tool Gate"]
        CI["Capability Invocation"]
        ES["Execution State Machine"]
        AE["Audit Emission"]
    end

    WS --> WR
    HF -->|"实例化"| H
    CS -->|"选择自"| CC
    TG -->|"受约束于"| PP
    ES -->|"状态写回"| BS
    AE -->|"事件写入"| AU
```

> **Workspace Runtime 管理空间，Harness 执行任务；Runtime 长存，Harness 随任务生灭。**

------------------------------------------------------------------------

# 8. Business Runtime Harness

## 8.1 为什么需要 Harness

裸 Agent：

``` text
User
 ↓
LLM
 ↓
Tool
 ↓
Action
```

问题：

-   上下文不可控
-   工具权限过大
-   任务目标不明确
-   结果不可验证
-   执行状态不可追踪
-   失败后无法恢复

因此需要：

``` text
Business Workspace
        ↓
Business Runtime Harness
        ↓
AI / Tools / Data
```

## 8.2 Harness 的定位

> **Harness 是一次业务任务执行的受控沙箱：任务作用域、短生命周期，
> 由 Workspace Runtime 的 Harness Factory 实例化，任务结束即销毁。**

核心原则：

``` text
业务定义边界
AI 在边界内工作
```

Harness 是统一运行时规范的一部分：
Cloud Runtime 与 Local Runtime 各自实现 Harness，任务执行语义因此在两端一致。

> **Runtime Conformance 的主要验证对象，就是 Harness 行为。**

## 8.3 Harness 核心能力

``` mermaid
flowchart TB
    TI["Task Instance<br/>任务实例"]
    CX["Context Selection<br/>上下文选择"]
    TG["Tool Gate<br/>工具门控"]
    AI["Capability Invocation<br/>能力调用"]
    VR["Verification<br/>验证"]
    HR["Human Checkpoint<br/>人工确认"]
    ES["Execution State Machine<br/>执行状态机"]
    AE["Audit Emission<br/>审计写入"]

    TI --> CX
    CX --> TG
    TG --> AI
    AI --> VR
    VR --> HR
    HR --> ES
    ES --> AE
```

各能力的边界来源与 Workspace 级依赖：

| Harness 能力 | 受什么约束 | 依赖的 Workspace 级组件 |
|---|---|---|
| Task Instance | Task Definition（契约声明） | — |
| Context Selection | Context Contract + 最小化原则 | Context Runtime |
| Tool Gate | Allowed Tools ∩ 用户权限策略 | Permission Policy |
| Capability Invocation | Required Capabilities | Capability Resolver（当前均解析到云端 AI） |
| Verification | 产品声明的验证规则 | — |
| Human Checkpoint | 关键节点清单（高风险操作 / 对外发送 / 最终提交） | — |
| Execution State Machine | 可恢复语义（Recovery 的落点） | Business State Store |
| Audit Emission | 审计事件格式（含推理传输事件） | Audit Log |

## 8.4 Harness 生命周期

``` text
用户启动业务任务
    ↓
Harness Factory 实例化 Harness
    ↓
Task Definition + 具体输入 → Task Instance
    ↓
Context Selection（最小上下文）
    ↓
执行（Tool Gate / Capability Invocation）
    ↓
Verification → Human Checkpoint
    ↓
业务状态写回 Business State Store
    ↓
审计事件写入 Audit Log
    ↓
Harness 销毁
```

失败与恢复：

``` text
执行中断
    ↓
Execution State Machine 保留断点
    ↓
恢复时重建 Harness
    ↓
从断点续跑或重放
```

------------------------------------------------------------------------

# 9. Task Definition 与 Task Instance

AI 任务不能只依赖自然语言。

任务概念必须区分**静态声明**与**运行期实例**：

| | Task Definition | Task Instance |
|---|---|---|
| 身份 | 静态声明（"类"） | 运行期对象（"实例"） |
| 所在 | Runtime Contract，随产品发布 | Harness 持有，随任务生灭 |
| 由谁产生 | 业务产品定义 | Harness 实例化 |

## 9.1 Task Definition（任务定义）

``` text
Task Definition
    ├── Objective              目标
    ├── Input Types            输入类型
    ├── Output Types           输出类型
    ├── Constraints            约束
    ├── Required Capabilities  所需 AI 能力
    ├── Allowed Tools          允许工具
    └── Verification Rules     验证规则
```

> 术语统一：原"Acceptance Criteria（验收标准）"并入 Verification，全线只用 Verification 一词。

## 9.2 Task Instance（任务实例）

``` text
Task Instance
    ├── Definition Ref         引用的任务定义
    ├── Inputs                 具体输入
    ├── Selected Context       选定的最小上下文
    ├── Execution State        执行状态
    ├── Result                 业务结果
    └── Verification Outcome   验证结论
```

## 9.3 示例

Task Definition（产品声明）：

``` text
任务定义：生成技术方案章节

输入类型：
- 招标文件
- 企业产品资料
- 历史案例

输出类型：
- 技术方案章节

约束：
- 不得虚构企业能力
- 必须基于已授权资料

验证规则：
- 覆盖招标要求
- 无明显矛盾
- 满足模板结构
```

Task Instance（运行期，Harness 持有）：

``` text
任务实例：生成技术方案第三章
    ├── 定义引用：生成技术方案章节
    ├── 输入：某智慧水务项目招标文件 / 产品手册 2026
    ├── 选定上下文：技术要求 37 条 + 相关案例 3 篇
    ├── 执行状态：Verification
    ├── 结果：第三章草稿
    └── 验证结论：覆盖 35/37，待人工确认
```

------------------------------------------------------------------------

# 10. Context Runtime

## 10.1 Context Follows Work

Ruyin 的核心原则：

> **Context follows Work。**

``` text
进入工作空间
    ↓
自动获得业务上下文
    ↓
自动获得相关数据
    ↓
自动获得相关 AI 能力
```

## 10.2 Context Sources

``` mermaid
flowchart TB
    WS["Business Workspace"]

    CLOUD["Cloud Context<br/>Vxture Cloud"]
    LOCAL["Local Context<br/>本地文件 / 数据"]
    LAN["LAN Context<br/>局域网服务"]
    PRIVATE["Private Context<br/>私有系统"]

    WS --> CLOUD
    WS --> LOCAL
    WS --> LAN
    WS --> PRIVATE
```

## 10.3 Context Selection

不是把所有数据全部提供给 AI：

``` text
Business Task
    ↓
Context Selector
    ↓
Relevant Context
    ↓
AI Capability
```

例如：

``` text
技术方案编写
    ↓
选择：
├── 技术要求
├── 产品能力
├── 技术案例
└── 企业资质
```

------------------------------------------------------------------------

# 11. AI Capability Model

AI 不是 Ruyin 的唯一核心。

Ruyin 调用 Vxture 的 AI 能力：

``` mermaid
flowchart TB
    WR["Workspace Runtime"]

    MODEL["Model"]
    KNOW["Knowledge"]
    SKILL["Skill"]
    ONTO["Ontology"]
    DATA["Data"]
    AGENT["Agent"]

    WR --> MODEL
    WR --> KNOW
    WR --> SKILL
    WR --> ONTO
    WR --> DATA
    WR --> AGENT
```

核心原则：

> **AI 是业务产品的智能层，而不是业务产品本身。**

------------------------------------------------------------------------

# 12. Business State

业务工作不能只依赖聊天记录。

Workspace 必须拥有明确的业务状态。

例如：

``` text
投标项目 A
│
├── 当前阶段：技术方案
├── 完成度：68%
├── 待处理事项：12
├── 风险：3
└── 最近动作：完成需求矩阵
```

状态应当能够被：

-   用户查看
-   AI 读取
-   工作流使用
-   业务规则验证
-   同步到云端

------------------------------------------------------------------------

# 13. Verification

AI 生成结果必须能够被验证。

``` mermaid
flowchart LR
    G["AI Generation"]
    V["Verification"]
    R["Result"]
    H["Human Review"]

    G --> V --> H --> R
```

示例：

``` text
招标要求：50 条
    ↓
需求覆盖检查
    ↓
48 条已覆盖
2 条缺失
    ↓
返回修改
```

Verification 可以包括：

-   结构验证
-   需求覆盖验证
-   数据一致性验证
-   业务规则验证
-   权限验证
-   内容质量验证

------------------------------------------------------------------------

# 14. Human Intervention

Ruyin 不采用全自动，也不采用全人工：

``` text
AI 执行
    ↓
关键节点
    ↓
人确认
    ↓
继续执行
```

人应该控制：

-   高风险操作
-   对外发送
-   最终提交
-   数据同步
-   文件删除
-   关键业务决策

------------------------------------------------------------------------

# 15. Unified Runtime Model：Cloud Runtime 与 Local Runtime

"统一工作空间运行时"的准确含义：

> **一份规范，一份契约，两个对等的运行时实现。**

同一个 Business Product 基于同一份 Runtime Contract，运行在
Workspace Runtime 规范的两个实现之上：

``` mermaid
flowchart TB
    BP["Business Product<br/>同一业务产品（如标书编写）"]
    RC["Runtime Contract<br/>同一份契约"]

    CR["Vxture Cloud Runtime<br/>SaaS 侧实现"]
    LR["Ruyin Local Runtime<br/>Ruyin 实现"]

    AI["Vxture Cloud AI<br/>统一智能面"]

    BP --> RC
    RC --> CR
    RC --> LR
    CR --> AI
    LR --> AI
```

实现归属：

-   Workspace Runtime 规范：由 Ruyin 架构定义（02 / 03 文档）
-   Cloud Runtime：由 Vxture SaaS 侧按规范实现
-   Local Runtime：Ruyin 产品本体（Desktop Shell + Local Runtime）

## 15.1 三个平面

### 智能面 · Intelligence Plane —— 统一

AI 能力（Model / Knowledge / Skill / Agent）当前一律由 Vxture 云端提供：

``` text
Cloud Runtime ──┐
                ├──→ Vxture Cloud AI
Local Runtime ──┘
```

Capability Resolver 是唯一解析入口。
未来引入本地 / 私有智能能力时，只改变解析结果，不改变业务产品与契约。

### 数据面 · Data Plane —— 唯一本质差异

``` text
Cloud Runtime
    └── 上下文与数据驻留云端

Ruyin Local Runtime
    └── 上下文与数据驻留本地
        └── 是否上云由用户控制
```

> **同一个业务产品，既可以在云端完成，也可以在本地完成。
> 两者的本质差异只有一个：用户数据是否上传。**

### 体验面 · Experience Plane —— 一致

``` text
Cloud Workspace（浏览器访问）
Ruyin Local Workspace（Desktop Shell / Local Web）
```

同一业务产品在两个运行时中保持一致的业务体验与业务语义。

## 15.2 推理传输 ≠ 数据存储

当前模型统一调用云端，本地工作也需要将被选择的上下文传输至云端推理。
必须严格区分两种数据流动：

| 数据流动 | 性质 | 控制方式 |
|---|---|---|
| 推理传输 Inference Transmission | 临时、即用即弃、不持久化 | 上下文最小化选择 + 审计 |
| 数据同步 Data Sync | 持久化存储到云端 | 用户显式控制，默认关闭 |

核心原则：

> **推理时的上下文传输是临时的、非持久的、可审计的；
> 数据是否在云端存储，始终由用户的同步策略决定。**

因此"仅本地"模式的准确语义：

``` text
本地资料
    ↓
最小化上下文选择
    ↓
云端推理（不持久化）
    ↓
本地生成物
    ↓
云端不存储任何业务资料与成果
```

## 15.3 两种运行模式

### Cloud-first

``` text
登录 Vxture
    ↓
订阅业务产品
    ↓
Cloud Runtime 中直接使用
```

业务产品始终可用。

### Local-capable

``` text
启动 Ruyin
    ↓
登录 Vxture
    ↓
进入同一业务产品
    ↓
Local Runtime 中使用本地数据 / 文件
```

本地使用不是 SaaS 的替代，而是：

> **同一业务产品在统一运行时规范下的另一种数据驻留选择。**

## 15.4 业务连续性机制

云端 ↔ 本地的业务连续性由三层机制保证：

``` text
1. 同一份 Runtime Contract
       └── 业务语义一致

2. 同一套 Workspace Runtime 规范
       └── 运行语义一致（Runtime Conformance）

3. Workspace 级同步（用户控制）
       └── 业务状态与数据可迁移
```

``` mermaid
flowchart LR
    CW["Cloud Workspace"]
    SY["User-Controlled Sync<br/>Workspace State + Data"]
    LW["Ruyin Local Workspace"]

    CW <--> SY <--> LW
```

------------------------------------------------------------------------

# 16. Local Data Control

> **数据是否上云，由用户控制。**

数据可以：

``` text
仅本地
```

也可以：

``` text
本地 + 云端同步
```

也可以：

``` text
云端数据
```

## 16.1 Sync Unit

同步可以按：

``` text
Workspace
```

或者：

``` text
数据类型
```

例如：

``` text
投标项目 A
│
├── 招标原始文件
│   └── 仅本地
│
├── 企业知识库
│   └── 云端
│
├── 项目成果文档
│   └── 用户选择同步
│
└── 最终投标文件
    └── 本地 / 云端均可
```

## 16.2 Sync Policy

``` text
Sync Policy
    ├── Local Only
    ├── Cloud Only
    ├── Bidirectional Sync
    ├── Manual Sync
    └── Selective Sync
```

核心原则：

> **同步是用户的数据权利，不是平台默认行为。**

------------------------------------------------------------------------

# 17. Ruyin Product Form

## 17.1 Recommended Architecture

Ruyin 不在 Desktop 与 Local Web 之间二选一。

推荐：

``` mermaid
flowchart TB
    DS["Ruyin Desktop<br/>Desktop Shell"]

    LR["Ruyin Local Runtime<br/>核心运行时"]

    WEB["Local Web Access<br/>http://localhost"]

    APP["Business Applications<br/>CRM / Bid / Document"]

    DS --> LR
    WEB --> LR
    LR --> APP
```

核心判断：

> **Local Runtime 是 Ruyin 的核心产品能力。**
>
> **Desktop Shell 是官方入口和系统集成层。**

Desktop Shell 负责：

-   启动 Runtime
-   管理 Runtime 生命周期
-   系统托盘
-   本地权限
-   文件系统能力
-   系统通知
-   全局快捷键
-   本地连接器
-   安全策略

Local Web Runtime 负责：

-   Business Workspace
-   Business Applications
-   Workspace Runtime
-   Context Runtime
-   AI Capability 调用

原则：

> **Desktop 是壳。Runtime 是核心。Web 是访问方式。**

------------------------------------------------------------------------

# 18. Business Product Runtime Contract

这是未来 Vxture SaaS 产品接入 Ruyin 的核心机制。

一个业务产品需要声明：

``` text
Business Product
│
├── Workspace Type
├── Business Objects
├── Business State
├── Context Requirements
├── Local Connectors
├── Cloud Data
├── AI Capabilities
├── Business Tasks
├── Verification Rules
├── Permissions
└── Sync Policies
```

示例：

``` text
Bid Product
│
├── Workspace Type: Project
├── Business Objects:
│   ├── Bid Project
│   ├── Requirement
│   ├── Proposal
│   └── Deliverable
│
├── Context:
│   ├── Local Files
│   ├── Cloud Knowledge
│   ├── Case Library
│   └── Enterprise Data
│
├── AI Capabilities:
│   ├── Requirement Analysis
│   ├── Proposal Generation
│   └── Coverage Verification
│
├── Tasks:
│   ├── Analyze Tender
│   ├── Generate Proposal
│   └── Validate Coverage
│
└── Sync Policy:
    └── User Controlled
```

------------------------------------------------------------------------

# 19. Three Example Products

## 19.1 客户销售

``` text
客户销售
    ↓
Persistent Business Workspace
```

核心业务：

``` text
客户
 ↓
接触
 ↓
拜访
 ↓
跟进
 ↓
商机
 ↓
签约
```

AI 作为智能层：

-   客户关系分析
-   跟进建议
-   商机判断
-   风险识别
-   下一步行动建议
-   销售过程分析

核心：

> **CRM 仍然是业务核心。AI 负责增强销售管理。**

------------------------------------------------------------------------

## 19.2 标书编写

``` text
标书编写
    ↓
Project Workspace
```

``` text
投标项目
│
├── 招标文件
├── 企业资料
├── 产品资料
├── 案例库
├── 技术方案
├── 商务文件
└── 最终成果
```

``` text
需求分析
    ↓
知识匹配
    ↓
内容生成
    ↓
一致性验证
    ↓
成果输出
```

------------------------------------------------------------------------

## 19.3 文档编写

``` text
文档编写
    ↓
Document Workspace
```

可支持：

-   长文档
-   多文档
-   企业模板
-   知识引用
-   本地资料
-   版本管理
-   审核流程

------------------------------------------------------------------------

# 20. Ruyin 的差异化

## Claude / Cowork

``` text
AI
 ↓
Project
 ↓
Local Context
 ↓
Work
```

核心：

> AI 驱动的工作环境。

## WorkBuddy

``` text
Task
 ↓
Agent
 ↓
Tools
 ↓
Execution
 ↓
Result
```

核心：

> 任务驱动的 Agent 工作台。

## Ruyin

``` text
Business Product
 ↓
Business Workspace
 ↓
Workspace Runtime
 ↓
Business Context
 ↓
AI Capability
 ↓
Business Result
```

核心：

> **业务产品驱动的 AI 原生工作空间。**

------------------------------------------------------------------------

# 21. Ruyin 的核心设计原则

### Principle 1：Business First

``` text
Business > AI
```

### Principle 2：Context Follows Work

上下文跟随工作。

### Principle 3：AI Is Embedded Intelligence

AI 是业务产品的智能层。

### Principle 4：User Controls Data

用户控制数据。

### Principle 5：One Spec, Two Runtimes

云端和本地是同一套 Workspace Runtime 规范的两个对等实现。

``` text
规范统一
契约统一
业务语义统一
智能面统一（当前均为云端 AI）
差异仅在数据面：用户数据是否上传
```

### Principle 6：Workspace Is the Core Boundary

工作空间是：

-   数据边界
-   权限边界
-   AI 上下文边界
-   业务状态边界
-   同步边界

### Principle 7：AI Must Be Verifiable

AI 的业务成果必须可以验证。

### Principle 8：Human Controls Critical Decisions

AI 自动化，人控制关键节点。

------------------------------------------------------------------------

# 22. Target Architecture

``` mermaid
flowchart TB
    V["Vxture Platform"]

    P["AI Native Business Products"]
    L1["L1 / L2 Intelligence Capabilities"]

    R["Ruyin Local Runtime"]

    W["Business Workspace"]
    H["Business Runtime Harness"]
    C["Context Runtime"]

    LOCAL["Local Data"]
    LAN["LAN Services"]
    CLOUD["Cloud Data"]

    V --> P
    V --> L1

    P --> R
    L1 --> R

    R --> W
    W --> H
    H --> C

    C --> LOCAL
    C --> LAN
    C --> CLOUD
```

------------------------------------------------------------------------

# 23. Long-term Vision

Ruyin 的长期定位：

> **Ruyin 是 Vxture 的 AI 原生业务工作平台。**

Vxture 提供：

``` text
Data
Knowledge
Ontology
Model
Ability
Business Product
```

Ruyin 提供：

``` text
Business Workspace
Runtime
Local Context
User-controlled Data
```

最终：

``` text
Vxture
    ↓
AI Native Business Products
    ↓
Ruyin Workspace Runtime
    ↓
Business Work
```

------------------------------------------------------------------------

# 24. Next Architecture Documents

``` text
Ruyin Architecture
│
├── 01 Product Strategy
│   └── 产品战略与顶层设计
│
├── 02 Workspace Runtime
│   └── 本文件
│
├── 03 Runtime Contract
│   └── 业务产品运行时契约
│
├── 03-A Runtime Contract Schema
│   └── 契约字段规范 / 校验规则 / 产品包与分发
│
├── 04 Context Architecture
│   └── 上下文来源与连接器 / 最小化选择 / 推理传输审计 / 同步与冲突 / 身份与访问
│
├── 05 Business Runtime Harness
│   └── Harness 执行状态机 / 恢复语义 / 审计事件格式 / 工具门控 / 人工确认节点
│
├── 06 Technical Architecture
│   └── 技术实现架构
│
└── 07 Product Integration Guide
    └── Vxture SaaS 产品接入 Ruyin 指南
```

------------------------------------------------------------------------

# Final Definition

> **Ruyin is the Business Workspace Runtime for Vxture's AI-native
> business products.**

中文：

> **如影是 Vxture AI 原生业务产品的业务工作空间运行时。**

更完整的产品表达：

> **如影将 AI
> 原生业务产品、云端智能能力与用户可控的本地工作环境连接起来，为用户提供明确业务导向、专业工作流程、统一
> AI 能力和自主数据控制的完整工作空间。**
