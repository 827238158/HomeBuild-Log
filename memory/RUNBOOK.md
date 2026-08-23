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

Ubuntu 26.04、8G 笔记本上的单应用 Docker Compose 是当前已验证空数据运行基线：

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

### Ubuntu 26.04 源码构建与空数据验证

当前验证机访问 Docker Hub 需要临时启动 Mihomo。Buildx 客户端和构建步骤必须同时设置代理；npm 域名保持直连：

```bash
source ~/.bashrc
mihomo_on
cd /home/pawel/workspace/HomeBuild-Log
sudo env \
  HTTP_PROXY=http://127.0.0.1:7890 \
  HTTPS_PROXY=http://127.0.0.1:7890 \
  ALL_PROXY=socks5://127.0.0.1:7890 \
  NO_PROXY=localhost,127.0.0.1,registry.npmjs.org,.npmjs.org \
  docker build --pull=false --network=host \
  --build-arg HTTP_PROXY=http://127.0.0.1:7890 \
  --build-arg HTTPS_PROXY=http://127.0.0.1:7890 \
  --build-arg NO_PROXY=localhost,127.0.0.1,registry.npmjs.org,.npmjs.org \
  --tag homebuild-log:4a-20260715 .
mihomo_off
```

首次创建空数据容器：

```bash
cd /home/pawel/workspace/HomeBuild-Log/deploy
cp .env.example .env
chmod 600 .env
sudo install -d -m 0750 .local-data
sudo chown 10001:10001 .local-data
sudo docker compose --env-file .env up --detach
sudo sh ./verify.sh
```

默认配置访问 `http://127.0.0.1:8000`。真实数据部署机当前按 `deploy/README-LAN.md` 只绑定 `192.168.1.17:8000`；Windows 同网段直连、容器健康、前端首页、SQLite/存储和容器重启持久化已验证，手机实机登录、整机重启和机械硬盘数据目录仍待验证。

## 迁移规则

- 数据库迁移先读 `backend/migrations/README.md`。
- 新增迁移通常只需要读取当前 head 和待新增迁移。
- 不要批量读取历史迁移；只有升级链、降级链或历史数据兼容失败时才沿依赖追溯。
- Alembic 失败时不得继续启动应用。

## 安全

- 不要把密钥、令牌、完整票据、个人联系方式或原始敏感内容写入日志和 Markdown。
- Compose 默认只允许 Ubuntu 本机访问；真实数据部署机已显式绑定 `192.168.1.17:8000`，不要改为 `0.0.0.0`，也不要配置公网端口映射。
- 当前 Ubuntu 的 UFW 配置状态为“不活动”；已保存 `192.168.1.0/24` 到 `192.168.1.17:8000/TCP` 的规则。启用 UFW 前必须先核对 SSH、Tailscale 和其他服务规则，避免远程失联。
- 当前 Docker 基线不引入公网、Tailscale、HTTPS、Nginx、独立前端容器或镜像仓库。

## Codex 项目 Hooks

- 配置：`.codex/hooks.json`；脚本：`.codex/hooks/`。
- `UserPromptSubmit` 提供相关记忆片段或检索位置；`PostToolUse` 只保存匿名失败类型与指纹；`Stop` 提醒 AI 做最小归档判断。
- Hook 不自动修改记忆文件，也不保存完整命令、参数或工具日志。
- 项目首次启用或 Hook 内容改变后，在 Codex 中使用 `/hooks` 审查并信任当前定义。
- 回归测试：

```powershell
D:\Anaconda\python.exe -X utf8 -B -m unittest discover -s .codex\hooks -p "test_*.py" -v
```
