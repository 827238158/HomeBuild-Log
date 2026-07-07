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
| 2026-07-02 | 采购并入账目、日期解析与全局交互视觉优化 | GPT-5 Codex（第二轮 UI 由 subagent 协作） | 新增0015迁移并备份/升级真实库；采购转账目子类型，AI与本地规则解析相对日期；来源状态后置、长文本提示、下拉单开与外部关闭；完成全局视觉令牌和动效；后端89项、前端44项、Ruff、lint、build通过 | 已完成 |
| 2026-07-02 | 低风险仓库卫生清理 | Kimi Code CLI | 删除根目录 pytest-cache 并补 .gitignore 覆盖；移除 DEV_SERVER、toastDuration 统一使用；tsconfig 开启 noUnusedLocals/Parameters 并修复 7 处未使用告警；移除未调用旧候选 API 导出；新增 currency.ts 与 recordTypeLabels，替换 CoreViews/AnalyticsViews 重复 money/typeLabels；补充 currency.test.ts；前端 lint、47 项测试、生产构建均通过 | 已完成 |
| 2026-07-02 | 收敛 Alembic 历史迁移检索 | Codex /root | 保留完整 revision 链避免破坏现有数据库；新增迁移索引和目录级 Agent 规则，默认只读取当前 head，禁止非迁移任务批量加载历史迁移 | 已完成 |
| 2026-07-02 | 剩余问题全量整改（第一批） | Codex /root | 新增0016退役采购/待办运行时旧表并保留降级快照；移除旧ORM/Schema与商家旧表引用；AI配置增加URL、数值、供应商和鉴权方式容错；AI配置测试2项通过，综合测试受Windows临时目录权限中断 | 进行中 |
| 2026-07-02 | 第二轮前端交互、拆包与样式收敛 | Codex /root + frontend_remediation subagent | 统一HTTP与401退出；29处业务下拉迁移到受控Select；ECharts异步拆包，入口JS降至293.85kB；合并样式入口并删除override文件；lint、52项测试、build通过；本地浏览器视觉验收受企业策略阻断 | 已完成 |
| 2026-07-02 | 修复原始数据来源下拉框 | Codex /root | 统一文本框与来源下拉的桌面端/移动端水平对齐；选择、失焦、滚动、外部关闭及卸载时清理全文提示和长按计时；前端54项测试、lint和build通过 | 已完成 |
| 2026-07-02 | 二次修复原始数据来源下拉框 | Codex /root + investigate_source_picker subagent | 根据真实页面测量将桌面端/移动端对齐值修正为19px/15px；移除指针聚焦触发的顶部复制浮层，仅保留长按且松开即关闭；新增真实指针事件顺序回归；前端54项测试、lint和build通过，最终浏览器刷新受安全策略阻断 | 已完成 |
| 2026-07-02 | 修复来源状态对齐与待处理语义 | Codex /root + frontend_ui_inspect subagent | 来源接口增加待处理/已确认/已忽略候选计数；候选全部忽略后改为 reviewed 并提示可重新分析；下拉触发器与选项统一三列布局；前端56项、后端相关20项、Ruff、lint和build通过，登录后视觉验收待人工复核 | 已完成 |
| 2026-07-03 | 优化装修账本统计与图表明细交互 | Codex /root | 统计卡片、付款环形图和供应商柱状图增加统一悬停摘要；点击打开桌面抽屉或移动端80dvh底部弹层，并可进入单条详情后返回；未改金额计算；前端59项、lint和build通过，浏览器控制接口未加载故未做真实页面视觉验收 | 已完成 |
| 2026-07-03 | 修复账本 hover 明细弹窗定位 | Codex /root | 改用卡片或图表 SVG 元素真实 DOM 矩形锚定；增加8px偏移、四向 flip、视口 shift 和160ms交互关闭延迟；补充正常下方定位与底部翻转回归；前端59项及生产构建通过 | 已完成 |
| 2026-07-03 | 修复账本 Popover 坐标系混用 | Codex /root | 根据子 Agent 诊断将 hover 明细 Portal 到 body，消除 view-panel 持久 transform 对 fixed containing block 的影响；图表改用鼠标点虚拟锚点，避免 SVG 大包围盒偏移；前端59项、lint和build通过 | 已完成 |
| 2026-07-03 | 修复录入候选状态、时间回填与下拉遮挡 | Codex /root | 下拉菜单 Portal 到 body；候选回包按稳定 key 保留草稿；确认接口原子忽略未勾选项；AI与本地规则补充可靠日期回填及缺失提示；前端61项、lint/build通过，后端相关测试通过，按用户要求停止后续复测 | 已完成 |
| 2026-07-03 | 浮层交互隐患修复（第一优先级） | DeepSeek-V4 | H1: source-picker__popover 改为 Portal+fixed+getBoundingClientRect 定位；M1: SourcePicker 滚动时关闭菜单；M2: MultiSelect 添加滚动关闭监听；同步修复测试 scoped query -> screen 全局查询；前端61项全部通过 | 已完成 |
| 2026-07-03 | 账本四卡片计算逻辑调整 | DeepSeek | 订单总额改为从资金流水（支出方向）而不是采购订单计算，使 订单总额 = 实际支出 + 退款与收入 自然成立；卡片预览改为支出流水；后端 views.py 与 tests、前端 CoreViews.tsx 与 tests 同步更新；前端15项全通过，后端因环境不匹配未运行 | 已完成 |
| 2026-07-03 | 账本扇形图改为资金构成三项 | DeepSeek | payment_composition 从 2 项（净付款、待付）扩为 3 项（实际支出、退款与收入、待付金额）；图表标题「采购付款构成」->「资金构成」；records 映射新增 refund-income 分支；前端15项全通过 | 已完成 |
| 2026-07-03 | 修复下拉滚动、问题看板布局与账本侧栏定位 | Codex /root | 公共下拉仅在外层滚动时关闭；问题筛选栏紧凑排列、状态列等宽铺满并改为列内滚动；账本明细抽屉与遮罩 Portal 到 body；前端63项、lint、build及diff检查通过，真实浏览器验收因控制接口未加载待人工复核 | 已完成 |
| 2026-07-03 | 修复录入页表单控件与下拉弹层 | Codex /root | 统一 input、textarea、Select、MultiSelect 的浅色视觉与交互状态；多选改为框内名称/计数摘要并移除框外 chips；抽取共享 portal 定位 Hook，支持上下翻转、可用高度滚动、页面滚动和 resize 重定位；前端 lint 与63项测试通过，按用户要求停止浏览器检查 | 已完成 |
| 2026-07-03 | 修复账目状态、来源同步与问题看板布局 | Codex /root | 抽取记录类型状态配置；资金流水补齐计划中/已入账/已出账/已作废并兼容后端校验和统计，保留采购订单生命周期；新增来源成功后按返回 ID 自动选中；统一表单控件尺寸令牌；问题看板顶部改为桌面双栏、移动单栏；前端64项、lint/build、后端42项及Ruff通过 | 已完成 |
| 2026-07-03 | 整理账目状态与计算逻辑并移除采购订单 | Codex /root | 账目收敛为付款/退款/收入；严格绑定方向和完成状态；统一账本、趋势、空间及商家统计的有效流水与净支出口径；移除采购入口、字段和关系；新增0017不可逆迁移删除历史采购并规范旧流水；同步AI规则、测试和文档；未运行测试，仅TypeScript静态检查与Ruff通过 | 已完成 |
| 2026-07-03 | 修复录入字段展示、尺寸用途校验与时间线长列表 | Codex /root | 候选缺失字段统一映射中文并隐藏未知内部字段；尺寸用途新增中文选择、前后端别名规范化和安全校验提示；时间线按10条分批查看更多并支持平滑回顶；账本列表保持不变；相关前端32项、后端2项、lint、Ruff及生产构建通过，抽取集成测试受系统临时目录权限限制，CoreViews另有2条既存账本断言失败 | 已完成 |
| 2026-07-03 | 修复录入页手工候选确认与缺失提示 | Kimi Code CLI | 手工记录 title 空时使用摘要/来源依据兜底；候选 missing_fields 渲染时过滤已填充字段；补充 2 项回归测试；DomainWorkspace 31 项通过，lint 与生产构建通过；CoreViews 2 条既存账本断言失败与本改动无关 | 已完成 |
| 2026-07-03 | 移除候选卡片“还可补充：”提示行 | Kimi Code CLI | 按用户要求彻底删除候选卡片底部“还可补充”提示及相关 fieldValueMissing 辅助函数；同步移除 2 项相关测试；DomainWorkspace 29 项通过，lint 与生产构建通过 | 已完成 |
| 2026-07-04 | 时间线与账本看板 UI 优化 | Codex /root | 回顶按钮调整为侧边偏下固定位置；资金流水卡片墙替换为月净支出趋势；共享 EChart 增加可选动态高度与限高纵向滚动，商家超过 8 项时启用；新增 3 项验收用例通过，lint/build 通过，CoreViews 全量测试另有 2 项既存断言失败 | 已完成 |
| 2026-07-04 | 时间线与账本看板 UI 优化 | Codex /root | 回顶按钮调整为侧边偏下固定位置；资金流水卡片墙替换为月净支出趋势；共享 EChart 增加可选动态高度与限高纵向滚动，商家超过 8 项时启用；新增 3 项验收用例通过，lint/build 通过，CoreViews 全量测试另有 2 项既存断言失败 | 已完成 |
| 2026-07-04 | 修复时间线记录类型图表筛选 | Codex /root | 图表点击与取消筛选统一立即刷新时间线请求并重置分批展示；新增筛选、数据替换与恢复回归测试；定向 2 项、lint、build 通过，CoreViews 全量 17 通过、2 项既存账本断言失败 | 已完成 |
| 2026-07-04 | 项目文档一致性审计与整理 | deepseek-v4-pro | 全面审计 26 份文档 vs 当前代码事实；重写 progress-summary.md（更新为阶段3B实际状态，移除已删除功能描述）；更新 06-domain-model.md（六类记录、三状态Issue、移除采购/待办独立章节）；修正 03-api-contracts.md（字段名和状态引用）；修正 07-ux-visualization.md（看板列、图表依赖、"独立视图"标注）；修正 08-roadmap（类型列表）；补充 05-decisions（待办/问题合并决策）；修正 02-style-guide（术语列表） | 已完成 |
| 2026-07-04 | 问题看板高严重度视觉标识 | deepseek-v4-pro | issue-card 加 data-severity 属性；CSS 新增 .issue-card[data-severity="high"]（红色左边框+浅红底色）；horizontalBarOption 支持 itemColors 参数；严重程度柱状图"高"栏标记 risk 红色；lint/build/测试 71 通过（2项既存账本断言失败与本次无关） | 已完成 |
| 2026-07-04 | 修复账本完整明细栏长列表卡片错位 | Codex /root | 记录区改为占用剩余高度的单列内容行 Grid 并独立滚动，长标题安全换行；新增 24 条长列表回归用例；lint/build 及新增用例通过，同批有 1 项既存移动端账本 mock 断言失败；按用户要求停止后续测试与浏览器验收 | 已完成 |
