# HomeBuild Log 产品事实

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

单一业主本人，个人私用。在装修过程中记录现场、查看费用、跟进问题和找回证据。

## Product Purpose

本地优先的装修事实工作台。保存原始来源，生成候选记录，由用户确认后进入正式记录与各类视图。

## Stack

React、TypeScript、Vite、FastAPI、SQLite，本地附件目录。

## Operating Context

Windows 本地开发，家庭局域网 Docker 部署；手机、平板与电脑通过浏览器使用。当前运行版本及实机验收状态以 `memory/CURRENT.md` 为准。

## Capabilities and Constraints

- 正式记录包括事件、账目、问题、尺寸、决策、调研。待办与问题复用 issue，调研笔记复用 research。
- 来源文字必填，可附加单个图片或 PDF；当前不对附件做 OCR 或视觉理解。
- AI 只分析来源文字，默认关闭，保留本地规则兜底；普通保存不静默触发分析。
- 金额统一人民币，净支出为付款减退款再减收入；图表使用服务端聚合结果，与明细保持同一范围。
- 调研笔记只保留主题与追加式调研过程、来源及尚未确认事项；状态为待调研、调研中、已归档。结论功能已停用，旧结论数据只保留读取兼容，旧 concluded 状态按调研中展示，不迁移或删除旧内容。
- 本地真实数据与附件不得进入 Git。UI 改动保持业务行为、接口契约和统计口径。

## Brand Commitments

名称 HomeBuild Log。中文表达直接、清晰，面向日常装修任务。既有视觉与中文字体约束见 `DESIGN.md`。

## Product Principles

原始事实优先、人在回路、一事多记录、视图不是副本、不确定性显式化、本地与隐私优先。

## Accessibility & Inclusion

键盘与触屏均可操作；颜色不能是唯一状态信号。保留明确焦点、可读金额、必要错误提示，尊重减少动态效果偏好。

## Evidence on Hand

以上事实来自 `memory/MEMORY.md` 和 `DESIGN.md`。动态版本、测试数量和未完成验收不作为稳定产品能力；不得编造用户评价、性能指标或已验收设备。
