# 当前状态

## 最近确认：2026-09-13 Ubuntu Docker 部署

以下为该日已验证事实，本轮记忆整理未重新连接服务器验证。

- `ubuntu26` 部署提交为 `e9bea3a8479a77ed035dc69c9115534fbff6d97a`，镜像为 `homebuild-log:e9bea3a8479a`。
- 容器运行且为 `healthy`，重启策略为 `unless-stopped`；仅绑定 `192.168.1.17:8000`。Ubuntu 本机和同网段 Windows 首页返回 HTTP 200，健康接口全部为 `ok`。
- 数据库 revision 为 `0019_add_pitfall_logs`，SQLite 完整性为 `ok`；计数和构建过程见 `LOG.md` 的 2026-09-13 记录。
- 本次未创建数据恢复点，`.last-upgrade` 不存在，不具备本次部署的一键数据回退条件。

## 待验收

- 原手机和平板浏览器上的响应式布局、日期控件及手机真实登录；桌面 Chromium 尺寸模拟不能替代真实 iOS/WebKit 验收。
- Ubuntu 整机重启恢复、机械硬盘运行和资源占用。
- 手机/PWA、离线同步、OCR 和视觉理解不属于已验收能力。

## 待核实的历史技术问题

- 历史迁移 `0016_retire_legacy_detail_tables.py` 曾有 3 个 Ruff `E501`；当前是否仍存在需要验证，处理线索见 `PITFALLS.md`。
- 曾观察到存在前端 `dist` 且使用合法 token 时，未知 `/api/v1/*` 返回 SPA 页面；当前是否仍存在需要验证，处理线索见 `PITFALLS.md`。
