# 任务：审计记录

## 元信息
- 状态：已完成
- 创建日期：2026-06-28
- 负责人：小主
- 当前执行Agent：deepseek
- 允许修改：`backend/`、本任务文件、`tasks/ACTIVE.md`、`tasks/README.md`
- 关联任务/决策：`docs/08-roadmap-agent-collaboration.md` 阶段1

## 目标
- 为所有数据变更操作建立不可抹除的审计日志。

## 背景与依据
- 阶段 1 要求审计能力。装修金额和决策需要可追溯，日志不可被普通编辑删除。

## 范围
- AuditEntry 模型与 Alembic 迁移。
- 审计记录函数（记录操作人、操作类型、目标表和变更前后数据）。
- 集成到 SourceEntry 和 Attachment 的写入路径。
- GET /api/v1/audit 查询接口（支持按表名、操作类型筛选和分页）。

## 非目标
- 不做事件溯源完整快照。
- 不做 audit 条目的修改或删除接口（审计本身不可篡改）。
- 不做前端审计查看页面（留到阶段 2）。

## 实施计划
- [x] 后端：AuditEntry 模型。
- [x] 后端：Alembic 迁移 0003。
- [x] 后端：审计记录函数 log_audit。
- [x] 后端：集成到 sources API（create_source、upload_attachment）。
- [x] 后端：GET /api/v1/audit 查询接口。
- [x] 后端：6 项测试。

## 执行记录
- 2026-06-28：添加 AuditEntry 到 `app/models.py`。
- 2026-06-28：生成 Alembic 迁移 `0003_add_audit`。
- 2026-06-28：创建 `app/audit.py`（log_audit 函数，在同一事务中插入审计条目）。
- 2026-06-28：创建 `app/api/audit.py`（GET /audit，支持 target_table/action/limit 筛选）。
- 2026-06-28：在 `app/api/sources.py` 的 create_source 和 upload_attachment 中调用 log_audit。
- 2026-06-28：在 `app/main.py` 注册 audit router。
- 2026-06-28：6 项测试覆盖：来源审计、附件审计、分页、按操作筛选、降序排列、认证拦截。
- 2026-06-28：pytest 31/31 通过；Ruff 通过（遗留 B008/B006 为非阻塞 FastAPI 惯用模式）。

## 跨模型交接
- 已完成内容：审计记录全栈实现（后端 6 项测试）。
- 修改文件：新增 `app/audit.py`、`app/api/audit.py`、`migrations/versions/0003_add_audit.py`、`tests/test_audit.py`；修改 `app/models.py`、`app/api/sources.py`、`app/main.py`、`tests/test_migrations.py`。
- 已执行检查及结果：pytest 31/31 通过；Ruff 通过（仅 B008/B006 非阻塞警告）；前端无变更。
- 未完成内容与下一步：阶段 1 剩余的目标（导出恢复）已跳过；接下来可进入阶段 2（八类业务记录 + 核心视图）。
- `tasks/ACTIVE.md`是否已释放：是
