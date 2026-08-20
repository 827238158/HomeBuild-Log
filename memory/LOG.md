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
| 2026-08-09 | README 改为用户手动维护 | `README.md` 不再随代码、部署或记忆变化由 Agent 自动更新；只有用户在当前任务中明确授权时才能修改，长期约束已写入 `AGENTS.md`。 |
| 2026-08-09 | Ubuntu 由 GitHub 源码更新容器 | `ubuntu26` 的 `/home/pawel/workspace/HomeBuild-Log` 已初始化为跟踪 `origin/main` 的 Git 仓库，并从提交 `425867a885ff` 构建镜像 `homebuild-log:425867a885ff`。Compose 容器启动后为 `healthy`，健康接口的应用、SQLite 与存储检查均为 `ok`，首页返回 HTTP 200；构建期间临时使用 Mihomo，结束后服务和 7890/9090 监听均已关闭。服务器当前仍为空数据验证环境，未做真实数据迁移验收。 |
| 2026-08-09 | Windows 真实数据迁移到 Ubuntu | Windows `.local-data` 经 SQLite 一致性快照和双层 SHA-256 校验后导入 `ubuntu26`，源数据和本地迁移包均保留。容器将数据库从 `0015_merge_procurement` 升级到 `0018_unify_relations`；迁移保护检查和计数核对确认 60 条记录、15 条问题、4 条关系、1 条旧待办备份无缺失。Compose 容器为 `healthy`，应用、SQLite 和存储检查均为 `ok`，Windows `127.0.0.1:8000` SSH 映射已恢复。 |
| 2026-08-18 | 独立踩坑记录功能落地 | 新增 `0019_add_pitfall_logs`，用独立踩坑与处理记录表保存轻量手工日志；处理状态由处理记录数量推导，AI 只在手动触发时汇总且不回写原始数据。 |
| 2026-08-20 | Windows 真实数据库升级到 0019 | 使用 SQLite 在线备份生成并校验唯一恢复点后，将真实数据库从 `0015_merge_procurement` 升级到 `0019_add_pitfall_logs`；完整性、外键和关键计数通过，健康接口 current/expected 一致。旧的 4 份 `0012–0015` 前备份已按授权删除。Windows 启动增加迁移门禁，健康接口增加 revision 检查，前端保留后端错误码。 |
