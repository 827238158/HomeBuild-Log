# Pitfalls

按问题类型记录，不按时间写流水账。每条只写触发条件、原因和正确处理。

## 文档与记忆

- 触发：README、MEMORY、RUNBOOK 或子系统说明对同一命令、版本或验收状态给出不同结论。
  原因：同一事实在多份活文档重复维护。
  处理：README 只做人类入口，MEMORY 记稳定事实，CURRENT 记当前任务，LOG 记重要历史，RUNBOOK 统一维护命令，DESIGN 只记 UI/视觉规则；实现影响仍以代码搜索为准。

- 触发：项目 Hook 修改后突然不再运行。
  原因：Codex 按 Hook 定义哈希记录信任，内容改变后旧信任自动失效。
  处理：使用 `/hooks` 审查并重新信任新版定义，不要通过绕过信任机制解决。

## 编码与中文

- 触发：Markdown、日志、CSV 或脚本中的中文显示乱码。
  原因：PowerShell 默认编码、文件编码或终端显示编码不一致。
  处理：读写文本显式使用 UTF-8；抽查用 `Get-Content -Encoding UTF8`。

## 前端 UI

- 触发：从统计明细抽屉继续打开记录详情并编辑时，普通单选或多选点击后看不到菜单。
  原因：详情抽屉与原明细抽屉层级倒置，且被遮蔽面板仍可能参与指针命中；只提高下拉菜单 `z-index` 不能完整解决叠层交互。
  处理：下拉统一 Portal 到 `body`，记录详情层级高于原明细抽屉，并对被遮蔽抽屉同时设置不可见和 `pointer-events: none`；回归测试必须覆盖“明细 → 详情 → 编辑 → 展开下拉”的完整路径。

## Windows 与 PowerShell

- 触发：路径包含空格、中文或 `+` 时命令失败。
  原因：未使用 `-LiteralPath` 或未正确引用路径。
  处理：PowerShell 文件操作优先使用 `-LiteralPath`，不要拼接未验证路径做删除或移动。

- 触发：停止服务误杀其他 Python 或 Node 进程。
  原因：按进程名批量关闭。
  处理：优先使用项目控制脚本保存的运行状态，只停止由项目菜单启动的进程。

- 触发：`export-data.ps1` 报本机 8000 端口仍在监听，但 Windows 后端已停止。
  原因：SSH 本地端口映射也会占用 8000，导出脚本无法区分隧道和本地写入服务。
  处理：先按 PID 确认监听 8000 的确是 `ssh`，再关闭该隧道后导出；不得因端口冲突而误杀其他 SSH 或 Python 进程。

- 触发：Windows 导出包已生成，但程序在退出时报临时 SQLite 文件被占用，且没有对应的外层 `.sha256`。
  原因：Windows 上其他程序可能在 `TemporaryDirectory` 清理时短暂锁定快照数据库，导出逻辑来不及写外层校验文件。
  处理：非零退出不得直接视为成功；必须确认 tar 可读、包内 `MANIFEST.sha256` 全部通过，并生成、复核外层 SHA-256 后才能上传。

## Python 与 Conda

- 触发：依赖已安装但运行时报缺包。
  原因：pip、python、pytest 来自不同环境。
  处理：使用 `D:\Anaconda\envs\homebuild-log\python.exe -m pip` 和同一路径执行测试。

- 触发：提交前执行 `ruff check .` 时只有历史迁移 `0016_retire_legacy_detail_tables.py` 报 3 个 `E501`。
  原因：该未修改迁移保留了超过 100 字符的 SQL 字符串，导致全量 Ruff 基线并非全绿，不代表当前改动产生回归。
  处理：不得把全量失败误报为本次回归；先对所有本次修改或新增的 Python 文件执行 Ruff 并确保通过，历史迁移的 3 个长行应在独立维护任务中修复后再恢复全量门禁。

- 触发：Codex 沙箱内 pytest 大量报 `PermissionError`，或禁用 `tmpdir` 插件后提示缺少 `tmp_path` fixture。
  原因：`tests/.tmp`、系统 `TEMP` 和 Python `tempfile` 创建的目录可能受沙箱权限限制；`-p no:tmpdir` 只适合不依赖 `tmp_path` 的目标测试，不能作为全量测试方案。
  处理：目标测试可使用项目自建的唯一 `.runtime` 目录；全量测试应在核对 `--basetemp` 位于工作区后申请沙箱外执行，例如 `D:\Anaconda\envs\homebuild-log\python.exe -m pytest --basetemp=tests/.runtime/<唯一名称>`。不得把权限失败统计成业务回归。

## 后端路由与静态前端

- 触发：前端 `dist` 存在时，带合法 token 请求未知 `/api/v1/*` 路径得到 `200 text/html`，而不是 API `404`。
  原因：未显式传入 `static_directory` 的测试会挂载真实 `frontend/dist`，当前 SPA 回退仍可能接管未知 API；已核对响应内容确为构建后的 `index.html`。
  处理：修复时必须用原始请求路径阻止 `/api/` 进入 SPA 回退，并同时覆盖“有 dist + 合法 token + 未知 API”的测试；路由隔离测试不要无意依赖工作区是否刚执行过前端构建。

## 数据库迁移

- 触发：迁移说明与当前模型不一致。
  原因：历史迁移只表示 revision 链，不代表现行业务模型。
  处理：先读当前 ORM、Schema 和迁移索引；不要批量读取或解释全部历史迁移。

- 触发：容器启动时迁移失败但服务继续运行。
  原因：入口脚本未阻断应用启动。
  处理：Alembic 失败必须终止启动，避免旧 schema 承载新代码。

- 触发：Windows 本地页面显示“服务正常”，但新功能的加载、保存等请求同时失败。
  原因：旧版 `scripts/local-control.ps1` 直接启动 FastAPI，未先执行 Alembic；旧健康检查只运行 `SELECT 1`，数据库可连接时不会发现 revision 落后或业务表缺失。曾实测代码已需要 `0019_add_pitfall_logs`，本地数据库仍在 `0015_merge_procurement`，且没有踩坑记录表。
  处理：当前本地启动已增加迁移门禁，健康接口也会校验 current/expected revision；若在旧分支复现，先备份真实 `.local-data`，再用项目解释器执行 `python -m alembic -c alembic.ini upgrade head`。迁移失败不得绕过启动保护。

- 触发：Windows 控制菜单停止服务时报告“没有可停止的受管进程”，但 8000/5173 仍在监听。
  原因：状态文件保存的 PowerShell 启动器 PID 已退出，实际 FastAPI/Node 子进程仍存活，按父 PID 与启动时间判断会丢失归属。
  处理：删除或迁移数据库前必须再用端口探测确认写入进程确实停止；修复进程管理时应记录实际监听子进程，且停止前同时核对 PID、启动时间、解释器路径和端口，不能按进程名批量结束。

## 前端 UI

- 触发：图表数字与明细不一致。
  原因：前端重复计算金额、空间继承或状态口径。
  处理：图表消费服务端聚合结果；前端只做展示和筛选。

- 触发：视觉重构后业务状态异常。
  原因：把视觉调整混入 API、状态枚举或统计逻辑变更。
  处理：UI 任务默认保持业务行为、API、数据结构和统计口径不变。

- 触发：在 `frontend` 目录执行 Vitest 目标测试时提示 `No test files found`。
  原因：过滤路径仍写成仓库根目录下的 `frontend/src/...`，相对当前目录后实际重复了一层 `frontend`。
  处理：从 `frontend` 目录运行时使用 `npm run test -- --run src/<文件>.test.tsx`；过滤路径必须相对命令工作目录。

- 触发：需要压缩前端生成图片时，项目 Python 环境导入 Pillow 报 `ModuleNotFoundError`。
  原因：`homebuild-log` 环境未安装 Pillow，但本机 Conda 工具目录已有 `D:\Anaconda\Library\bin\cwebp.exe`。
  处理：无需为单次 WebP 转换安装 Python 依赖；可直接用 `cwebp -q <质量> -resize <宽> <高> <输入.png> -o <输出.webp>`，生成后先校验文件非空再删除冗余副本。

- 触发：浏览器脚本用 `scrollHeight <= clientHeight` 检测单行标题时返回失败，但截图中标题实际未换行。
  原因：标题的绝对定位 `::before`、`::after` 装饰会参与滚动尺寸计算，使高度比较产生假阴性。
  处理：带伪元素的标题应以 `scrollWidth <= clientWidth` 检查横向裁切，并结合真实截图确认换行；不要单独用滚动高度判定单行状态。

## Docker

- 触发：远程部署脚本启用 `set -o pipefail` 后，以 `printf '%s\n' "$password" | sudo -S ...` 传入密码，脚本可能在容器已停止但备份尚未开始时无明确业务错误地提前退出。
  原因：sudo 复用认证缓存或提前关闭标准输入时，管道左侧 `printf` 可能收到 SIGPIPE；`pipefail` 将这个非零状态误判为 sudo 操作失败。
  处理：需要在受控自动化中从本机文件隐式读取 sudo 密码时，使用 here-string（`sudo -S -p '' <命令> <<< "$password"`）或其他不经过管道的标准输入方式；停容器后若脚本中断，先只读核对 `.env`、数据目录、备份和容器状态，再从明确断点续跑，不要盲目重执行整段部署。

- 触发：本机没有 Docker/WSL，却把部署写成已完成。
  原因：只做了源码检查，没有实际构建和实机验收。
  处理：明确区分“源码和脚本已准备”与“镜像构建/Ubuntu 验收已完成”。

- 触发：真实数据迁移后附件缺失或数据库不一致。
  原因：迁移前未停止 Windows 写入，或未校验 SQLite、附件数量和 SHA-256。
  处理：先停止写入，制作可验证副本，再导入 Ubuntu 并校验。

- 触发：Ubuntu 执行 `sudo ./import-data.sh` 或 `sudo ./verify.sh` 报 `Permission denied`，可能已在导入前停止容器或移除目标数据目录。
  原因：这两个脚本在 Git 中的模式是 `100644`，没有可执行位。
  处理：显式使用 `sudo sh ./import-data.sh <数据包>` 和 `sudo sh ./verify.sh`；中断后先确认数据包与 SHA-256 仍完整，再从导入步骤续跑。

- 触发：Mihomo 已启动，但 Buildx 解析 Dockerfile 前端或基础镜像元数据仍超时。
  原因：`--build-arg HTTP_PROXY/HTTPS_PROXY` 只影响构建步骤，不影响 Buildx 客户端自身。
  处理：同时给 `docker build` 进程设置代理环境变量，并用 `--network=host` 让构建步骤访问宿主机 `127.0.0.1:7890`；构建结束立即关闭代理。

- 触发：部署脚本执行 `install -o 10001 -g 10001` 报 `invalid user`，容器无法写入挂载目录。
  原因：当前 GNU `install` 把纯数字参数解释为用户名，而宿主机不存在名为 `10001` 的用户。
  处理：先创建目录，再用 `chown 10001:10001` 设置数值 UID/GID；启动前核对目录所有者。

- 触发：镜像能构建，但容器启动时报 `ModuleNotFoundError`。
  原因：`pyproject.toml` 的运行依赖没有完整同步到 Linux 运行锁文件。
  处理：对照后端第三方导入、`pyproject.toml` 和真实项目环境核对 `requirements.runtime.lock`；镜像构建后必须实际启动应用，不以构建成功代替运行验收。

- 触发：Docker 国内镜像和 Mihomo 均可用，但 Buildx 长时间停在 `resolve image config for docker-image://docker.io/docker/dockerfile:1.7`。
  原因：Dockerfile 顶部的 syntax 指令会额外解析 Dockerfile 前端镜像，该阶段可能不按预期经过宿主机代理。
  处理：确认 Dockerfile 未使用特定前端高级语法后，可用一次性临时 Dockerfile 移除 syntax 指令，让 BuildKit 使用内置前端；不要为临时网络问题修改已跟踪的 Dockerfile。

- 触发：新容器的健康、迁移和数据计数均通过，但镜像 ID 断言误判后触发保护性回退。
  原因：`docker compose images -q` 返回无 `sha256:` 前缀的纯 ID，`docker image inspect --format '{{.Id}}'` 返回带前缀的 ID，字符串直接比较必然不等。
  处理：部署验收优先检查容器 `Config.Image` 是否等于目标标签；如必须比较 ID，先统一移除或补齐 `sha256:` 前缀。
