# 当前状态

## 最近确认：2026-09-21 Ubuntu Docker 部署

以下为该日已验证事实。

- `ubuntu26` 部署提交为 `cd76370c0f5046b7f47c2a76bb6309434d75d0a6`，镜像为 `homebuild-log:cd76370c0f50`，OCI 版本标签与短 SHA 一致。
- 容器运行且为 `healthy`，重启策略为 `unless-stopped`；仅绑定 `192.168.1.17:8000`。Ubuntu 本机和同网段 Windows 首页返回 HTTP 200，健康接口全部为 `ok`。
- 数据库 revision 为 `0019_add_pitfall_logs`，SQLite 完整性为 `ok`；计数和构建过程见 `LOG.md` 的 2026-09-21 记录。
- 两个部署提交间没有迁移文件变化；本次未创建数据恢复点，`.last-upgrade` 不存在，不具备本次部署的一键数据回退条件。
- 构建使用 DaoCloud、npmmirror 和阿里云 PyPI；Mihomo 未启用，结束时服务为 `inactive`，7890/9090 未监听。

## 待验收

- 原手机和平板浏览器上的响应式布局、日期控件及手机真实登录；桌面 Chromium 尺寸模拟不能替代真实 iOS/WebKit 验收。
- Ubuntu 整机重启恢复、机械硬盘运行和资源占用。
- 手机/PWA、离线同步、OCR 和视觉理解不属于已验收能力。
