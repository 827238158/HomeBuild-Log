# HomeBuild Log

HomeBuild Log 是面向个人业主的本地优先装修事实工作台。用户录入文字并可附加图片或 PDF 票据作为原始证据；系统保留来源，对文字生成候选信息，经用户确认后形成事件、账目、问题、尺寸、决策和调研记录。

## 当前可用范围

- 技术基线：React、TypeScript、Vite、FastAPI、SQLite 和本地附件目录。
- Windows 11 本地运行是当前正式可用方式。
- Ubuntu 26.04 已完成空数据 Docker 镜像构建、前端/API 健康检查和容器重启持久化验证。
- 真实数据迁移、Ubuntu 整机重启恢复、机械硬盘数据目录、局域网访问和资源占用仍需验收。
- AI 当前只分析文字；OCR、图像理解、离线同步和完整 PWA 能力尚未实现。

## 快速开始

已安装依赖后，可双击根目录 `HomeBuild-Log.cmd` 使用 Windows 本地控制菜单启动、停止、查看状态和打开页面。

手动启动、依赖安装、测试、构建、Docker 部署和迁移命令统一维护在 [memory/RUNBOOK.md](memory/RUNBOOK.md)。本地开发前端默认访问 `http://127.0.0.1:5173`，后端健康接口为 `http://127.0.0.1:8000/api/v1/health`，OpenAPI 文档为 `http://127.0.0.1:8000/docs`。

## AI 基线

AI 默认关闭；MiMo 和 DeepSeek 作为 OpenAI 兼容供应商，未启用或未配置 Key 时，`auto` 模式使用本地规则。配置方式与环境变量名见 [memory/RUNBOOK.md](memory/RUNBOOK.md)。

## 文档与记忆入口

- [AGENTS.md](AGENTS.md)：Agent 行为、安全、检索与记忆更新规则。
- [DESIGN.md](DESIGN.md)：唯一 UI/视觉规范。
- [memory/MEMORY.md](memory/MEMORY.md)：稳定事实与按需检索路由。
- [memory/CURRENT.md](memory/CURRENT.md)：当前任务、验收、进展和下一步。
- [memory/LOG.md](memory/LOG.md)：重要操作、部署、迁移与长期决策。
- [memory/RUNBOOK.md](memory/RUNBOOK.md)：启动、测试、构建、部署、迁移和恢复命令。
- [memory/PITFALLS.md](memory/PITFALLS.md)：按问题类型整理的重复性陷阱。
- [backend/migrations/README.md](backend/migrations/README.md)：数据库迁移子系统索引。
- [deploy/README-UBUNTU.md](deploy/README-UBUNTU.md)：Ubuntu 离线部署操作说明。

未来 Agent 的默认读取集仅为 `AGENTS.md`、`memory/MEMORY.md`、`memory/CURRENT.md`；其他文件按任务需要读取。

## 本地数据

运行数据统一位于项目根目录 `.local-data/`，包括 SQLite、附件、配置和运行状态。该目录不进入 Git；密钥、令牌、票据原文和个人信息不得写入普通 Markdown、日志或提交信息。
