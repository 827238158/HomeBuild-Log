<!-- project-agent-bootstrap:start -->
# 项目 Agent 工作规范

## 项目协作总规则
- 默认使用中文沟通，任务描述、风险说明和结论保持清晰直接。
- 称呼用户为「小主」。
- 开始任务前先理解目标、范围、风险和验收标准。
- 遵守项目内更具体的说明文件；如说明冲突，先指出冲突，再遵守更靠近当前任务的规则。
- 代码中的关键步骤使用中文注释；无法确认的结论必须标注「不确定」或「需要验证」。
- 不得编造文件路径、命令输出、软件版本、接口返回结果或项目结构。

## 项目定位与当前阶段
- 本项目是装修事件与知识管理系统，项目代号暂用 `HomeBuild Log`。
- 系统以用户对装修事实的自然描述为入口，将文本、图片和票据整理为可追溯的结构化记录。
- 当前阶段仅维护项目规划文档、任务体系、检查清单和 Agent 规范，不编写业务代码、不安装依赖、不创建数据库。
- 已确认技术规划基线为 React、TypeScript、Vite PWA、FastAPI、SQLite与本地附件目录；具体版本和配置必须在开发任务中通过Context7核对。
- 产品范围以 `docs/00-project-spec.md` 为准；概念模块与数据流以 `docs/01-architecture.md` 为准。

## Retrieval 流程
任何任务开始前：
1. 分析当前任务。
2. 判断需要哪些知识。
3. 先输出 `Need:` 列表。
4. 涉及写入时先读取`tasks/ACTIVE.md`，确认单写者状态。
5. 只读取 `Need:` 中列出的必要文档或文件。
6. 完成当前步骤。
7. Review 阶段如发现信息不足，再进行下一次按需检索。
8. 完成后判断是否需要更新 `docs/` 或 `checklists/`。

## 跨模型单写者规则
- DeepSeek、Kimi、GPT等模型可按任务接手项目，但不建立固定Agent团队。
- 同一时刻只有`tasks/ACTIVE.md`记录的当前执行Agent可以修改项目；其他Agent只能只读审查。
- 当前执行Agent必须在任务文件记录改动、检查、未完成项、风险和下一步，交接后再释放写入权。
- 新Agent不依赖上一段聊天记录，必须通过任务文件和`Need:`恢复上下文。
- 未认领写入权、活动任务被占用或交接信息不完整时，不得修改项目。

示例：
```text
Need:
- docs/00-project-spec.md
- docs/02-style-guide.md
- checklists/implementation-review.md
```

## 禁止事项
- 禁止一次性读取全部项目或全部文档。
- 禁止为了小任务扫描整个项目。
- 禁止猜测 API、项目规范、架构和命令。
- 禁止未经确认大改架构。
- 信息不足时必须明确声明 `Need:` 或说明未知点。

## Review 要求
- 每次任务完成后必须执行 `checklists/implementation-review.md`。
- 如发现文档过期，必须按需更新对应文档。
- 如涉及规则、架构、API、流程变化，必须检查 `checklists/docs-update.md`。

## Python 与本地环境
- 默认操作系统为 Windows 11，默认 Python 为 Conda `base` 环境的 `D:\Anaconda\python.exe`。
- 执行 Python 前确认解释器；安装依赖前确认当前环境，默认使用与该解释器对应的 `pip install`。
- 不得混用 Conda、pip 与系统 Python；非必要不创建新环境。
- 读写中文文本时显式指定 UTF-8；遇到外部文件编码未知时增加检测或容错，不得静默损坏内容。
- 大模型文件优先下载到项目目录或用户指定位置，避免默认占用 C 盘；HuggingFace 不可用时可评估 ModelScope 同款或等价模型，但必须核对架构、用途、权重格式和适配库。
<!-- project-agent-bootstrap:end -->
