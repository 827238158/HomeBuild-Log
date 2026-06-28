# 开发与跨模型协作流程

## 单写者原则

- DeepSeek、Kimi、GPT等不同模型可按任务接手项目，但不组成固定Agent团队。
- 同一时刻只有`tasks/ACTIVE.md`中的“当前执行Agent”可以修改项目。
- 其他Agent只能只读检索、审查或提出建议，不能直接修复。
- 当前执行Agent完成或交接后必须释放写入权，新Agent才能认领。

## 任务开始

1. 读取`AGENTS.md`并输出当前步骤的`Need:`。
2. 读取`tasks/ACTIVE.md`，确认写入权未被占用或任务已明确交接给自己。
3. 从`tasks/TASK-TEMPLATE.md`创建任务，明确目标、非目标、验收、风险和允许修改的文件。
4. 在`tasks/README.md`登记状态、在`tasks/AGENT-ACTIVITY-LOG.md`添加活动记录，并在`tasks/ACTIVE.md`认领唯一写入权。
5. 只读取`Need:`中的资料；信息不足时再进行下一轮按需检索。

## 执行与验证

1. 小步修改，不把范围外重构混入当前任务。
2. 关键决策写入任务执行记录；范围变化先更新任务。
3. 运行与风险相称的检查，记录真实命令、结果和未覆盖项。
4. 执行`checklists/implementation-review.md`。
5. 执行`checklists/docs-update.md`，同步长期有效的规格、架构、契约和决策。
6. 验收通过后更新任务状态并释放`tasks/ACTIVE.md`。

## 跨模型交接

交出写入权前，当前Agent必须在任务文件记录：

- 已完成内容和修改文件。
- 实际执行的检查、命令与结果。
- 未完成步骤和可直接执行的下一步。
- 已知风险、不确定项和用户待确认事项。
- 当前工作区是否存在未验收改动。
- 是否已在`tasks/AGENT-ACTIVITY-LOG.md`追加记录。
- 是否已释放`tasks/ACTIVE.md`。

新Agent只能依靠项目任务文件和明确的`Need:`恢复上下文，不把上一模型的聊天记录视为项目事实。接手后先核对工作区和活动任务，再继续修改。

## 只读审查

- 审查Agent不得认领写入权，也不得修改文件。
- 审查结果应指出文件、位置、风险和建议，由当前执行Agent决定并实施修复。
- 审查意见与项目文档冲突时，以更具体的项目规则和用户确认决定为准。

## 任务状态

- `待梳理`：目标或边界不完整。
- `可开始`：依赖和验收已明确，尚未认领写入权。
- `进行中`：已由当前执行Agent认领。
- `受阻`：存在当前授权或条件无法解决的阻碍。
- `待验收`：交付和自检完成，等待验收。
- `已完成`：验收、Review、文档更新和写入权释放均完成。
- `已取消`：明确停止并记录原因。

## 当前技术规划

- 前端：React、TypeScript、Vite PWA。
- 后端：Python、FastAPI。
- 存储：SQLite和本地附件目录。
- 访问：Windows本地自托管、私有组网HTTPS。

以上是规划基线，不代表依赖已安装。进入开发任务前必须通过Context7核对当前版本、配置和迁移要求。

## 测试、构建与运行命令

- Python环境：`conda create -n homebuild-log python=3.13 pip -y`，之后必须激活该环境或显式使用对应解释器。
- 后端安装：在`backend/`执行`python -m pip install -r requirements.lock`和`python -m pip install -e . --no-deps`。
- 后端迁移：`python -m alembic -c alembic.ini upgrade head`。
- 后端启动：`fastapi dev app/main.py --host 127.0.0.1 --port 8000`。
- 后端检查：`python -m ruff check . --no-cache`和`python -m pytest`。
- 前端安装：在`frontend/`执行`npm ci`。
- 前端启动：`npm run dev`，固定访问`http://127.0.0.1:5173`。
- 前端检查：`npm run lint`、`npm run test`、`npm run build`和`npm audit`。
- 新增或调整命令时必须先真实执行，再同步README和本节。

## 提交与发布

- 当前分支、提交、PR和发布规则尚未建立。
- 未来提交不得混入其他Agent未交接的更改。
- 发布前必须完成备份恢复演练、隐私检查、PWA更新验证和私有网络访问检查。
