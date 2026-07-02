# API与数据契约

> 本文同时记录当前已实现接口与已批准的未来契约。每节会明确标注状态；未标注为“计划”的资源均以当前源码为准。

当前已实现：健康、登录、来源/附件、审计、八类正式记录与关系、阶段2B核心投影、阶段3A文本AI提取与原子确认，以及阶段3B概览、核心视图分析、记录分析和AI分析。OCR任务、离线同步和导出恢复仍是未来开发合同。

## 通用约定

- API前缀：`/api/v1`。
- 传输：当前本地开发使用HTTP JSON；计划通过Tailscale Serve提供私有HTTPS。附件使用`multipart/form-data`上传。
- 标识：服务端生成稳定不透明ID；阶段4离线草稿计划另带`client_draft_id`，当前接口尚未使用该字段。
- 时间戳：ISO 8601并包含时区；系统默认展示Asia/Shanghai。
- 仅日期：`YYYY-MM-DD`，不得为未知月份或日期补默认值。
- 金额：`amount_minor`使用最小货币单位整数，另带`currency`，首版默认`CNY`。
- 尺寸：数值、单位、方向、近似标志和语义角色分别传递。
- 当前未提供通用`Idempotency-Key`支持；本地建议与候选确认通过稳定候选键、`origin_key`和候选包版本避免重复创建。离线同步的通用幂等键属于阶段4计划。
- 当前文本自动提取字段应追溯到原文片段并标记确定性和确认状态；未来OCR/视觉字段还必须追溯到附件区域。

## 核心类型

### SourceEntry（已实现）

- `id`：来源ID。
- `project_id`：所属装修项目。
- `input_type`：当前约定使用`text`、`image`、`receipt`或`mixed`；请求模型暂未将其限制为枚举，调用方不得自行扩展新语义。
- `original_text`：用户原始文字，可为空但不能被后续识别覆盖。
- `captured_at`：系统收录时间。
- `reported_time_text`：用户原始时间表达，可为空。
- `updated_at`、`revision`：最近显式修改时间与来源版本。
- `GET /sources/{id}`在上述字段外返回`attachments`，每项包含文件名、媒体类型、大小、SHA-256与创建时间。
- 当前响应不提供`created_by`、`attachment_ids`或统一`integrity`对象。

### CandidateBundle（已实现）

- `id`、`source_id`、`source_revision`、`extraction_run_id`。
- `engine`、`version`、`request_id`、`requested_engine`、`fallback_reason`、`created_at`、`updated_at`。
- `status`：`pending`、`partially_confirmed`、`confirmed`或`superseded`；当前前端不再使用延后处理流程。
- `candidates`：候选记录列表。
- `warnings`：冲突、重复、低确定性和推算提示。

每个候选记录包含稳定`key`、`record_type`、`summary`、`evidence`、`certainty`、`payload`、缺失字段、处理状态与已确认记录ID。候选包顶层旧`questions`字段不再写入或返回。

候选追溯与确定性约定：

- `value`：候选值。
- `evidence`：原文片段或附件区域引用。
- `certainty`：`explicit`、`inferred`、`calculated`、`uncertain`或`missing`。
- 前端允许用户在确认前修改`payload`或记录类型；修改内容随确认请求提交，不单独保存候选草稿。

### RecordBase（已实现）

- `id`、`project_id`、`record_type`、`title`、`description`。
- `occurred_date`（可空 `YYYY-MM-DD`）、`original_time_text`、`timezone`。
- `space_ids`、`stage_id`、`participant_ids`、`attachment_ids`。
- `source_refs`：创建/更新时包含`source_id`与可选`evidence_excerpt`；响应额外包含`source_revision`与`needs_review`。
- `status`、`created_at`、`updated_at`、`archived_at`。

八类记录的专属字段以`docs/06-domain-model.md`为准。

## 当前已实现资源接口

除健康检查与登录外，当前`/api/v1`接口均要求JWT Bearer Token。

### 登录与会话

- `POST /auth/login`：提交单用户管理员密码，返回`access_token`与`token_type: bearer`。
- 当前没有公开注册、刷新令牌或多用户管理接口；前端令牌失效后返回登录页。

### 系统健康

- `GET /health`：实际完整路径为`/api/v1/health`。
- 正常返回`status: ok`以及`database.status: ok`、`storage.status: ok`。
- 数据库或存储异常返回HTTP 503、错误码`LOCAL_SERVICE_UNAVAILABLE`和统一错误结构，不暴露本机路径。

### 来源与附件

- `POST /sources`：保存文本来源或附件录入会话。
- `GET /sources`：按收录时间倒序返回当前项目来源列表。
- `GET /sources/{id}`：读取原始来源及附件；提取历史通过`GET /extraction-runs`按来源信息核对。
- `PATCH /sources/{id}`：显式修改原始文字或时间表达，递增版本、写审计并使旧候选失效。
- `GET /sources/{id}/deletion-impact`：返回附件、候选、提取、独占/共享正式记录和关系影响数量。
- `DELETE /sources/{id}`：安全级联删除；独占记录删除，多来源记录解除当前来源，并返回物理附件清理警告。
- `POST /attachments`：上传JPG/JPEG、PNG、WebP、HEIC或PDF，单文件上限50 MB；可关联已有来源，并返回SHA-256等完整性信息。
- `POST /offline-drafts/sync`尚未实现，属于阶段4计划。

### 提取与确认

本地规则接口（已实现并作为兼容入口保留）：

- `GET /sources/{id}/suggestions`：返回`local-rule-v1`建议，包括稳定候选键、中文类型与摘要、原文依据、确定性、默认勾选、可编辑记录载荷、缺失项和已确认记录ID。
- `POST /sources/{id}/suggestions/confirm`：提交所选`key`与编辑后`payload`；服务端重新核对候选键并在同一事务创建全部正式记录、自动关系和审计。任何一项校验或写入失败时整批回滚。前端默认勾选全部未确认建议，但提交前仍可编辑或移除。
- 稳定确认键在同一项目内唯一；重复点击或重新打开来源返回已有正式记录，不重复创建。

阶段3A接口（已实现）：

- `POST /sources/{id}/extractions?engine=auto|ai|local`：创建文本提取；`auto`按配置的`provider_order`尝试云端供应商，默认MiMo→DeepSeek，随后回退本地规则；云端尝试共享配置的总超时预算。`ai`不允许本地回退，`local`只运行本地规则。
- `GET /sources/{id}/candidate-bundles/latest`与`GET /candidate-bundles/{id}`：读取最新或指定持久化候选包。
- `POST /candidate-bundles/{id}/confirm`：原子确认所选候选。
- `POST /candidate-bundles/{id}/suggestions/{key}/defer`：持久化移除未确认候选；请求携带`expected_version`，已确认候选不能移除。
- `GET /extraction-runs`返回不含prompt/原始响应的运行元数据；`GET /extraction-runs/{id}?include_raw=true`才显式返回本地审计原文。

候选确认请求包含`expected_version`和至少一个`selection`；服务端同时校验候选包版本与来源版本。成功结果返回更新后的候选包、创建记录与关系；任何一项失败时整体回滚。当前响应不承诺单独返回审计事件ID。

## 其他当前已实现资源接口

### 领域记录与共享实体

- `POST /records`：按`record_type`判别联合模型创建正式记录。
- `GET /records`：支持`record_type`、`source_id`、`include_archived`、`limit`和`offset`查询正式记录。
- `GET/PATCH /records/{id}`：读取或修改记录；类型和原始来源不可在详细编辑中改变。
- `DELETE /records/{id}`：二次确认后永久删除正式记录及其关系，保留原始来源、附件实体与审计，并释放对应候选确认引用；成功返回`204`。
- `POST /records/{id}/archive`与`POST /records/{id}/restore`：可恢复归档。
- `POST /records/{id}/source-reviews/{source_id}`：确认正式记录已按来源当前版本复核。
- `GET/PATCH /projects/current`：读取或修改单一活跃项目。
- `GET/POST /spaces`与`PATCH /spaces/{id}`：维护房屋、房间和局部构件层级；迁移保证默认项目至少存在一个根房屋“整套房屋”，响应结构不增加特殊字段。
- `DELETE /spaces/{id}`：永久删除未被正式记录使用且没有下级空间的误建空间；成功返回`204`，存在引用、下级空间或目标是最后一个根房屋时返回`409`。
- `GET/POST /materials`、`/vendors`、`/participants`、`/stages`与对应`PATCH /{type}/{id}`：维护共享档案。
- `DELETE /materials/{id}`、`/vendors/{id}`、`/participants/{id}`、`/stages/{id}`：永久删除未被正式记录使用的误建档案；成功返回`204`，存在引用返回`409`。
- `GET /record-relations`与`POST /record-relations`：查询或创建记录关系。
- `DELETE /record-relations/{relation_id}`：移除指定关系并保留审计。

上述阶段 2A 接口已实现。所有共享实体删除均写审计且不可恢复，不会自动解除历史引用；不存在或跨项目资源返回`404`。`POST/PATCH /records`以`record_type`作为判别字段；PATCH必须携带原类型且不能换型，只更新显式提交字段。每条正式记录的`source_refs`至少包含一个有效来源。

施工问题的`expected_resolution_at`和`resolved_at`、待办的`due_at`和`completed_at`均使用`YYYY-MM-DD`业务日期，不包含时分秒。问题状态首次进入`resolved`或`closed`且未显式提供日期时，按北京时间自动记录当天日期；从已解决状态重新进入`open`、`in_progress`或`waiting`时自动清空。待办的`completed_at`仅允许在`done`状态保留；进入`done`时缺省为北京时间当天，重新打开或取消时自动清空。用户可在对应完成状态下人工修正日期。

- `GET /records/{id}`额外返回空间、材料、参与者、阶段和商家名称投影，供统一详情与核心视图保持一致。
- `GET /audit`支持`target_table`、`target_id`、`action`和`limit`过滤。

### 查询、视图与数据管理

- `GET /timeline`：支持`q`、`record_type`、`space_id`、`stage_id`、`date_from`和`date_to`；未知业务日期进入`unknown`组，事件节点可展开直接关联记录。
- `GET /ledger/summary`：支持商家、空间、阶段和日期范围过滤；以单一人民币`totals`返回采购总额、实际支出、退款、净付款、待付、超付及未分配流水。只有单一`pays_for`关系的已入账流水参与采购待付计算；检测到非人民币历史记录时返回`409`并要求人工核对。
- `GET /issues/board`：按五个问题状态返回看板列，可按空间过滤；卡片包含关联未完成待办和来源/附件计数。
- `GET /spaces/{id}/archive`：聚合所选空间及所有后代空间，按记录类型返回去重结果、材料和摘要计数。
- `GET /search`：使用关键词或至少一个结构化条件检索；支持类型、空间、阶段、状态、日期范围、分页，结果按来源、正式记录、材料、商家和空间分组，默认排除归档记录。
- `POST /exports`、`POST /restores/validate`：计划在阶段5创建完整导出与验证恢复包，当前尚未实现。

上述五个查询接口已在阶段 2B 实现，均为现有正式事实的只读投影，不创建视图副本。基础搜索不承诺全文索引、模糊排名或重复检测。

## 计划资源接口

### 阶段3B全项目数据可视化接口（已实现）

- `GET /overview`返回未关闭问题、逾期及未来7天待办/到货、最近动态和阶段事项分布；风险窗口按北京时间自然日计算。
- `GET /timeline`、`GET /ledger/summary`、`GET /issues/board`和`GET /spaces/{id}/archive`在保持现有明细结构的基础上返回`analytics`。
- `GET /records/analytics`按`record_type`、日期、空间、阶段和状态返回摘要、状态分布、时间趋势及类型专属统计；统一记录分析页使用该接口切换八类正式记录。
- `GET /ai-analytics/overview?range=7d|30d|90d|all`返回请求数、成功率、回退率、平均/P95耗时、总token、趋势、最终引擎和错误类型聚合，默认`30d`。
- `GET /ai-analytics/runs`返回按`request_id`分组的安全明细，包括时间、请求方式、最终模型、结果、回退、总耗时、token和错误摘要，不得返回完整prompt、原始响应或API Key。
- AI请求以唯一`request_id`计数；任一尝试成功即成功，全部失败才失败；只有非空`fallback_reason`计回退，主动本地模式不计回退；耗时按请求内尝试合计，缺失token不按零统计，日期按北京时间聚合。
- 所有图表只消费服务端聚合结果，前端不得重新实现账本金额、空间继承或问题状态口径。
- 账目和采购创建/修改时`currency`省略即为`CNY`，显式提交其他币种返回`422`；兼容字段暂不从数据库删除。

## AI适配器契约

当前`OpenAICompatibleAdapter`只接收来源文字、供应商配置和本次超时预算，返回统一文本提取草稿；API层负责包装运行记录与`CandidateBundle`。附件引用、视觉输入及更丰富的项目上下文属于后续适配器扩展。

适配器不得：

- 直接写入正式记录或数据库。
- 把推算标记为用户明确表达。
- 丢弃原始文字、附件引用或模型运行信息。
- 在未显式启用云端供应商时上传数据。

## 状态与并发

- 候选确认使用乐观版本号；版本过期返回冲突，客户端重新加载后再确认。
- 当前文本提取在请求内执行，`ExtractionRun`按每次尝试持久化成功或失败状态；`queued`、`running`、`cancelled`用于未来异步OCR任务，不是当前文本接口的工作队列状态。
- 正式记录状态由各领域定义，不能复用候选状态。
- 同一来源允许多次提取运行，后运行不会静默覆盖先前结果。

## 错误格式

计划统一错误结构：

- `code`：稳定机器可读错误码。
- `message`：可行动的中文说明。
- `details`：字段级信息，不包含密钥或敏感原文。
- `trace_id`：本地追踪标识。
- `retryable`：是否适合重试。

当前实现主要使用FastAPI的`detail`错误和字段校验响应；健康检查另有安全的组件错误结构。输入无效、附件不支持、提取失败、版本冲突、权限不足、资源不存在和引用冲突已能区分，但尚未统一为上述包络。备份校验失败属于阶段5计划。

## 兼容性规则

- 公开字段或状态一旦被前端使用，破坏性修改必须更新本文和`docs/05-decisions.md`。
- 新增可选字段允许向后兼容；删除、改名、单位变化和语义变化视为破坏性变更。
- 数据迁移必须提供备份、校验和回退说明，不能只修改数据库而不更新契约。
