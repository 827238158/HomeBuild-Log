# 任务：来源与附件元数据

## 元信息
- 状态：已完成
- 创建日期：2026-06-28
- 负责人：小主
- 当前执行Agent：deepseek
- 允许修改：`backend/`、`frontend/`、本任务文件、`tasks/ACTIVE.md`、`tasks/README.md`
- 关联任务/决策：`docs/08-roadmap-agent-collaboration.md` 阶段1、`docs/06-domain-model.md`

## 目标
- 实现 SourceEntry 和 Attachment 的持久化模型、数据库迁移、API 端点和前端录入表单。

## 范围
- SQLAlchemy 模型（SourceEntry、Attachment）。
- Alembic 迁移。
- API：POST /sources、GET /sources/{id}、POST /attachments。
- 文件上传校验（类型、大小 ≤50MB、SHA-256）。
- 前端文本录入表单（含认证 token 自动附带）。

## 非目标
- 不实现 AI 提取、候选确认。
- 不实现附件缩略图、多文件批量上传。
- 不实现图片预览（留到阶段 4）。

## 实施计划
- [x] 后端：SQLAlchemy 模型。
- [x] 后端：Alembic 迁移。
- [x] 后端：API 端点与文件上传。
- [x] 后端：测试。
- [x] 前端：来源录入表单与附件上传。
- [x] 前后端联调与测试。

## 执行记录
- 2026-06-28：创建 `app/models.py`（SourceEntry + Attachment 模型）。
- 2026-06-28：生成 Alembic 迁移 `0002_add_sources_and_attachments`。
- 2026-06-28：实现 `app/api/sources.py`（POST /sources、GET /sources/{id}、POST /attachments 含文件类型/大小/SHA-256 校验）。
- 2026-06-28：修复循环导入（db.py 不再导入 models，改为 env.py 导入）。
- 2026-06-28：实现 `tests/test_sources.py`（9 项测试覆盖 API 和文件上传流程）。
- 2026-06-28：更新 `frontend/src/api.ts`（createSource + 认证头）。
- 2026-06-28：更新 `frontend/src/App.tsx`（登录后展示文本录入表单 + 已保存列表）。
- 2026-06-28：更新 `frontend/src/styles.css`（表单和列表样式）。
- 2026-06-28：后端 25 项测试通过、Ruff 通过；前端 6 项测试、lint、build 通过。

## 跨模型交接
- 已完成内容：SourceEntry/Attachment 全栈实现（后端 9 项测试 + 前端录入表单）。
- 修改文件：新增 `app/models.py`、`app/api/sources.py`、`migrations/versions/0002_*.py`、`tests/test_sources.py`；修改 `app/main.py`、`app/db.py`、`migrations/env.py`、`tests/test_migrations.py`、`tests/test_auth.py`、`frontend/src/api.ts`、`frontend/src/App.tsx`、`frontend/src/styles.css`；新增 `docs/progress-summary.md`。
- 已执行检查及结果：pytest 25/25 通过；Vitest 6/6 通过；tsc 通过；Vite build 通过；Ruff 通过。
- 未完成内容与下一步：子任务 C 审计记录。
- `tasks/ACTIVE.md`是否已释放：是
