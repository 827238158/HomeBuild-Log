# Alembic 迁移目录检索规则

- 默认只读取 `README.md` 和当前 head 迁移，不得为了解项目现状批量读取历史迁移。
- 当前数据模型以 `backend/app/domain_models.py` 和产品领域文档为准，历史迁移不属于现行模型说明。
- 只有新增迁移、验证升级/降级链、排查特定历史数据库时，才按 revision 依赖逐个读取所需旧文件。
- 不得删除仍在 Alembic revision 链上的文件；如需压缩历史，必须先提供兼容现有 `alembic_version` 的基线迁移和恢复验证。
