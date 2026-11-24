# RUYIN 智能体包准入方案

本批登记：先提取可复用的只读预检，保留现有安装 API；为预检失败提供内部错误码。生产信任锚另行接入，待 RY-001 可访问后补录。

所有可运行智能体统一通过 `.ruyinpkg` 安装。内置、目录下载、离线导入最终走同一准入流程；目录中的产品信息不等于产品已经安装。模板、企业资料、项目文件是数据，通过各自入口导入，不作为智能体安装包。

| 阶段 | 检查 | 处理 |
|---|---|---|
| 容器与完整性 | 文件大小、展开限额、路径边界、安全文件类型、重复路径、全量 CHECKSUMS | 失败拒绝，不注册 |
| 发布者信任 | 验证发布者签名与 Vxture Registry 副署，绑定产品 ID、版本和完整摘要；生产环境无法验证即拒绝 | 开发例外仅限明确的开发模式并留痕，无效签名不视为未签名 |
| 契约与引用 | 根 manifest 和契约版本；任务、工具、技能、产物与 UI 入口的引用闭合；禁止包内密钥和隐式安装脚本 | 失败拒绝 |
| 目标环境 | Runtime 版本、平台能力、已批准的工具提供方、模型和技能依赖；区分必需与可选能力 | Runtime/平台不兼容拒绝；允许补齐的依赖标明缺项，补齐前阻止相关任务 |
| 权限与数据 | 预览读写、连接器、网络发送、同步等能力；检查严格域内环境能否执行本地或内网路由，不允许公网回退 | 违反环境策略则禁止启用对应模式；安装不授予项目运行权限 |
| 安装与启用 | 安装前验证包字节；事务落盘；同 ID 同版本不同摘要拒绝覆盖；隔离检查 UI 能否加载，不读取项目材料 | 失败保留旧版本；新版本申请新增权限；支持切回兼容版本 |

验证结果返回阶段、稳定错误码、涉及条目和可执行修复建议，并区分「签名通过」「已安装」「可启用」「任务就绪」。Accounts 负责身份，Console 负责权益和租户；签名验证与项目授权独立。严格域内所用离线信任材料的刷新、有效期和撤销规则须在生产启用前明确。

标书首验：用合成招标材料跑通需求确认、章节 Markdown 和试排。不同环境的 Word/PDF 排版依赖按声明判断，缺失就禁用对应任务；真实企业知识和用户模板不进入发布包。平台发布验收跑业务样例，客户端安装只做静态与隔离就绪检查，不自动执行写作任务。

当前状态：已有容器、摘要、契约、最低 Runtime 版本和双签校验。正式 Registry 签发、信任材料下发和桌面预检界面仍待接入。

2026-11-20 follow-up: executable payload admission is now shared across package and embedded/downloaded UI validation. Raw native executable/module headers, native/install-script suffixes and ambiguous Windows paths are rejected before staging; browser JS/HTML/CSS and business templates remain valid. This is a constrained agent-resource boundary, not a recursive archive malware scanner or a local sandbox. Runos local capability installation and future sandbox supply are separate from an agent product package. Existing 1.17.1 bid package passes the new preflight; no Windows reinstallation is involved.

实现批次：验证器采用 Ed25519。发布者签原始 CHECKSUMS；Registry 副署签固定域标识、发布者标识、CHECKSUMS 摘要及发布者签名。两个公钥均来自宿主的可信配置，包内不能自带信任锚。先用临时测试密钥验收；生产公钥和签发流程由 Registry 接入。

本批：宿主从受管的 `RUYIN_PACKAGE_TRUST_FILE` 加载公钥，未配置则继续拒绝正式包，配置无效则启动时报错。签发端原型只用临时密钥对仓库的标书样例做端到端验证，不生成或分发正式密钥。

信任文件为 JSON：`version` 为 `1`，`registryKey` 是 Registry 的 Ed25519 SPKI PEM 公钥，`publisherKeys` 按发布者 ID 映射同格式公钥。由宿主部署方设置文件路径和访问控制；文件不含私钥，也不由包提供。

桌面预检草案（合并前同步 RY-102）：`POST /products/preflight`，认证及二进制请求与 `/products/install` 一致；成功返回 `productId`、`name`、`publisher`、`version`、`runtimeMinimum`、`signed`，失败沿用 `PACKAGE_REJECTED` 错误封套。预检只读，不承诺已安装或任务就绪。安装仍重新检查原文件。
