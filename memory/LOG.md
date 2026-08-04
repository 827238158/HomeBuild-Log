# 操作日志

只记录会影响未来判断的重要操作、迁移、部署、失败恢复和长期有效变更。不要写 Agent 身份、锁、阅读流水或普通进度。

| 日期 | 事项 | 摘要 |
| --- | --- | --- |
| 2026-07-20 | 文档系统替换为 AI 外部记忆层 | 旧项目管理式文档系统改为极简活文档；默认入口后续收敛为 `AGENTS.md`、`memory/MEMORY.md`、`memory/CURRENT.md`。 |
| 2026-07-21 | 记忆文件收纳到专门目录 | 将运行记忆文件移动到 `memory/`，根目录保留 `AGENTS.md`、`README.md`、`DESIGN.md`。 |
| 2026-08-03 | Ubuntu Docker 验证环境初始化 | `ubuntu26`（Ubuntu 26.04）已安装 Docker Engine 29.7.1、Buildx 0.36.0、Compose 5.3.1；Docker 服务开机自启，`hello-world` 容器验证通过。Docker Hub 拉取需临时启动 Mihomo，验证后代理已关闭；HomeBuild Log 项目镜像与持久化部署尚未验收。 |
| 2026-08-03 | HomeBuild Log 空数据容器实机验证 | 当前工作树已传至 `/home/pawel/workspace/HomeBuild-Log`，镜像 `homebuild-log:4a-20260715` 构建成功；前端首页、健康接口、SQLite/存储、只读根文件系统和容器重启持久化均通过。修复 Linux 运行锁缺少 PyJWT 与部署目录数值 UID/GID 赋权失败；真实数据、整机重启和局域网访问未验收。 |
| 2026-08-04 | 活文档与 Agent 记忆漂移检修 | 继续使用 `AGENTS.md` 与 `memory/` 轻量记忆层，未恢复旧 `docs/`、`tasks/`、`checklists/` 文档树；对齐 README 能力边界和 Ubuntu 状态，修正 Ubuntu 版本、迁移 current head、DESIGN 候选关联与 LOG 检索路由。 |
| 2026-08-04 | 项目记忆检索与归档提醒闭环 | 项目级 Hook 形成“定向检索—高信号失败摘要—结束归档提醒”链路：不自动写记忆、不保存完整命令或日志，普通成功和单次临时失败不升级；详细逻辑收纳在 `.codex/hooks/`，不重复写入 `AGENTS.md`。 |
