# 任务：单用户会话与认证

## 元信息
- 状态：已完成
- 创建日期：2026-06-28
- 负责人：小主
- 当前执行Agent：deepseek
- 允许修改：`backend/`、`frontend/`、本任务文件、`tasks/ACTIVE.md`、`tasks/README.md`、`.gitignore`
- 关联任务/决策：`docs/08-roadmap-agent-collaboration.md` 阶段1、`docs/05-decisions.md`

## 目标
- 建立单用户本地管理员会话机制，防止私有网络内未授权访问。

## 背景与依据
- 阶段 1 目标为可运行的本地数据底座，尚未开启公网访问。
- 单用户场景选用 Bearer Token（HS256 JWT），不引入 OAuth2 复杂度。

## 范围
- 首次启动自动生成管理员密码并保存到 `.local-data/config/secrets.json`。
- `POST /api/v1/auth/login` 接口接收密码、签发 JWT。
- FastAPI 认证中间件保护后续业务接口（仅 `/api/v1/health` 和 `/api/v1/auth/login` 免验证）。
- 前端登录页：密码输入→登录→存储 token→跳转状态页。
- 前端请求层自动附带认证头，401 时提示重新登录。

## 非目标
- 不做多用户、角色或细粒度权限。
- 不做密码重置流程（文件恢复即可）。
- 不做 OAuth、LDAP 或第三方登录。
- 不做 CSRF 防护（JWT Bearer 模式）。

## Need
- `tasks/ACTIVE.md`
- `docs/01-architecture.md`
- `docs/03-api-contracts.md`
- `docs/04-dev-workflow.md`
- `docs/05-decisions.md`
- `backend/app/main.py`
- `backend/app/api/health.py`
- `backend/pyproject.toml`
- `backend/requirements.lock`
- `frontend/src/api.ts`
- `frontend/src/App.tsx`
- `frontend/src/App.test.tsx`
- `frontend/package.json`
- `checklists/implementation-review.md`
- `checklists/docs-update.md`

## 依赖与未知项
- PyJWT 已安装 (2.13.0)，使用 HS256 算法，无额外加密依赖。
- 密钥存储方案依赖 `.local-data/config/` 目录存在（由 `ensure_storage_directories` 负责）。
- 前后端联调依赖服务和代理配置已有。

## 实施计划
- [x] 后端：配置管理与密钥初始化（`config.py`、`secrets.json`）。
- [x] 后端：JWT 工具与密码哈希（`auth.py`）。
- [x] 后端：登录接口（`api/auth.py`）与认证中间件。
- [x] 后端：集成到 `main.py`，保护现有路由。
- [x] 后端：安装依赖、迁移检查、测试。
- [x] 前端：token 管理与 auth API 层。
- [x] 前端：登录页与认证流程（`App.tsx` 改造）。
- [x] 前端：请求拦截与 401 处理。
- [x] 前后端联调与测试。
- [x] 更新文档与任务记录。

## 验收标准
- [x] `POST /api/v1/auth/login` 正确密码返回 JWT token，错误密码返回 401。
- [x] 未认证请求访问业务接口返回 401，`/api/v1/health` 仍可匿名访问。
- [x] 携带有效 token 可访问受保护接口。
- [x] 前端登录页可完成登录→存储 token→查看健康状态的完整流程。
- [x] 后端测试全部通过（16项）；前端 lint/test/build 通过（6项测试）。

## 风险与回退
- secrets.json 丢失：删除文件后重启会自动重新生成（新密码），不影响数据。
- JWT 密钥暴露：仅限本地私有网络使用，Token Tailscale Serve 部署时重新评估。

## 执行记录
- 2026-06-28：创建任务，认领写入权。
- 2026-06-28：实现 `app/core/config.py`（SecretsConfig + PBKDF2 密码哈希）。
- 2026-06-28：实现 `app/auth.py`（JWT encode/decode + require_user 依赖）。
- 2026-06-28：实现 `app/api/auth.py`（POST /auth/login 端点）。
- 2026-06-28：实现 `_AuthMiddleware` 全局认证中间件，保护所有 API 路由。
- 2026-06-28：更新 `StoragePaths` 增加 config 目录。
- 2026-06-28：安装 PyJWT 2.13.0 到 homebuild-log 环境。
- 2026-06-28：实现 `frontend/src/token.ts` 管理 sessionStorage。
- 2026-06-28：实现 `frontend/src/api.ts` 中的 login、authHeaders、authenticatedFetch。
- 2026-06-28：改造 `frontend/src/App.tsx` 增加登录/登出流程。
- 2026-06-28：更新 `frontend/src/styles.css` 增加登录表单和登出按钮样式。
- 2026-06-28：更新 `frontend/src/App.test.tsx` 从 3 项测试扩展到 6 项（含登录场景）。
- 2026-06-28：Ruff 检查通过；pytest 16 项通过；Vitest 6 项通过；tsc 类型检查通过；Vite 构建通过。

## Review
- [x] 已执行 `checklists/implementation-review.md`。
- [x] 已执行 `checklists/docs-update.md` 的更新判断。
- 文档/清单更新：无需更新长期规划文档（认证方案已纳入架构基线，实现细节为工程决策）；任务状态已同步。

## 跨模型交接
- 已完成内容：单用户会话认证全栈实现（后端 12 项测试 + 前端 6 项测试全部通过）。
- 修改文件：新增 `backend/app/core/config.py`、`backend/app/auth.py`、`backend/app/api/auth.py`、`backend/tests/test_auth.py`、`frontend/src/token.ts`；修改 `backend/app/main.py`、`backend/app/core/paths.py`、`backend/pyproject.toml`、`frontend/src/api.ts`、`frontend/src/App.tsx`、`frontend/src/App.test.tsx`、`frontend/src/styles.css`；更新 `tasks/README.md`、`tasks/ACTIVE.md`。
- 已执行检查及结果：Ruff 0 错误；pytest 16 项通过；Vitest 6 项通过；TypeScript 类型检查通过；Vite 生产构建通过。
- 未完成内容与下一步：下一步为 Step 2「来源与附件元数据 SourceEntry + Attachment」。
- 风险、未知项和待确认事项：无。
- 工作区是否存在未验收改动：否。
- `tasks/ACTIVE.md`是否已释放：是

## 完成证据与遗留项
- 验收证据：后端 auth 测试 12 项覆盖密码哈希、密钥管理、登录成功/失败、token 有效性/过期、中间件拦截；前端 6 项覆盖加载、未登录、已登录、token 过期、连接失败、完整登录流程。
- 遗留项：无。认证方案仅限单用户本地使用，后续如需扩展多用户需另行设计。