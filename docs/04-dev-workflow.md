# 开发与跨模型协作流程

## 单写者原则

- DeepSeek、Kimi、GPT等不同模型可按任务接手项目，但不组成固定Agent团队。
- 同一时刻只有`tasks/ACTIVE.md`中的“当前执行Agent”可以修改项目。
- 其他Agent只能只读检索、审查或提出建议，不能直接修复。
- 当前执行Agent完成或交接后必须释放写入权，新Agent才能认领。

## 任务开始

1. 读取`AGENTS.md`并输出当前步骤的`Need:`。
2. 读取`tasks/ACTIVE.md`，确认写入权未被占用或任务已明确交接给自己。
3. 默认采用轻量化流程：在`tasks/ACTIVE.md`登记当前执行Agent与任务简述并认领唯一写入权。
4. 只读取`Need:`中的资料；信息不足时再进行下一轮按需检索。
5. 只有用户明确要求完整流程时，才创建独立任务文件并执行完整清单；不得因改动文件多、涉及架构/API或数据库而自动升级。

## 轻量化流程（默认）

所有任务默认使用轻量化流程，不按文件数量或技术风险自动切换：

1. 读取`AGENTS.md`并输出`Need:`。
2. 读取`tasks/ACTIVE.md`，登记当前执行Agent和任务简述。
3. 在用户授权范围内执行修改，并按风险选择验证。
4. 完成后在`tasks/AGENT-ACTIVITY-LOG.md`追加一行，记录日期、任务描述、执行Agent、改动摘要和状态。
5. 释放`tasks/ACTIVE.md`写入权。

轻量化流程不强制创建独立任务文件、更新`tasks/README.md`、执行完整checklist或审查全部长期文档。测试、lint、build和迁移验证由改动风险决定，但必须如实说明实际执行与未覆盖项。

用户可明确限定文件范围；如果该范围排除了任务记录，应先确认是否将其视为本次登记规则的例外。

## 完整流程（仅用户明确要求）

1. 从`tasks/TASK-TEMPLATE.md`创建任务，明确目标、非目标、验收、风险和允许修改文件。
2. 在`tasks/README.md`登记任务状态并认领活动锁。
3. 执行修改和与风险相称的验证。
4. 逐条执行`checklists/implementation-review.md`与`checklists/docs-update.md`。
5. 检查任务体系、协作路线图、决策记录和活动日志的过期风险。
6. 完成交接记录并释放写入权。

## 执行与验证

1. 小步修改，不把范围外重构混入当前任务。
2. 关键决策写入任务执行记录；范围变化先更新任务。
3. 运行与风险相称的检查，记录真实命令、结果和未覆盖项。
4. 完整流程执行`checklists/implementation-review.md`与`checklists/docs-update.md`；轻量化流程按需使用。
5. 涉及长期有效的规格、架构、契约和决策时同步相应文档。
6. 验收通过后更新要求范围内的任务记录并释放`tasks/ACTIVE.md`。

## 跨模型交接

完整流程交出写入权前，当前Agent必须在任务文件记录：

- 已完成内容和修改文件。
- 实际执行的检查、命令与结果。
- 未完成步骤和可直接执行的下一步。
- 已知风险、不确定项和用户待确认事项。
- 当前工作区是否存在未验收改动。
- 是否已在`tasks/AGENT-ACTIVITY-LOG.md`追加记录。
- 是否已释放`tasks/ACTIVE.md`。

轻量化流程只强制活动日志和活动锁两项记录；如存在未完成内容或已知风险，应在最终交付中明确说明。

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
- `已完成`：所选流程要求的验收、记录和写入权释放均完成。
- `已取消`：明确停止并记录原因。

## 当前技术规划

- 前端：React、TypeScript、Vite响应式Web；PWA安装与离线能力属于阶段4规划。
- 后端：Python、FastAPI。
- 存储：SQLite和本地附件目录。
- 访问：当前为Windows本地自托管；私有组网HTTPS属于阶段4规划。

当前工程和依赖已经落地。涉及库、框架、SDK、API、CLI或云服务的用法、配置、升级与库特定调试时，按`AGENTS.md`要求先通过Context7核对当前官方文档；普通业务逻辑和文档整理不需要为此调用Context7。

## 测试、构建与运行命令

- Python要求：3.13。当前项目已有专用Conda环境`homebuild-log`；执行前先确认解释器与pip属于同一环境，不要重复创建环境或混用base、项目环境和系统Python。
- Windows显式解释器：`D:\Anaconda\envs\homebuild-log\python.exe`；如使用已激活环境，可将下列`python`替换为该完整路径。
- 后端安装：在`backend/`执行`python -m pip install -r requirements.lock`和`python -m pip install -e . --no-deps`。
- 后端迁移：`python -m alembic -c alembic.ini upgrade head`。
- 后端启动：在已激活项目环境中执行`fastapi dev app/main.py --host 127.0.0.1 --port 8000`，或显式调用该环境的`fastapi.exe`。
- 后端检查：`python -m ruff check . --no-cache`和`python -m pytest`。
- 前端安装：在`frontend/`执行`npm ci`。
- 前端启动：`npm run dev`，固定访问`http://127.0.0.1:5173`。
- 前端检查：`npm run lint`、`npm run test`、`npm run build`和`npm audit`。
- 新增或调整命令时必须先真实执行，再同步README和本节。

## 提交与发布

- 当前未建立强制的分支、提交、PR和发布流程；Git操作必须由用户任务明确授权。
- 未来提交不得混入其他Agent未交接的更改。
- 发布前必须完成备份恢复演练、隐私检查、PWA更新验证和私有网络访问检查。
