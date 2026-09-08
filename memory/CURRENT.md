# 当前任务

## 2026-09-08 手机和平板 UI 修复

- `frontend/src/styles/components.css`、`frontend/src/styles/responsive.css` 及相关项目记忆已提交并推送至 `origin/main`；尚未部署 Ubuntu。
- 多选 Portal 的层级被 legacy 层后续 `.multi-select-options` 规则降为 12，低于记录抽屉 40；在新样式层统一恢复菜单层级。
- 字段和手机表单轨道使用 `minmax(0, 1fr)`，日期控件取消原生外观并保留日期输入功能，降低固有宽度撑开候选卡的风险。
- 平板金额卡提前改为两列，筛选区、图表和概览阶段面板补充中等宽度布局。
- 86 项前端测试及 `npm run build` 通过，保留既有 EChart 分块体积提示。
- 本地浏览器使用真实 RecordEditFields 与模拟布局验证 375/768/1024/1180/1280 宽度，无页面横向溢出，日期框未超出字段；单选、多选可展开并更新，菜单点击命中通过。临时验证文件已清理。
- 仍需部署后在用户原手机、平板浏览器复测；不能将 Chromium 尺寸模拟等同于真实 iOS/WebKit 验收。

## 上次部署记录（2026-08-26）

## 状态

- 任务：修复手机端原生日期/时间控件越出父组件的问题，更新 GitHub 并部署 Ubuntu Docker 服务。
- 状态：提交、推送、镜像构建、真实数据备份、容器切换和局域网终验均已完成。
- 日期：2026-08-26。

## 发布结果

- 本地与 `origin/main` 比对无分叉后，将 5 个预期文件以提交 `1895a5f9c11b`（`修复手机界面BUG`）推送到 GitHub。
- `npm run lint`、10 个测试文件/86 项测试和 `npm run build` 均通过；仅保留既有 EChart 分块超过 500 kB 警告。
- 手机原生控件约束覆盖 `date`、`time`、`datetime-local`、`month`、`week` 及 WebKit 内部编辑区；仍需在原问题手机浏览器复测。

## Ubuntu 部署结果

- `ubuntu26` 已快进到提交 `1895a5f9c11b`，并使用一次性临时 Dockerfile 构建镜像 `homebuild-log:1895a5f9c11b`。
- 构建使用 DaoCloud、npmmirror 和清华 PyPI，国内源全部可用；未启用 Mihomo，结束时服务为 `inactive`，7890/9090 未监听。
- 停写后备份 `.local-data` 到 `deploy/.deployment-backups/local-data-20260826T131937Z.tar.gz`，对应 SHA-256 校验通过，备份及校验文件权限为 600。
- 新容器实际运行目标镜像，状态为 `healthy`，重启策略为 `unless-stopped`；启动日志未见迁移或应用错误。
- SQLite 完整性为 `ok`，数据库 revision 保持 `0019_add_pitfall_logs`；65 条记录、59 条来源、16 条问题、7 条关系、1 条旧待办备份、1 条踩坑和 0 条踩坑处理记录均保留。
- 服务继续只绑定 `192.168.1.17:8000`；Ubuntu 与同网段 Windows 的首页均返回 HTTP 200，健康接口全部为 `ok`。

## 后续关注

- 在出现问题的真实手机浏览器上复测日期和时间控件是否仍越出父组件。
- 现有管理员密码未修改；若已遗失，只能执行受控密码重置，不能从 `secrets.json` 的哈希反推出明文。
- 手机真实登录和 Ubuntu 整机重启恢复仍待验收。

## 工作区状态

- 本地 `main` 与 `origin/main` 已同步，工作区干净；本轮平板界面适配尚未部署 Ubuntu。
- `README.md` 未修改。
