# Runbook

## 环境

- 操作系统基线：Windows 11 本地开发。
- Python：项目环境为 Conda `homebuild-log`，Python 3.13。
- 显式解释器：`D:\Anaconda\envs\homebuild-log\python.exe`。
- 前端：Node + npm，脚本以 `frontend/package.json` 为准。
- 运行数据：项目根目录 `.local-data/`。

执行 Python 命令前先确认解释器和 pip 属于同一环境，不要混用 base、项目环境和系统 Python。

## Windows 本地启动

优先使用根目录 `HomeBuild-Log.cmd`。菜单可启动前后端、停止由菜单启动的进程、查看状态和打开网页。

手动启动后端：

```powershell
Set-Location backend
D:\Anaconda\envs\homebuild-log\python.exe -m alembic -c alembic.ini upgrade head
D:\Anaconda\envs\homebuild-log\python.exe -m fastapi dev app/main.py --host 127.0.0.1 --port 8000
```

根目录控制菜单会在启动前自动执行同一迁移命令；迁移失败时不会启动后端或前端。

手动启动前端：

```powershell
Set-Location frontend
npm run dev
```

访问：

- 前端：`http://127.0.0.1:5173`
- 后端健康：`http://127.0.0.1:8000/api/v1/health`
- OpenAPI：`http://127.0.0.1:8000/docs`

## 后端安装与检查

```powershell
Set-Location backend
D:\Anaconda\envs\homebuild-log\python.exe -m pip install -r requirements.lock
D:\Anaconda\envs\homebuild-log\python.exe -m pip install -e . --no-deps
D:\Anaconda\envs\homebuild-log\python.exe -m alembic -c alembic.ini upgrade head
D:\Anaconda\envs\homebuild-log\python.exe -m ruff check . --no-cache
D:\Anaconda\envs\homebuild-log\python.exe -m pytest
```

## 前端安装与检查

```powershell
Set-Location frontend
npm ci
npm run lint
npm run test
npm run build
npm audit
```

## AI 配置

AI 默认关闭。环境变量优先于 `.local-data/config/secrets.json`。

```powershell
$env:DEEPSEEK_API_KEY = "你的 DeepSeek Key"
$env:MIMO_API_KEY = "你的 MiMo Key"
```

未配置任何 Key 时服务仍应正常启动，`auto` 模式使用本地规则。

## Docker 部署

部署形态为 Ubuntu 26.04、8G 笔记本上的单应用 Docker Compose；最近确认的运行状态、镜像和待验收事项只维护在 `memory/CURRENT.md`：

- 当前 Ubuntu 验证目录：`/home/pawel/workspace/HomeBuild-Log`。
- Compose 文件：`deploy/compose.yaml`。
- 容器入口：`docker/entrypoint.sh`。
- Ubuntu 部署脚本：`deploy/deploy.sh`。
- Ubuntu 验证脚本：`deploy/verify.sh`。
- Ubuntu 升级脚本：`deploy/upgrade.sh`。
- Ubuntu 回退脚本：`deploy/rollback.sh`。
- 真实数据导入脚本：`deploy/import-data.sh`。

Windows 生成离线包：

```powershell
.\scripts\build-offline-bundle.ps1
```

停止本地写入后导出真实数据：

```powershell
.\scripts\export-data.ps1
```

当前电脑未安装 Docker 或 WSL 时，不要声称镜像已构建或 Ubuntu 已验收。

### 源码更新的默认路径

- 先核对目标提交、工作树和迁移差异，再选择数据恢复方案；过去某次未创建恢复点不代表以后默认跳过备份。
- GitHub 先做有超时的连通性检查；直连失败才使用临时代理。代理也失败时，按 PITFALLS 的 Git bundle 条目处理。
- 构建优先使用 DaoCloud 基础镜像、npmmirror 与清华 PyPI。最近部署使用一次性临时 Dockerfile；仓库 Dockerfile 尚未内置这些替换，不能直接把普通 `docker build` 当作国内源构建。
- 临时 Dockerfile 应以本次仓库 Dockerfile 为基础，只替换镜像/包源；版本、构建阶段与应用内容保持一致。镜像标签取目标提交的短 SHA，并传入 `APP_VERSION`。具体替换命令需要核对本次 Dockerfile 后生成。
- 镜像构建完成后再按已确认的恢复方案切换 Compose；验证容器目标标签、健康、数据库 revision、数据完整性及访问情况，结束时清理临时代理。
- `deploy/upgrade.sh` 面向含 `SHA256SUMS` 的离线镜像包，不能直接用于只有源码构建镜像的更新。

### Docker Hub 代理构建备选

仅当确实需要通过代理访问 Docker Hub 时使用下面的命令。它是构建备选，不包含真实数据容器切换；`mihomo_on/off` 仅适用于已加载这些函数的交互 shell，非交互 SSH 见 PITFALLS。Buildx 客户端和构建步骤均需代理：

```bash
source ~/.bashrc
mihomo_on
cd /home/pawel/workspace/HomeBuild-Log
target_tag="$(git rev-parse --short=12 HEAD)"
sudo env \
  HTTP_PROXY=http://127.0.0.1:7890 \
  HTTPS_PROXY=http://127.0.0.1:7890 \
  ALL_PROXY=socks5://127.0.0.1:7890 \
  NO_PROXY=localhost,127.0.0.1,registry.npmjs.org,.npmjs.org \
  docker build --pull=false --network=host \
  --build-arg HTTP_PROXY=http://127.0.0.1:7890 \
  --build-arg HTTPS_PROXY=http://127.0.0.1:7890 \
  --build-arg NO_PROXY=localhost,127.0.0.1,registry.npmjs.org,.npmjs.org \
  --build-arg APP_VERSION="$target_tag" \
  --tag "homebuild-log:$target_tag" .
mihomo_off
```

### 首次空数据初始化

仅新环境执行；已有真实数据时使用更新流程：

```bash
cd /home/pawel/workspace/HomeBuild-Log/deploy
cp .env.example .env
chmod 600 .env
sudo install -d -m 0750 .local-data
sudo chown 10001:10001 .local-data
sudo docker compose --env-file .env up --detach
sudo sh ./verify.sh
```

默认配置访问 `http://127.0.0.1:8000`；局域网绑定配置见 `deploy/README-LAN.md`，最近验收状态见 `memory/CURRENT.md`。

## 迁移规则

- 数据库迁移先读 `backend/migrations/README.md`。
- 新增迁移通常只需要读取当前 head 和待新增迁移。
- 不要批量读取历史迁移；只有升级链、降级链或历史数据兼容失败时才沿依赖追溯。
- Alembic 失败时不得继续启动应用。

## 安全

- 不要把密钥、令牌、完整票据、个人联系方式或原始敏感内容写入日志和 Markdown。
- Compose 默认只允许 Ubuntu 本机访问；真实数据部署机已显式绑定 `192.168.1.17:8000`，不要改为 `0.0.0.0`，也不要配置公网端口映射。
- 防火墙状态必须现场确认。启用 UFW 前必须先核对 SSH、Tailscale 和其他服务规则，避免远程失联。
- 当前 Docker 基线不引入公网、Tailscale、HTTPS、Nginx、独立前端容器或镜像仓库。

## Codex 项目 Hooks

- 配置：`.codex/hooks.json`；脚本：`.codex/hooks/`。
- `UserPromptSubmit` 按 `.codex/hooks/memory_routes.json` 检索；`PostToolUse` 仅采集具有明确失败状态的匿名类型与指纹；首次 `Stop` 强制续行一次以完成记忆审计，续行后的 `Stop` 放行，避免循环。重复或高价值失败另附踩坑审计线索。
- 不再扫描或哈希整个工作区，不根据提示词或文档中的报错文字要求归档。没有实际复用价值时无需更新记忆。
- 项目 Hook 使用 Windows base Python；应用后端继续使用本手册的项目环境。当前 Hook 命令为本机绝对路径，迁移主机/克隆目录时须重配并重新审查。
- Hook 不自动修改记忆文件，也不保存完整命令、参数或工具日志。
- 项目首次启用或 Hook 内容改变后，在 Codex 中使用 `/hooks` 审查并信任当前定义。
- 回归测试：

```powershell
D:\Anaconda\python.exe -X utf8 -B -m unittest discover -s .codex\hooks -p "test_*.py" -v
```

项目 Hook 已做有意的本地精简；技能安装器 `--check` 比较的是模板一致性，可能报告差异，不等同于运行测试失败。不要为消除模板差异直接覆盖本地实现。
