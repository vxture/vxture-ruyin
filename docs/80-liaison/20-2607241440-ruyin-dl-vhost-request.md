# Liaison request: dl.vxture.com 下载主机与边缘 vhost（L2）

- Stamp: 2607241440 (2026-07-24 14:40)
- From: ruyin line
- To: platform line (owns the shared public edge + worker fleet)
- Status: open - awaiting platform-line decision
- 阻塞关系: 阻塞本仓 workplan **W4（发布基建）**；当前 W3 开发不受影响

## Context

Ruyin 的发布模型是 tag→渠道构件发布（设计: 本仓 `30-design/70-repo-organization.md` §7）：

```text
dl.vxture.com/ruyin/
├── stable/  Ruyin-Setup-x.y.z.exe (+.blockmap) + latest.yml + manifest.json
├── beta/    同构
└── products/  .ruyinpkg 产品包 + index.json（静态 Registry）
```

- 构件为**纯静态文件**，单安装包约 100–140MB；electron-updater 走 latest.yml 差量更新
- 网站（vxture.com/appcenter）只消费 `manifest.json` 渲染下载入口，不感知发布流程
- CI 上载复用 org 稳健 CD 构件（tailnet-ssh-connect + rsync staging 原子切换），
  需要一套 Environment 级 `DEPLOY_*` 指向下载主机

## Request (platform line)

1. **主机选址**: 指定承载静态下载目录的境内 worker（考虑磁盘与带宽——
   安装包 140MB 级，初期下载量低，后续可前置 OSS/CDN、源站不动）；
   给出 stack_root（建议 `/srv/md0/ruyin-dl`）。
2. **边缘 vhost**: `dl.vxture.com` 指向该主机静态站点（纯静态 file server，
   无 upstream 应用；需 HTTPS + 正确的 content-type，`.yml`/`.exe`/`.blockmap`）。
3. **DNS**: `dl.vxture.com` 解析到共享 edge。
4. 确认后 ruyin 线自行完成: nginx 静态站点配置稿、Environment secrets 配置、
   release.yml 上载流水线（W4）。

## 备注

- 下载主机只放公开构件，无敏感内容；防篡改依赖 HTTPS + manifest/feed 内哈希
  + 产品包双签（`30-design/30-contract-schema.md` §18.2）
- 代码签名证书采购（本仓 TD-001）与本函并行推进，不互相阻塞
