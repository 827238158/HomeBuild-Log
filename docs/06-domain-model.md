# 领域模型规划

> 本文定义首版业务语义和关系，不是数据库DDL。字段在进入实现前仍需通过更多真实样本验证，但任何语义调整必须留下决策记录。

## 模型总览

```text
Project
  ├─ SourceEntry ── Attachment
  │      └─ ExtractionRun ── CandidateBundle
  │                              └─ CandidateRecord
  ├─ RecordBase
  │      ├─ Event
  │      ├─ LedgerEntry
  │      ├─ Issue
  │      ├─ Measurement
  │      ├─ Decision
  │      ├─ Procurement
  │      ├─ Research
  │      └─ Todo
  ├─ Space ── Material
  ├─ Vendor / Participant
  ├─ ProjectStage
  └─ RecordRelation
```

一条`SourceEntry`可以产生多个候选和多个正式记录。正式记录之间通过`RecordRelation`连接，共享来源、空间、人物、阶段、材料和附件，但各自保留独立状态。

## 来源与确认模型

### SourceEntry

- 保存用户原始文字、输入形式、收录时间、用户表达的时间和附件引用。
- 原始内容只追加补充或新版本，不允许被识别结果覆盖。
- 用户纠错作为补充确认来源保存，原始错字仍保留。

### Attachment

- 保存原文件名、媒体类型、大小、校验值、存储位置和创建时间。
- 原始附件与缩略图、OCR文本等派生内容分区管理。
- 派生内容可重建，原始附件不可被普通编辑替换。

### ExtractionRun

- 记录模型/适配器、运行时间、输入范围、状态、错误和输出版本。
- 同一来源允许多次运行；新结果不会删除旧结果。

### CandidateBundle

- 聚合一次提取产生的候选记录、待补充问题、冲突和重复提示。
- 状态：`pending`、`partially_confirmed`、`confirmed`、`rejected`、`superseded`。
- 候选字段分别保存值、证据、确定性和用户确认状态。

## RecordBase公共语义

所有正式记录共享：

- 标识、所属项目、记录类型、标题和描述。
- 发生时间、时间精度、原始时间文本和时区。
- 空间、装修阶段、参与者、附件和来源引用。
- 状态、创建时间、更新时间、归档时间和审计信息。
- 与其他记录的显式关系。

时间精度至少区分：准确时刻、日期、月初/月中/月末、月份、近似日期、时间范围和未知。不得用`00:00`或当月1日代替未知时间部分。

## 八类业务记录

### Event 事件

用途：承担装修时间主线和阶段事实。

候选字段：

- `event_kind`：现场查看、沟通、施工、阶段进度、里程碑、验收测试、学习或其他。
- 开始/结束时间及精度。
- 施工工序、结果、参与者和关联阶段。
- `status`：`planned`、`occurred`、`completed`、`cancelled`。

规则：计划事件不能在未执行时标记为已发生；验收通过不是施工问题。

### LedgerEntry 账目

用途：保存每笔真实资金流，而不是订单应付总额。

候选字段：

- `direction`：支出或退款。
- `payment_kind`：预付款、阶段款、尾款、补款、退款或其他。
- `amount_minor`、`currency`、支付日期、支付方式。
- 关联采购、商家、附件和备注。
- `status`：`planned`、`posted`、`voided`。

规则：推算余额不创建资金流水；作废或纠错必须保留审计。

### Issue 施工问题

用途：记录缺陷、争议、影响、处理和复核过程。

候选字段：

- 发现时间、空间、现象、严重度和证据。
- 责任对象、沟通记录、处理方案和实际结果。
- `resolution_kind`：返工、替换、遮挡、接受现状、退款或其他。
- `status`：`open`、`in_progress`、`waiting`、`resolved`、`closed`。

规则：`resolved`表示方案已执行，`closed`表示用户完成复核；“决定不返工”是处置决策，不等于门套遮挡已经完成。

### Measurement 尺寸

用途：保存可复用的尺寸或规格，并明确其语义。

候选字段：

- 对象、数值、单位和测量方向。
- `measurement_role`：材料规格、现场测量、设计要求或计算结果。
- 是否近似、允许偏差、测量时间和测量方法。
- 关联空间、材料、决策和来源。

规则：`60*120cm`材料规格和`门宽约240cm`近似设计尺寸必须是不同语义。

### Decision 决策

用途：保存问题、候选方案、最终选择、理由和版本变化。

候选字段：

- 决策主题、选项、选择结果、理由和适用范围。
- 确认时间、参与者及关联调研。
- `status`：`pending`、`confirmed`、`superseded`、`cancelled`。
- 被替代决策和后续实施事件。

规则：逐步补充的方案不能静默覆盖旧决定，应保留版本或替代关系。

### Procurement 采购

用途：保存商品、订单总额和履约，而不是实际资金流水。

候选字段：

- 商品/材料、规格、数量、单位、商家和订单号。
- 订单总额、约定日期、送货地址、退补条款和验收结果。
- `status`：`planned`、`ordered`、`partially_paid`、`paid`、`delivery_pending`、`delivered`、`returned`、`completed`、`cancelled`。
- 关联决策、账目、待办和附件。

规则：已付金额来自关联`LedgerEntry`汇总；订单余额为计算结果并标记计算来源。

### Research 调研

用途：保存需要长期复用的调研问题、选项、证据和结论。

候选字段：

- 调研问题、候选方案、比较维度、资料来源和证据。
- 结论、局限、关联材料和关联决策。
- `status`：`collecting`、`comparing`、`concluded`、`archived`。

规则：仅有“逛了一上午”但没有问题、选项、证据或结论时，可以只作为事件，不强制创建调研。

### Todo 待办

用途：保存尚需执行或条件触发的动作。

候选字段：

- 动作、负责人、计划时间、截止时间、触发条件和优先级。
- 完成时间、完成证据及关联记录。
- `status`：`pending`、`in_progress`、`waiting`、`done`、`cancelled`。

规则：未来语义不自动等于待办；必须能表达明确动作或用户确认需要跟踪。

## 共享实体

### Space

- 层级：项目/房屋 → 房间 → 局部构件或表面。
- 首版用父子关系表达卫生间、淋浴区、墙面、壁龛等层级。
- 空间拆改通过事件和决策记录，不在首版实现完整几何版本历史。

### Material

- 保存名称、品牌、型号、花色、表面效果和规格引用。
- 可被决策、采购、尺寸、空间和事件共同引用。
- 材料不是第九类业务记录。

### Vendor与Participant

- `Vendor`表示商家或供应方；`Participant`表示工人、设计师等人物。
- 原文只有“老板”“水电工”时允许只记录角色，不编造姓名和联系方式。

### ProjectStage

- 表示拆改、水电、泥瓦、木工、油漆、安装、软装等阶段。
- 具体阶段词表在实施前结合更多样本确认，不由本文件假定完整枚举。

### RecordRelation

首版至少支持：`derived_from`、`relates_to`、`implements`、`resolves`、`pays_for`、`tracks_delivery`、`supersedes`、`blocks`和`produces`。

## 真实样本映射

### 样本001

- Event：2026-06-27在光彩大市场选购。
- Decision：确认卫生间淋浴区花砖花色。
- Procurement：18片60*120cm花砖、订单1100元、2026-07-01计划送达。
- LedgerEntry：500元预付款。
- Todo：等待送货及到货验收。
- 关系：Decision `produces` Procurement；LedgerEntry `pays_for` Procurement；Todo `tracks_delivery` Procurement。

### 样本004

- Event：2026-06-25现场查看，地砖已铺贴完毕。
- Issue：主卧门口地砖小破裂。
- Decision：确定不返工，采用门套遮挡。
- Todo：等待门套施工并复核遮挡效果。
- 关系：Decision `resolves` Issue；Todo `implements` Decision。

### 样本007

- Event：水电弹线、施工、阶段完成和水管打压测试通过。
- Decision：智能开关、全屋网络、书房至客厅电视HDMI光纤。
- Todo：后续补充打压参数和线路资料。
- 不创建Issue：打压测试通过是验收事件，不是缺陷。

## 仍需样本验证

- 复杂退款、同一订单多次付款和跨采购合并付款。
- 一个问题多次返工、重新打开和最终验收。
- 多维尺寸、面积、数量换算和图纸坐标。
- 调研结论被新证据推翻后的版本关系。
- 空间拆改前后查询和材料在多个空间重复使用。
