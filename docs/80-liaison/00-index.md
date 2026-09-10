# 80-liaison 索引

与**上游线**来往函件 —— 平台线为主，2026-09-10 起也收 DS 线（`vxture/vxture-design`）。
命名照 org 惯例 `NN-YYMMDDHHMM-ruyin-<slug>.md`。

> **定位改过一次（2026-09-10）**：原文写的是「与平台线来往函件」。发 TD-040 给 DS 线
> 时发现这个定位把它挡在外面了 —— 而一封发出去了、却在索引里没有落点的函件，比
> 没发更难查。改成「上游线」。**业务产品线仍不在其中**：`40-implementation/50` 那份
> 《能力面接入说明》要不要走函件形式发给产品线，owner 未定，暂不擅自归到这里。

| 函件 | 事项 | 状态 | 阻塞 |
|---|---|---|---|
| `10-2607241430-ruyin-desktop-distribution-profile.md` | L1 桌面分发剖面报备 + 模板 pnpm 11 反馈 | open | 无（纪律性） |
| `20-2607241440-ruyin-dl-vhost-request.md` | L2 下载主机选址 + `dl.vxture.com` vhost | open | W4 |
| `30-2607241450-ruyin-native-client-integration.md` | L3 原生客户端三件（PKCE / entitlement / AI Gateway） | (a) met · (b) partial · (c) withdrawn（ADR-009） | (b) 剩余 → 产品自动拉取 |
| `40-2608301530-ruyin-l3-client-registration-blockers.md` | L3 补充：回调登记 / ruyin-beta / 权益基址（附实测） | (1)(2) met · (3) open | C2 公网基址 |
| `50-2609101850-ruyin-native-session-management.md` | accounts 补齐原生客户端会话管理三件同源：`prompt` 兑现 / `post_logout_redirect_uri` 兑现 / 设备列表与远程吊销（附四组实测回应） | open | 「退出登录」在用户那里成立（不阻塞开发） |
| `60-2609101900-ruyin-design-tokens-comfortable-density.md` | **DS 线**：`@vxture/design-tokens@3.0.0` 宽松档 inset/row 两组与默认档逐字相同，只有 control 抬了一档（附源文件逐行对照） | open | 不阻塞；ruyin 已自行撑开容器作过渡 |
| vxture-platform/vxture-platform#198（issue，按 §10 开在平台仓） | L4 bid 云端能力面接入：OBO subject_token 受众（现规则必拒）+ bid 按暂用名登记 | open | 生产上 bid 三个鉴权端点 |
