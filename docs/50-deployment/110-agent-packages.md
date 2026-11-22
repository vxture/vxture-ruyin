# 智能体包交付与签名

## 当前边界

RUYIN 安装包不捆绑业务智能体。产品通过 `.ruyinpkg` 独立安装及更新。
运行环境生产模式必须同时验证发布者签名和 Registry 副署。
公钥由宿主提供，包内携带的公钥不能成为信任来源。

`ruyin pack` 生成未签名包，便于构建及检查。正式交付还需要权威发布者密钥、
Registry 密钥、宿主公钥分发和包下载通道。目前未配置正式密钥和默认宿主信任根，
因此新构建的标书包不能标为可面向普通用户安装的正式包。

## 构建后签名

先构建工作区，在受控签名环境中执行：

```powershell
node scripts/release/sign-agent-package.mjs `
  --input <unsigned.ruyinpkg> --output <new-signed.ruyinpkg> `
  --publisher-key <publisher-private.pem> --registry-key <registry-private.pem> `
  --trust <public-trust.json> --runtime-version 0.2.1-beta.1
```

工具不生成生产密钥。私钥只放受控签名环境，不提交源码、不进入客户端或产品包。
当前构建工具要求可读取的 Ed25519 私钥文件；未来密钥服务/HSM 接口需另行接入。
公钥 JSON 格式与宿主 `parsePackageTrust` 一致：`version: 1`、`registryKey`，
以及按发布者 ID 索引的 `publisherKeys`，公钥均为 Ed25519 SPKI PEM。

签名前运行实际宿主预检，检查摘要、契约、版本要求、UI 及禁止的原生代码。
私钥导出的公钥必须匹配公钥配置和 manifest 发布者。
签名只新增 `SIGNATURE`，不修改原包内容；完成后再次经过实际宿主的强制签名预检。
已有签名、已有输出文件或输入输出相同均拒绝。输出只含产品、版本、发布者、摘要与大小。

现有实现需要在受控构建环境中同时读取两把私钥；它不是独立 Registry 审核服务，
不表示已建立发布者与平台的权限分离。正式上线需确定签名职责及私钥隔离方案。

## 正式交付所需配置

1. 确认发布者身份、公钥及密钥轮换责任，独立管理 Registry 权威密钥。
2. 将经批准的公开信任材料配置给宿主；当前入口是 `RUYIN_PACKAGE_TRUST_FILE`。
   用户手动下载并随意信任包内密钥不属于正式方案。
3. 通过下述目录准备工具保留已签包原始字节，生成签名后摘要与大小，再发布到受信下载地址。
   当前 `ruyin registry` 会重新构建未签名包，不能直接用它替代已签包的交付目录。
4. 在普通生产配置下验收预检、首次安装、版本更新、回滚、卸载及拒绝篡改包。

不要以允许未签名包的开发开关代替上述步骤。公钥入口或签名策略的运行时改动
需要下一个宿主候选，不追溯改变已经提交商店的 0.2.1 文件。

## 已签包目录准备

构建签名后执行，`--package` 可重复指定：

```powershell
node scripts/release/prepare-agent-registry.mjs `
  --package <signed.ruyinpkg> --out <new-directory> `
  --base-url https://<approved-download-host>/products `
  --trust <public-trust.json> --runtime-version 0.2.1-beta.1
```

每个输入都经实际宿主的强制签名预检，全部通过后生成目录：
`<product>/<product>-<version>.ruyinpkg`、`index.json`、`SHA256SUMS`。
包文件逐字节保留，索引中的 `signed` 由验证结果决定，不能靠人工改标签。
私钥、公钥配置和本机文件路径不进入分发目录；原输入与现有输出目录不被覆盖。
基础地址要求 HTTPS、无账号密码和查询参数；数字回环 HTTP 仅用于本机集成验证。

工具只在本地准备新目录，不上传、不更新现网指针。
上传时先发布不可变版本包，确认下载摘要，再最后更新目录指针。
索引本身仍依赖 HTTPS；客户端在实际安装时会再次验证包签名，不能把目录可读取当作包可信。

集成测试通过宿主现有目录客户端发起真实回环 HTTP 请求，核对下载字节、摘要，
并在生产签名要求下安装；未签名、不可信、篡改、重复版本及覆盖请求均拒绝。
CI 的 build 阶段强制执行该测试，未产生构建产物时不能将它静默跳过。

## 当前标书候选

2026-11-22 由产品当前源码重建 `bidproposal-1.17.1.ruyinpkg`，
SHA256 `b850d6c7e001b95ebc3d27510aaafc2832630048db733f3dd2aaafd799f2da10`。
它包含当前桌面 UI 与契约，仍未正式签名。产品源码保留在独立产品仓库；
RUYIN 仓库中的同名产品只是测试资料，不作为用户默认安装来源。
