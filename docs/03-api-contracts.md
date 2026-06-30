# 计划API与数据契约

> 本文是未来开发合同，不代表接口已经实现。任何实现任务必须先核对当前框架文档和本文版本。

当前已实现：健康、登录、来源/附件、审计、八类正式记录与关系、阶段2B核心投影，以及阶段3A文本AI提取、持久化候选和原子确认。阶段3B全项目数据可视化、OCR任务、离线同步和导出恢复仍是未来开发合同。

## 通用约定

- API前缀：`/api/v1`。
- 传输：私有HTTPS上的JSON；附件使用表单或分段上传，具体上限在实施任务中验证。
- 标识：服务端生成稳定不透明ID；客户端离线草稿另带`client_draft_id`。
- 时间戳：ISO 8601并包含时区；系统默认展示Asia/Shanghai。
- 仅日期：`YYYY-MM-DD`，不得为未知月份或日期补默认值。
- 金额：`amount_minor`使用最小货币单位整数，另带`currency`，首版默认`CNY`。
- 尺寸：数值、单位、方向、近似标志和语义角色分别传递。
- 写操作支持`Idempotency-Key`；重复请求返回同一结果，不重复创建记录。
- 所有自动提取字段可追溯到来源片段或附件区域，并标记确定性和确认状态。

## 核心类型

### SourceEntry

- `id`：来源ID。
- `project_id`：所属装修项目。
- `input_type`：`text`、`image`、`receipt`或`mixed`。
- `original_text`：用户原始文字，可为空但不能被后续识别覆盖。
- `captured_at`：系统收录时间。
- `reported_time_text`：用户原始时间表达，可为空。
- `updated_at`、`revision`：最近显式修改时间与来源版本。
- `attachment_ids`：附件ID列表。
- `created_by`：首版固定为本地用户身份。
- `integrity`：来源版本及完整性信息。

### CandidateBundle

- `id`、`source_id`、`source_revision`、`extraction_run_id`。
- `status`：`pending`、`partially_confirmed`、`confirmed`或`superseded`。
- `candidates`：候选记录列表。
- `warnings`：冲突、重复、低确定性和推算提示。

每个候选字段包含：

- `value`：候选值。
- `evidence`：原文片段或附件区域引用。
- `certainty`：`explicit`、`inferred`、`calculated`、`uncertain`或`missing`。
- `confirmation`：`pending`、`confirmed`或`corrected`。

### RecordBase

- `id`、`project_id`、`record_type`、`title`、`description`。
- `occurred_date`（可空 `YYYY-MM-DD`）、`original_time_text`、`timezone`。
- `space_ids`、`stage_id`、`participant_ids`、`attachment_ids`。
- `source_refs`：来源及证据引用；响应包含`source_revision`与`needs_review`。
- `status`、`created_at`、`updated_at`、`archived_at`。

八类记录的专属字段以`docs/06-domain-model.md`为准。

## 计划资源接口

### 系统健康

- `GET /health`：实际完整路径为`/api/v1/health`。
- 正常返回`status: ok`以及`database.status: ok`、`storage.status: ok`。
- 数据库或存储异常返回HTTP 503、错误码`LOCAL_SERVICE_UNAVAILABLE`和统一错误结构，不暴露本机路径。

### 来源与附件

- `POST /sources`：保存文本来源或附件录入会话。
- `GET /sources/{id}`：读取原始来源、附件和提取历史。
- `PATCH /sources/{id}`：显式修改原始文字或时间表达，递增版本、写审计并使旧候选失效。
- `GET /sources/{id}/deletion-impact`：返回附件、候选、提取、独占/共享正式记录和关系影响数量。
- `DELETE /sources/{id}`：安全级联删除；独占记录删除，多来源记录解除当前来源，并返回物理附件清理警告。
- `POST /attachments`：上传附件并返回完整性信息。
- `POST /offline-drafts/sync`：同步PWA离线草稿，按幂等键去重。

### 提取与确认

当前本地规则接口：

- `GET /sources/{id}/suggestions`：返回`local-rule-v1`建议，包括稳定候选键、中文类型与摘要、原文依据、确定性、默认勾选、可编辑记录载荷、缺失项和已确认记录ID。
- `POST /sources/{id}/suggestions/confirm`：提交所选`key`与编辑后`payload`；服务端重新核对候选键并在同一事务创建全部正式记录、自动关系和审计。任何一项校验或写入失败时整批回滚。
- 稳定确认键在同一项目内唯一；重复点击或重新打开来源返回已有正式记录，不重复创建。

阶段3A当前接口：

- `POST /sources/{id}/extractions?engine=auto|ai|local`：创建文本提取；`auto`按DeepSeek→MiMo→本地规则回退，AI主备共享30秒预算；`ai`不允许本地回退。
- `GET /sources/{id}/candidate-bundles/latest`与`GET /candidate-bundles/{id}`：读取最新或指定持久化候选包。
- `POST /candidate-bundles/{id}/confirm`：原子确认所选候选。
- `GET /extraction-runs`返回不含prompt/原始响应的运行元数据；`GET /extraction-runs/{id}?include_raw=true`才显式返回本地审计原文。

确认接口必须返回创建的记录ID、关系ID、仍未确认项和审计事件ID。任何一项失败时整体回滚。

### 阶段3B全项目数据可视化接口（计划）

- `GET /timeline`、`GET /ledger/summary`、`GET /issues/board`和`GET /spaces/{id}/archive`在保持现有明细结构的基础上增加`analytics`，聚合结果必须应用与明细相同的日期、空间、阶段和状态筛选。
- `GET /records/analytics`按`record_type`、日期、空间、阶段和状态返回摘要、状态分布、时间趋势及类型专属统计；统一记录分析页使用该接口切换八类正式记录。
- `GET /ai-analytics/overview?range=7d|30d|90d|all`返回请求数、成功率、回退率、平均耗时、总token、趋势、最终引擎和错误类型聚合，默认`30d`。
- `GET /ai-analytics/runs`返回按`request_id`分组的安全明细，包括时间、请求方式、最终模型、结果、回退、总耗时、token和错误摘要，不得返回完整prompt、原始响应或API Key。
- AI请求以唯一`request_id`计数；任一尝试成功即成功，全部失败才失败；只有非空`fallback_reason`计回退，主动本地模式不计回退；耗时按请求内尝试合计，缺失token不按零统计，日期按北京时间聚合。
- 所有图表只消费服务端聚合结果，前端不得重新实现账本金额、空间继承或问题状态口径。

### 领域记录与共享实体

- `GET/POST /records`：按类型创建或查询正式记录。
- `GET/PATCH /records/{id}`：读取或修改记录；类型和原始来源不可在详细编辑中改变。
- `DELETE /records/{id}`：二次确认后永久删除正式记录及其关系，保留原始来源、附件实体与审计，并释放对应候选确认引用；成功返回`204`。
- `POST /records/{id}/archive`与`POST /records/{id}/restore`：可恢复归档。
- `POST /records/{id}/source-reviews/{source_id}`：确认正式记录已按来源当前版本复核。
- `GET/PATCH /projects/current`：读取或修改单一活跃项目。
- `GET/POST /spaces`与`PATCH /spaces/{id}`：维护房屋、房间和局部构件层级；迁移保证默认项目至少存在一个根房屋“整套房屋”，响应结构不增加特殊字段。
- `DELETE /spaces/{id}`：永久删除未被正式记录使用且没有下级空间的误建空间；成功返回`204`，存在引用、下级空间或目标是最后一个根房屋时返回`409`。
- `GET/POST /materials`、`/vendors`、`/participants`、`/stages`与对应`PATCH /{type}/{id}`：维护共享档案。
- `DELETE /materials/{id}`、`/vendors/{id}`、`/participants/{id}`、`/stages/{id}`：永久删除未被正式记录使用的误建档案；成功返回`204`，存在引用返回`409`。
- `GET/POST/DELETE /record-relations`：查询、创建或移除记录关系；移除操作保留审计。

上述阶段 2A 接口已实现。所有共享实体删除均写审计且不可恢复，不会自动解除历史引用；不存在或跨项目资源返回`404`。`POST/PATCH /records`以`record_type`作为判别字段；PATCH必须携带原类型且不能换型，只更新显式提交字段。每条正式记录的`source_refs`至少包含一个有效来源。

- `GET /records/{id}`额外返回空间、材料、参与者、阶段和商家名称投影，供统一详情与核心视图保持一致。
- `GET /audit`支持`target_table`、`target_id`、`action`和`limit`过滤。

### 查询、视图与数据管理

- `GET /timeline`：支持`q`、`record_type`、`space_id`、`stage_id`、`date_from`和`date_to`；未知业务日期进入`unknown`组，事件节点可展开直接关联记录。
- `GET /ledger/summary`：支持商家、空间、阶段和日期范围过滤；按币种返回采购总额、实际支出、退款、净付款、待付、超付及未分配流水。只有单一`pays_for`关系且币种一致的已入账流水参与采购待付计算。
- `GET /issues/board`：按五个问题状态返回看板列，可按空间过滤；卡片包含关联未完成待办和来源/附件计数。
- `GET /spaces/{id}/archive`：聚合所选空间及所有后代空间，按记录类型返回去重结果、材料和摘要计数。
- `GET /search`：使用关键词或至少一个结构化条件检索；支持类型、空间、阶段、状态、日期范围、分页，结果按来源、正式记录、材料、商家和空间分组，默认排除归档记录。
- `POST /exports`、`POST /restores/validate`：创建完整导出与验证恢复包。

上述五个查询接口已在阶段 2B 实现，均为现有正式事实的只读投影，不创建视图副本。基础搜索不承诺全文索引、模糊排名或重复检测。

## AI适配器契约

适配器接收脱敏策略、来源内容、附件引用、已知空间/材料/商家上下文和允许生成的记录类型，返回统一`CandidateBundle`草稿。

适配器不得：

- 直接写入正式记录或数据库。
- 把推算标记为用户明确表达。
- 丢弃原始文字、附件引用或模型运行信息。
- 在未显式启用云端供应商时上传数据。

## 状态与并发

- 候选确认使用乐观版本号；版本过期返回冲突，客户端重新加载后再确认。
- 提取任务状态：`queued`、`running`、`succeeded`、`failed`、`cancelled`。
- 正式记录状态由各领域定义，不能复用候选状态。
- 同一来源允许多次提取运行，后运行不会静默覆盖先前结果。

## 错误格式

统一错误结构：

- `code`：稳定机器可读错误码。
- `message`：可行动的中文说明。
- `details`：字段级信息，不包含密钥或敏感原文。
- `trace_id`：本地追踪标识。
- `retryable`：是否适合重试。

首版至少区分：输入无效、附件不支持、识别失败、低确定性、事实冲突、重复请求、版本冲突、权限不足、资源不存在、备份校验失败和内部错误。

## 兼容性规则

- 公开字段或状态一旦被前端使用，破坏性修改必须更新本文和`docs/05-decisions.md`。
- 新增可选字段允许向后兼容；删除、改名、单位变化和语义变化视为破坏性变更。
- 数据迁移必须提供备份、校验和回退说明，不能只修改数据库而不更新契约。
