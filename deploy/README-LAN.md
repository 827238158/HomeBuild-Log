# HomeBuild Log 局域网访问

当前 Ubuntu 地址为 `192.168.1.17`，只向家庭网段 `192.168.1.0/24` 提供 HTTP 服务，不要在路由器上配置公网端口映射。

## 修改 `.env`

进入部署目录并先备份配置：

```bash
cd /home/pawel/workspace/HomeBuild-Log/deploy
cp -p .env .env.pre-lan-20260821
```

把 `.env` 中的监听配置改为：

```dotenv
HOMEBUILD_BIND_ADDRESS=192.168.1.17
HOMEBUILD_PORT=8000
```

使用现有镜像重新创建容器，不需要重新构建：

```bash
docker compose --env-file .env up --detach --no-build app
```

## 防火墙与验证

只为家庭网段添加 8000/TCP 规则：

```bash
sudo ufw allow from 192.168.1.0/24 to 192.168.1.17 port 8000 proto tcp comment 'HomeBuild Log LAN'
sudo ufw status
```

如果 UFW 显示“不活动”，规则只会被保存而不会生效。不要在远程会话中直接启用 UFW；应先检查 SSH、Tailscale 和其他现有服务的放行规则，避免锁住远程连接。

```bash
docker compose --env-file .env ps
ss -lnt '( sport = :8000 )'
curl http://192.168.1.17:8000/api/v1/health
sudo sh ./verify.sh
```

手机、Windows 和 Ubuntu 本机统一访问：

```text
http://192.168.1.17:8000
```

绑定局域网地址后，Ubuntu 的 `http://127.0.0.1:8000` 不再可用。手机必须连接同一家庭网络；访客网络或 AP 隔离可能阻止访问。

## 回退

恢复备份中的 `HOMEBUILD_BIND_ADDRESS=127.0.0.1`，删除对应 UFW 规则后重新创建容器：

```bash
cp -p .env.pre-lan-20260821 .env
sudo ufw delete allow from 192.168.1.0/24 to 192.168.1.17 port 8000 proto tcp
docker compose --env-file .env up --detach --no-build app
```
