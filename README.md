# HomeBuild Log

装修事件与知识管理系统。用户通过自然语言、图片或票据描述装修过程中发生的事情，系统将其整理为事件、账目、施工问题、尺寸、决策、采购、调研和待办记录，并通过时间线、账本、问题看板和空间档案呈现。

## 当前阶段

项目已完成阶段 1 本地数据底座和阶段 2 手工记录闭环；阶段 3A 已实现可选 DeepSeek/MiMo 文本提取、持久化候选、人工确认与黄金样本评测，本地规则继续作为无 Key、失败和断网时的兜底。阶段 3B 前置维护已补齐来源维护、正式记录详细修改/删除、来源版本复核和发生日期语义；阶段 3B 候选高级编辑、阶段 3C ECharts AI 可视化、阶段 4 OCR/PWA 及阶段 5 稳定化仍待单独授权。

规划基线：个人私用的响应式Web/PWA，Windows本地自托管，React/TypeScript/Vite PWA前端、FastAPI后端、SQLite与本地附件目录、可插拔AI，以及跨模型Agent单写者串行协作。

## 文档地图

- [AGENTS.md](AGENTS.md)：Agent 协作规则与按需检索流程。
- [项目规格](docs/00-project-spec.md)：目标用户、核心能力、非目标与未知项。
- [概念架构](docs/01-architecture.md)：模块、数据流与不可随意改动的边界。
- [代码与文档风格](docs/02-style-guide.md)：术语、注释、错误处理和文档规则。
- [接口契约](docs/03-api-contracts.md)：当前契约边界及未来记录要求。
- [开发流程](docs/04-dev-workflow.md)：任务、检查、测试、构建和提交约定。
- [决策记录](docs/05-decisions.md)：已确认决策及待决策事项。
- [领域模型](docs/06-domain-model.md)：来源、候选、八类记录、共享实体、状态和关联。
- [交互与可视化](docs/07-ux-visualization.md)：录入、确认、核心页面和响应式体验。
- [路线图与跨模型协作](docs/08-roadmap-agent-collaboration.md)：实施阶段、任务门禁、活动锁和交接规则。
- [真实事件样本](docs/samples/real-events.md)：保留原始描述并记录候选信息与一事多记录分析。
- [任务总览](tasks/README.md)：任务状态、当前任务和候选任务池。
- [当前活动任务](tasks/ACTIVE.md)：唯一写入Agent、任务范围和锁状态。
- [检查清单](checklists/task-start.md)：任务开始、实现审查、文档更新和发布检查入口。

## 开始下一项工作

1. 阅读 `AGENTS.md`，先输出本任务的 `Need:` 列表。
2. 读取`tasks/ACTIVE.md`确认写入权；只读任务不得认领写入锁。
3. 从 `tasks/TASK-TEMPLATE.md` 创建任务，明确范围、非目标、允许修改文件与验收标准。
4. 只读取当前步骤需要的资料，完成后执行 `checklists/implementation-review.md`并释放活动锁。

当前候选方向只是待梳理事项，不代表已批准实施；请先在 `tasks/README.md` 中确认或调整优先级。

## 本地开发基线

### 后端

```powershell
conda create -n homebuild-log python=3.13 pip -y
conda activate homebuild-log
Set-Location backend
python -m pip install -r requirements.lock
python -m pip install -e . --no-deps
python -m alembic -c alembic.ini upgrade head
fastapi dev app/main.py --host 127.0.0.1 --port 8000
```

后端健康接口：`http://127.0.0.1:8000/api/v1/health`；OpenAPI文档：`http://127.0.0.1:8000/docs`。

### 文本 AI 配置

AI 默认关闭。推荐先设置环境变量，再将`.local-data/config/secrets.json`中的`ai.enabled`改为`true`；环境变量优先于文件内Key：

```powershell
$env:DEEPSEEK_API_KEY = "你的 DeepSeek Key"
$env:MIMO_API_KEY = "你的 MiMo Key"
```

`secrets.json`的AI区块默认值如下，修改时保留已有管理员密码哈希和JWT密钥：

```json
{
  "ai": {
    "enabled": true,
    "provider_order": ["mimo", "deepseek"],
    "timeout_seconds": 30,
    "temperature": 0.3,
    "providers": {
      "deepseek": {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-v4-flash",
        "auth_style": "bearer",
        "api_key": ""
      },
      "mimo": {
        "base_url": "https://api.xiaomimimo.com/v1",
        "model": "mimo-v2.5-pro",
        "auth_style": "api-key",
        "api_key": ""
      }
    }
  }
}
```

未配置任何Key时服务仍正常启动，`auto`自动使用本地规则。真实黄金样本评测命令见`docs/samples/ai-evaluation/README.md`。

### 前端

另开一个PowerShell窗口：

```powershell
Set-Location frontend
npm ci
npm run dev
```

浏览器访问`http://127.0.0.1:5173`。Vite会把`/api`请求代理到本地后端。

### 检查

```powershell
Set-Location backend
python -m ruff check . --no-cache
python -m pytest

Set-Location ..\frontend
npm run lint
npm run test
npm run build
npm audit
```

运行数据统一位于项目根目录的`.local-data/`，不会进入Git。
