<!-- project-agent-bootstrap:start -->
# 项目 Agent 工作规范

## 项目协作总规则
- 称呼用户为「小主」。
- 代码中的关键步骤使用中文注释；无法确认的结论标注「不确定」或「需要验证」。
- 不得编造文件路径、命令输出、软件版本、接口返回结果或项目结构。
- 如 docs/ 内说明冲突，指出冲突后遵守更靠近当前任务的规则。

## 项目定位与当前阶段
- 本项目为装修事件与知识管理系统，代号 `HomeBuild Log`。
- 阶段 2 已完成；下一候选任务为阶段 3 文本AI录入。
- 技术基线：React/TypeScript/Vite PWA、FastAPI、SQLite、本地附件目录。
- 产品范围以 `docs/00-project-spec.md` 为准；概念模块与数据流以 `docs/01-architecture.md` 为准。

## Retrieval 流程
- 任何任务开始前先输出 `Need:` 列表，只读取必要的文档。
- 涉及写入时先读取 `tasks/ACTIVE.md` 确认单写者状态。
- 信息不足时再进行下一轮按需检索。
- 完成后判断是否需要更新 `docs/` 或 `checklists/`。

## 跨模型单写者规则
- DeepSeek、Kimi、GPT 等模型可按任务接手，同一时刻只有 `tasks/ACTIVE.md` 记录的 Agent 可以修改项目。
- 当前执行 Agent 必须在任务文件记录改动、检查、未完成项、风险，交接后再释放写入权。
- 新 Agent 不依赖上一段聊天记录，通过任务文件和 `Need:` 恢复上下文。
- 详细协作流程见 `docs/04-dev-workflow.md`，协作模型见 `docs/08-roadmap-agent-collaboration.md`。

## 禁止事项
- 禁止一次性读取全部项目或全部文档。
- 禁止为了小任务扫描整个项目。
- 禁止猜测 API、项目规范、架构和命令。
- 禁止未经确认大改架构。
- 信息不足时必须明确声明 `Need:` 或说明未知点。

## Review 要求
- 任务完成后必须执行 `checklists/implementation-review.md`（逐条对照）。
- 如涉及规则、架构、API、流程变化，检查 `checklists/docs-update.md`。
- 任务完成后审查以下文件过期风险：`tasks/README.md`、`docs/08-roadmap-agent-collaboration.md`、`docs/05-decisions.md`。

## 本地环境
- 默认 Python：Conda `base` 环境的 `D:\Anaconda\python.exe`，对应 pip。
- 读写中文文本时显式指定 UTF-8。
- 大模型文件优先下载到项目目录或用户指定位置，避免占用 C 盘。
<!-- project-agent-bootstrap:end -->
