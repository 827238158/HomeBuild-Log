# Docker 快速启动

用于在 Ubuntu 上从项目源码构建并启动 HomeBuild Log。

## 准备

需要：

- Ubuntu环境
- 完整项目源码；
- Docker Engine；
- Docker Compose v2；
- Git；

部署会使用这些文件：

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | 构建前端和后端镜像 |
| `docker/entrypoint.sh` | 启动时执行数据库迁移并运行应用 |
| `deploy/compose.yaml` | 设置镜像、端口、数据目录和重启策略 |
| `deploy/.env.example` | 默认镜像标签、监听地址和端口 |
| `deploy/verify.sh` | 检查容器与健康接口 |

## 1. 构建镜像

检查命令是否可用：

```bash
docker --version
docker compose version
git --version
```

配置docker pull国内镜像源：
```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com"
  ]
}
EOF
```

重启docker生效，并检查：
```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
docker info     # 查看输出里 Registry Mirrors 是否出现配置地址
```

获取源码并构建镜像：

```bash
git clone https://github.com/827238158/HomeBuild-Log.git
cd HomeBuild-Log
sudo docker build --tag homebuild-log:4a-20260715 .
```

## 2. 创建配置和数据目录

```bash
cd deploy
cp .env.example .env
chmod 600 .env

sudo install -d -m 0750 .local-data
sudo chown 10001:10001 .local-data
```
`.local-data/` 用于保存 SQLite 数据库、附件和认证配置。它不会因为删除或重建容器而自动消失，但仍应定期备份。AI Key 是可选项；如需使用AI分析功能，可编辑 `.env`。

## 3. 启动并验证

```bash
sudo docker compose --env-file .env up --detach
sudo sh ./verify.sh
```

验证成功时会看到：

```text
HomeBuild Log 已通过容器健康检查。
```

还可以查看容器状态：

```bash
sudo docker compose --env-file .env ps
```

状态中的 `healthy` 表示应用、数据库和存储检查已经通过。

默认访问地址：

```text
http://127.0.0.1:8000
```

首次启动生成的管理员密码可在容器日志中查看：

```bash
sudo docker compose --env-file .env logs --tail 100 app
```

### 4. 打开页面

如果 Ubuntu 上有浏览器，直接访问：

```text
http://127.0.0.1:8000
```

如果 Ubuntu 是远程机器，可以在自己本机建立 SSH 隧道：

```powershell
ssh -N -L 8000:127.0.0.1:8000 用户名@Ubuntu地址
```

本地浏览器访问：

```text
http://127.0.0.1:8000
```

## 常用命令

以下命令在 `HomeBuild-Log/deploy` 目录执行。

```bash
# 查看容器状态
sudo docker compose --env-file .env ps

# 查看最近日志
sudo docker compose --env-file .env logs --tail 100 app

# 重启现有容器
sudo docker compose --env-file .env restart app

# 停止并删除容器
sudo docker compose --env-file .env down

# 再次创建并启动容器
sudo docker compose --env-file .env up --detach
```

`down` 不会删除 `deploy/.local-data/`。该目录保存数据库、附件和配置，不要随意删除；升级或迁移前应先备份。

## 注意

- 当前 Compose 默认使用本地镜像并设置了 `pull_policy: never`，不会从互联网拉取镜像。
- `deploy.sh` 用于带镜像归档和 `SHA256SUMS` 的离线包，不适用于本教程的源码构建流程。
- 默认只监听 `127.0.0.1`。不要直接暴露到公网；局域网部署需另行完成安全和访问验证。
