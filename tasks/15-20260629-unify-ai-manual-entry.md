# 任务：统一 AI 录入与手工录入体验

## 元信息
- 状态：进行中
- 创建日期：2026-06-29
- 负责人：Kimi Code CLI
- 当前执行Agent：Kimi Code CLI
- 允许修改：`frontend/src/`、`docs/`、`tasks/`
- 关联任务/决策：任务 14 AI 录入与默认空间体验

## 目标
- 修复 AI 录入工具栏的视觉对齐问题，并将 AI 录入与手工录入整合为同一套「AI 预填 → 用户确认/下拉修正」的流程。

## 背景与依据
- 用户反馈当前「AI 录入」「分析方式」「重新分析」虽上沿对齐，但组件高度不一致显得杂乱。
- 用户期望的录入流程是：输入文本后由 AI 自动判断记录类型并填充字段，用户可直接确认，也可通过下拉框修改。

## 范围
- `frontend/src/styles.css` 中 `.suggestion-toolbar` 与相关控件样式。
- `frontend/src/DomainWorkspace.tsx` 中候选卡片、手工录入入口和状态逻辑。
- `frontend/src/App.tsx` 中新增「保存并分析」入口。
- 对应前端测试更新。
- 必要决策记录与任务清单更新。

## 非目标
- 不修改后端 API、领域模型或数据库结构。
- 不改变 SourceEntry、CandidateBundle 的持久化语义。
- 不推进阶段 3B/3C、OCR、PWA 或其他视图页面。

## Need
- `frontend/src/DomainWorkspace.tsx`
- `frontend/src/App.tsx`
- `frontend/src/styles.css`
- `frontend/src/DomainWorkspace.test.tsx`
- `frontend/src/App.test.tsx`
- `docs/05-decisions.md`
- `checklists/implementation-review.md`

## 依赖与未知项
- 依赖任务 14 已释放写入权（ACTIVE.md 已空闲）。
- 记录类型切换时保留通用字段（标题、状态、空间、材料等），仅重置类型专属字段。

## 实施计划
- [x] 更新 `tasks/ACTIVE.md` 接管单写者。
- [x] 调整 `styles.css` 工具栏布局与响应式。
- [x] 重构 `DomainWorkspace.tsx`：统一候选表单、类型下拉、手工追加。
- [x] 修改 `App.tsx`：新增「保存并分析」按钮。
- [x] 更新 `DomainWorkspace.test.tsx` 与 `App.test.tsx`。
- [x] 运行前端 lint/test/build 验证。
- [x] 更新 `docs/05-decisions.md` 与检查清单。
- [x] 释放单写者并总结。

## 验收标准
- [x] AI 录入工具栏在桌面和移动端视觉整齐、基线一致。
- [x] 候选卡片可通过下拉框切换记录类型，字段随类型动态变化。
- [x] 点击「+ 添加手工记录」可新增空白候选并与 AI 候选一起确认。
- [x] 「保存并分析」可先保存来源再触发提取并刷新工作区。
- [x] 前端 lint、测试、生产构建全部通过。

## 风险与回退
- 切换记录类型可能清空已填字段；通过保留通用字段、仅重置类型专属字段降低风险。
- 测试断言变更较大，需同步更新避免误报。
- 如联合流程引发意外行为，可回退到「保存记录 + 手动重新分析」两步流程。

## 执行记录
- 2026-06-29：用户批准实施计划，创建任务文件并接管写入权。
- 2026-06-29：完成 `.suggestion-toolbar` 网格布局、控件分组与移动端适配；标题改为「智能拆分」并内联引擎徽章。
- 2026-06-29：完成 `DomainWorkspace.tsx` 重构：候选卡片顶部新增记录类型下拉框，字段按类型动态渲染；移除独立「手工录入」折叠面板，改为「+ 添加手工记录」生成同形空白候选；AI 候选走 `confirmCandidateBundle`，手工候选走 `createRecord`。
- 2026-06-29：完成 `App.tsx`「保存并分析」入口：保存来源后立即调用提取接口。
- 2026-06-29：更新 `DomainWorkspace.test.tsx`（12 项）与 `App.test.tsx`（9 项），修复原有健康检查断言。
- 2026-06-29：前端 lint、27 项测试、生产构建全部通过。
- 2026-06-29：按小主反馈调整工具栏顺序：左侧为「智能拆分 + 引擎徽章 + 重新分析」组合，分析方式下拉框置于最右侧。
- 2026-06-29：按小主反馈为手工候选卡片增加「移除」按钮；缩小「重新分析」按钮尺寸；新增对应测试。

## 跨模型交接
- 已完成内容：统一 AI/手工录入体验、工具栏对齐、保存并分析入口、对应测试与文档更新。
- 修改文件：`frontend/src/styles.css`、`frontend/src/DomainWorkspace.tsx`、`frontend/src/App.tsx`、`frontend/src/DomainWorkspace.test.tsx`、`frontend/src/App.test.tsx`、`docs/05-decisions.md`、`docs/07-ux-visualization.md`、`tasks/ACTIVE.md`、`tasks/15-20260629-unify-ai-manual-entry.md`、`tasks/AGENT-ACTIVITY-LOG.md`。
- 已执行检查及结果：前端 lint 通过；28 项测试通过；生产构建通过。
- 未完成内容与下一步：建议小主在真实浏览器中检查桌面与移动端视觉布局，以及「保存并分析」流程。
- 风险、未知项和待确认事项：无。
- 工作区是否存在未验收改动：否。
- `tasks/ACTIVE.md`是否已释放：是（后续小主反馈调整时已重新接管并再次释放）

## Review
- [x] 已执行 `checklists/implementation-review.md`。
- [x] 已执行 `checklists/docs-update.md` 的更新判断。
- [x] 已在 `tasks/AGENT-ACTIVITY-LOG.md` 追加本任务记录。
- 文档/清单更新：已更新 `docs/05-decisions.md` 与 `docs/07-ux-visualization.md`。

## 完成证据与遗留项
- 验收证据：前端 lint 通过；28 项测试通过；生产构建成功；工具栏顺序、手工候选可移除、重新分析按钮尺寸均已按反馈调整。
- 遗留项：建议小主手动验收桌面/移动端布局与保存并分析流程。
