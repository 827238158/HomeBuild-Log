# AI 后续工作

本清单保存小主已要求分阶段完善、但本轮尚未实施的 AI 能力。继续任务时先读 `CURRENT.md`，再按本清单定位代码；不要把计划当作已实现能力。

## 已完成的第一阶段

来源文字提取的网络异常进入既有备用供应商与本地规则链；候选保留来源关联与人工确认，不再展示或强制连续原文摘录；踩坑分析忽略过期响应。业务长文本字段复用语音转文字，转写失败明确报错，无备用转写服务。验收结果及部署状态只见 `CURRENT.md`。

## 2026-10-23 当前方向

近期回顾首版已实现：手动选择日期和主题，默认近7天；当前正式记录和追加历史用于进展、跟进、待确认三类短结果，各最多3条并引用真实记录。服务端验证引用、完成状态、输入字符预算及数据指纹；全项目含无主题记录，超限拒绝且提示缩小主题。暂未做真实模型质量验收，不自动修改业务，不提供模型计算金额。前端入口、测试与部署状态见CURRENT。后续优先改进回顾质量和大范围材料分批，不扩展自动写入。

## 后续优先级

1. 近期回顾质量：使用脱敏固定案例验证实质进展、当前状态、补录、引用和遗漏，真实模型质量仍待验收。
2. 回顾容量：研究受限材料筛选和分批汇总，明确覆盖范围，避免静默遗漏和要求用户调整业务主题。
3. 统一运行追踪：按任务记录供应商、耗时、状态和可用用量，敏感正文不默认长期留存。
4. 旧提取上下文、重复识别、更新已有事项建议和踩坑逐条引用降为备选需求；需另行确认，不纳入本次首版。

## 持续边界

- 普通保存不自动分析；正式写入保持人工确认与原始事实溯源。
- 不把尚未完成的自动主题匹配、旧事项更新、OCR 或视觉理解写成现有功能。
- 语音继续采用字段级转文字，不自动拆金额、日期、标题或状态。当前无备用转写路径；后续变更需小主明确选择。
- 本清单不授权现在启动后续阶段，也不授权真实 AI 调用、模型下载或上线部署。

## 检索入口

- 提取与证据：`backend/app/ai_adapter.py`、`backend/app/api/extractions.py`、`backend/app/prompts/extraction.txt`、`frontend/src/DomainWorkspace.tsx`。
- 踩坑分析：`backend/app/api/pitfalls.py`、`backend/app/prompts/pitfall_analysis.txt`、`frontend/src/PitfallsView.tsx`。
- 语音：`backend/app/api/transcriptions.py`、`frontend/src/VoiceInput.tsx`、`frontend/src/VoiceField.tsx`。
- 版本保护与冲突：`backend/app/record_version.py`、`frontend/src/RecordConflict.tsx`；查询所有写入调用方，不只检查通用 PATCH。

- 近期回顾：`backend/app/api/reviews.py`、`frontend/src/RecentReview.tsx`。
