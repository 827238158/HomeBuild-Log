# 当前任务

## 状态

- 任务：修复手机端原生日期/时间控件越出父组件的问题，并发布到 GitHub 与 Ubuntu Docker 服务。
- 状态：本地实现和自动化验证已完成，待提交、推送和部署。
- 日期：2026-08-26。

## 本轮结果

- 表单网格、选择控件统一增加 `width: 100%`、`min-width: 0` 和 `max-width: 100%` 收缩约束。
- 原生控件约束从 `date` 扩展到 `date`、`time`、`datetime-local`、`month`、`week`。
- 显式约束 WebKit 的日期时间值和编辑区，避免手机浏览器固有宽度撑破父组件。
- 前序 Ubuntu 部署事实和远程 sudo 管道陷阱已归档到 `MEMORY.md`、`LOG.md` 与 `PITFALLS.md`。

## 验证

- `npm run lint` 通过。
- 前端完整测试通过：10 个测试文件、86 项测试。
- `npm run build` 通过；仅保留既有的 EChart 分块超过 500 kB 警告。
- 320/360/390/412px Chromium 几何回归无溢出；仍需在出现问题的真实手机浏览器复测。

## 部署基线

- Ubuntu 当前镜像为 `homebuild-log:f255e5a89414`，数据库 revision 为 `0019_add_pitfall_logs`。
- 服务只绑定有线地址 `192.168.1.17:8000`；真实数据、备份和局域网访问基线必须保留。
- 更新构建优先使用 DaoCloud、npmmirror 和清华 PyPI；国内源失败时才临时启用 Mihomo，并在结束时关闭。

## 工作区状态

- 待提交文件为 `frontend/src/styles/components.css`、`memory/MEMORY.md`、`memory/CURRENT.md`、`memory/LOG.md`、`memory/PITFALLS.md`。
- `README.md` 未修改。
