# 标书 P1：装进 RUYIN

沿用负责人已批准的本地登记替代 RY-001；V0 已通过，本批按原 P1“装进 RUYIN”推进。

1. 产品源码放到现有独立 vx-agent-bidproposal 仓库，不放入 RUYIN products 夹具。
2. 桌面产品内容页使用现有 RUYIN 外壳与产品桥，不增加登录、租户或全局导航。
3. 用现有 /bridge/documents/:id 保存 Markdown，提供未保存提示、冲突保护、关闭重开恢复。
4. 固定打包静态 UI 与契约摘要，生成 .ruyinpkg；不包含模型凭据、企业模板或试排产物。
5. 通过真实安装 API 导入，并在工作台打开项目验证，检查项目隔离与重开恢复。
6. 记录安装、浏览器验收及遗留范围；本批不宣称需求解读、模型自动编写和正式试排已交付。

开发验收使用允许未签名包的隔离宿主；生产签名策略保持严格。既有 Markdown 文档桥沿用 V0 接口，不新增业务 API。

## 2026-11-18 P1 acceptance record

- Independent product repository: D:/MyWebSite/vxture/vx-agent-bidproposal, branch codex/bid-p1-desktop-package.
- Package bidproposal-1.1.0.ruyinpkg generated; preflight HTTP 200 and install HTTP 201 through the real host handlers. Development unsigned admission was explicitly enabled only in the isolated harness.
- Browser confirmed product 1.1.0 opens inside the shared RUYIN shell. Created and saved two Markdown chapters; refreshed the workspace and recovered both chapter titles and first chapter content at revision 2.
- Product bridge origin/source validation, draft reopen/stale-write protection and malformed-input tests: 3 passed. Desktop syntax checks and product docs numbering passed. RUYIN harness smoke: 2 passed after updating its expected runtime version. Product-surface tests previously passed: 15.
- Remaining acceptance issue: opening a second workspace tab caused bridge save timeout; current editor content remained intact, but browser concurrency acceptance is NOT passed. The host health endpoint continued responding. Root cause needs investigation; do not infer credential invalidation or connection exhaustion without evidence.
- Browser file picker, full process restart persistence and cross-project browser isolation remain unverified in this batch. Installation was exercised through HTTP handlers, not the file picker.
- Initial checkpoint: P1 was available for single-window review while concurrency acceptance remained open. The follow-up acceptance below supersedes this checkpoint. P2 business features are not yet enabled. This is an isolated development host, not an installed Windows production update.
- Review URL: http://127.0.0.1:62501/?token=uiharness#ws/prj_f5817e5f9ef648358aa4276c81ebf8f2/product

## P1 follow-up acceptance: passed

- Fixed duplicate host SSE subscriptions: `Api.subscribe` now shares one connection across consumers, retains it until the last unsubscribe, and isolates consumer callback failures. Previously two workspaces could consume the HTTP/1 connection pool and block saves. Regression tests cover delivery, shared connection and unsubscribe lifecycle.
- Two actual browser windows loaded the same revision 3. Main window saved revision 4 successfully. The stale second window displayed a conflict and retained its Markdown. Copy plus explicit discard/read restored revision 4 without overwriting it.
- Switching to the other project showed an empty chapter list; the original project's two chapters remained unchanged.
- File picker selected the actual package; preflight displayed product/version/publisher/runtime/signature state. Confirming an already installed version correctly rejected the duplicate. Fresh installation previously passed through the same HTTP handlers (201); no claim of a second fresh installation through the picker.
- Stopped the isolated daemon process, then restarted against the same encrypted data directory. Browser recovered both chapters, their full bodies and revision 4. No project reseeding was needed.
- Added `RUYIN_HARNESS_DATA_DIR` for isolated restart acceptance; existing projects are retained and not reseeded. Default runs still create a temporary directory. `RUYIN_HARNESS_UNSIGNED=1` is only for local development; default package signature policy remains strict. `RUYIN_HARNESS_EMPTY=1` omits fixture tasks.
- UI API and product-surface tests: 132 passed; pending/workspace regression tests: 80 passed; TypeScript check, Vite build and harness smoke (2) passed. Product draft/bridge tests: 3 passed, docs numbering passed, both repository diffs passed whitespace checks. Existing bundle-size warning remains.
- Evidence: p1-conflict.jpg, p1-isolation.jpg, p1-package-preflight.jpg and p1-restart-restored.jpg in the task visualization directory.

P1 scope is complete for the desktop MVP development environment. Production signing/distribution and the later business stages belong to subsequent work; this is not a Windows installer release.
