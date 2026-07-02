# Agent 活动日志

集中记录每次任务的执行 Agent、改动范围与状态。任务完成后追加一条，替换 ACTIVE.md 前确认已登记。

| 日期 | 任务文件 | 执行Agent | 改动摘要 | 状态 |
|------|----------|-----------|----------|------|
| 2026-06-28 | 01-project-governance-bootstrap | GPT-5 | 建立 AGENTS.md、docs/、tasks/、checklists/ 项目治理骨架 | 已完成 |
| 2026-06-28 | 02-real-event-sample-analysis | GPT-5 | 用 7 条真实装修事件验证业务分类与一事多记录关系 | 已完成 |
| 2026-06-28 | 03-project-planning-docs | GPT-5 | 建立产品、领域、技术、交互、路线图与协作规划基线 | 已完成 |
| 2026-06-28 | 04-mvp-local-foundation | GPT-5 | React/FastAPI/SQLite 纵向骨架 + 依赖锁定 + 测试基线 | 已完成 |
| 2026-06-28 | 05-auth-session | deepseek-v4-pro | JWT 登录 + 密码自动生成 + 前端登录页 | 已完成 |
| 2026-06-28 | 06-sources-attachments | deepseek-v4-pro | SourceEntry/Attachment 模型 + API + 前端录入表单 | 已完成 |
| 2026-06-28 | 07-audit-trail | deepseek-v4-pro | 审计日志模型 + 自动记录 + 查询接口 | 已完成 |
| 2026-06-28 | （文档同步 + AGENT-ACTIVITY-LOG 创建 + AGENTS.md 精简） | deepseek-v4-flash | 修复文档过期问题、创建本日志、精简 AGENTS.md、更新模板 | 已完成 |
| 2026-06-28 | 08-phase1-closeout | GPT-5 | 修复 Ruff、补齐前端单附件与失败重试、同步阶段 1 文档 | 已完成 |
| 2026-06-28 | 09-phase2a-domain-records | GPT-5 | 默认项目、空间/共享实体、八类记录、来源追溯、前端手工拆分与7条样本验收 | 已完成 |
| 2026-06-28 | （修复 Agent 协作文档不一致） | deepseek-v4-flash | 补齐 04-dev-workflow 交接条目、修正 08-roadmap 任务池 | 已完成 |
| 2026-06-28 | 10-guided-local-suggestions | GPT-5 | 本地规则中文建议、原子批量确认、幂等防重、建议卡片及样本/迁移验收 | 已完成 |
| 2026-06-28 | 11-phase2b-core-views | GPT-5 Codex | 时间线、账本、问题看板、空间档案、基础搜索和统一详情 | 已完成并由小主验收 |
| 2026-06-28 | （AGENTS.md 更新 + tasks/ 文件序列化） | deepseek-v4-flash | 修正 AGENTS.md 行12进度、重命名 11 个任务文件加序列前缀、更新全部交叉引用 | 已完成 |
| 2026-06-29 | 12-phase3a-text-ai | GPT-5 Codex | AI 提取、持久化候选、待确认箱、人工确认与样本评测 | 已完成 |
| 2026-06-29 | （文档修复：Agent命名 + 过期池 + 决策补齐 + Review规则加固） | deepseek-v4-flash | 统一 3 个任务文件 Agent 命名、清理 README/路线图过期候选池、补 5 条决策记录、AGENTS.md 加固 Review 规则、修正 AGENTS.md 过时的阶段描述 | 已完成 |
| 2026-06-29 | 12-phase3a-text-ai（验收辅助 + 接口修复） | deepseek-v4-pro | alembic upgrade head 补齐缺失表、修复候选确认 422（校验错误中文化 + _fill_missing_required 兜底 + prompt 逐类列必填字段）、小主 API Key 配置后亲验通过 | 已完成 |
| 2026-06-29 | （时间线布局修复） | deepseek-v4-pro | 修复 `.timeline-group` Grid Z 字形交错布局 + 添加连续时间轴线与圆点节点 | 已完成 |
| 2026-06-29 | （删除待确认流程 + 精简确认按钮） | deepseek-v4-pro | 删除整个待确认/PendingBox 功能、「稍后处理」按钮、「一键确认全部明确项」、「保存候选修改」；保留单个「确认所选」按钮 + 全部未确认条目默认勾选；同步清理前后端相关接口、模型和测试 | 已完成 |
| 2026-06-29 | 13-entry-archive-ux | GPT-5 Codex | 优化手工录入、空间/共享档案安全删除与记录关系中文说明；全量检查及响应式浏览器验收通过 | 已完成 |
| 2026-06-29 | 14-ai-entry-default-space-ux | GPT-5 Codex | 优化 AI 录入、默认根空间、材料品牌与正式记录说明；自动化和用户视觉验收均通过 | 已完成 |
| 2026-06-29 | 项目轻量化清理 | deepseek-v4-pro | 删除 ~390MB 缓存/依赖/临时目录与旧备份；新建 constants.py/config.ts/extraction.txt 消除 4 组代码期望重复与硬编码；前端 API 路径统一为 API_BASE 常量 | 已完成 |
| 2026-06-29 | 15-unify-ai-manual-entry | Kimi Code CLI | 统一 AI 录入与手工录入体验：工具栏对齐、候选卡片类型下拉、手工追加同形候选、保存并分析入口 | 已完成 |
| 2026-06-30 | （添加 income 方向 + 记录时间选择与校验） | deepseek-v4-pro | 8 类型 record_schemas 加 income 枚举、VIEWS 账本汇总三向分支、AI prompt/LOCAL_SUGGESTIONS 加收入正则、DomainWorkspace 加 direction 下拉 + 时间日期控件 + 月份精度最低校验、defaultPayload 补 time 字段 | 已完成 |
| 2026-07-01 | 补充项目规格并移除黄金评测机制 | GPT-5 Codex | 更新00项目规格；删除黄金评测脚本、专项测试与5份黄金JSON，清理README和当前规划引用；Ruff与后端80项测试通过 | 已完成 |
| 2026-07-01 | 阶段 3B 全项目人民币数据可视化 | GPT-5 Codex | 新增默认风险概览、四个核心视图图表、八类记录分析与安全AI分析；全项目固定人民币并完成前端系统文案中文收口；Ruff、后端83项、前端38项、lint/build/pip check/npm audit通过 | 已完成 |
| 2026-07-01 | 阶段 3B UI 与记录维护修复 | GPT-5 Codex | 明确问题/待办边界并补齐问题预计与实际解决时间；移除录入页重复维护区；详情支持完整修改和删除；修复候选移除回弹、分析术语、图表标题、金额单位与按钮尺寸；迁移0012并完成全量验证 | 已完成 |
| 2026-07-01 | 最近记录精简与详情编辑态优化 | GPT-5 Codex | 最近记录只取最新三条并支持浏览器持久隐藏，关闭后不补位；详情查看态与编辑态互斥，编辑态仅保留保存和取消；前端39项测试、lint和生产构建通过 | 已完成 |
| 2026-07-01 | 业务时间字段统一为日期 | GPT-5 Codex | 问题预计/实际解决与待办截止/实际完成字段统一为年月日；新增0013迁移并按北京时间转换旧值；真实库备份升级并核验，后端86项、前端40项、Ruff、lint和构建通过 | 已完成 |
| 2026-07-01 | 专业工作台 UI 与可视化整改 | GPT-5 Codex | 登录态与工作台分离，新增分组左侧导航和移动端菜单；建立专业视觉变量，按趋势/比较/构成重做折线图、横向柱状图和环形图，删除重复风险图与可见长摘要；前端42项测试、lint和构建通过 | 已完成 |
| 2026-07-01 | 待办完成约束、阶段面板与多值输入修复 | GPT-5 Codex | 候选待办移除实际完成日期并在提交时清理；正式待办按完成状态自动填写或清空日期；概览改为环形图加阶段明细；决策选项支持标点，空间、材料、参与者等支持复选与标签删除；后端87项、前端44项测试及Ruff、lint、构建通过 | 已完成 |
| 2026-07-01 | 统一问题记录并修正录入、账本、尺寸与操作记录体验 | GPT-5 Codex | 待办、普通问题和施工问题统一为问题；新增0014迁移；来源显示处理状态；问题严重度必选并自动登记完成信息；账本改用流水及交易对象口径；尺寸统一毫米三段输入；简化决策/调研/操作记录文案；前端44项、lint/build、Ruff通过，后端完整测试首次84/85且唯一旧断言已修正，复跑受沙箱临时目录权限与审批额度限制 | 已完成 |
| 2026-07-01 | 修复概览 500：数据库迁移补齐 issue_details.completed_at | Kimi Code CLI | 诊断发现 alembic 停留在 0013 而代码已前进到 0014；备份真实库后执行 upgrade head；核验 issue_details 已含 completed_at 且 record_type 中无 todo；触发 fastapi dev 重载；test_views.py 7 项与 test_domain.py issue 相关 4 项全部通过 | 已完成 |
