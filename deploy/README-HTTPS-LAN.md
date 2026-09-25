# HomeBuild Log 内网 HTTPS

本文适用于已有真实数据、当前通过 `http://192.168.1.17:8000` 访问的 Ubuntu Docker 部署。先让 HTTPS 443 与 HTTP 8000 并行；只有电脑、手机、平板都信任证书并通过登录与录音验收后，才将 HTTP 改为仅本机访问。不要配置路由器公网端口映射。

## 风险与准备

- Caddy 的 `/data` Docker 卷保存本地 CA **私钥**。安装根证书意味着设备信任该 CA 签发的证书，必须保护私钥。丢失该卷会生成新的 CA，已信任旧证书的设备需要重新安装证书；泄露私钥则需撤销旧信任并更换 CA。不要运行 `docker compose down -v`，不要把私钥、卷备份或 `.env` 提交 Git。
- 新增镜像需要用户手动准备，不由部署命令自动下载。优先从可信国内 Docker 镜像源取得官方 `caddy:2.11.4-alpine` 对应镜像，核对来源和摘要后在 Ubuntu 上标记为 `caddy:2.11.4-alpine`。如通过可信机器离线转入，可在 Ubuntu 使用 `sudo docker load -i /路径/caddy-镜像.tar`；具体镜像来源和摘要以实际取得的资源为准。
- 验证镜像已在本机：`sudo docker image inspect caddy:2.11.4-alpine`。Compose 为 Caddy 设置了 `pull_policy: never`，镜像缺失时会报错，不会自行拉取。
- 443/TCP 必须空闲。部署前执行 `sudo ss -lnt '( sport = :443 )'`，并确认家庭网段仍为 `192.168.1.0/24`、Ubuntu 地址仍为 `192.168.1.17`；若地址变化，先同步修改下述配置和证书访问地址。

## 并行启动 HTTPS

在 `/home/pawel/workspace/HomeBuild-Log/deploy` 的现有 `.env` 中保留 `HOMEBUILD_BIND_ADDRESS=192.168.1.17`、`HOMEBUILD_PORT=8000` 与现有 AI 密钥，加入：

```dotenv
HOMEBUILD_CADDY_IMAGE=caddy:2.11.4-alpine
HOMEBUILD_HTTPS_HOST=192.168.1.17
HOMEBUILD_HTTPS_BIND_ADDRESS=192.168.1.17
HOMEBUILD_HTTPS_PORT=443
HOMEBUILD_LAN_CIDR=192.168.1.0/24
```

操作前先用权限受限的文件备份现有 `.env`。不要用 `.env.example` 覆盖真实 `.env`。以下命令不会构建或下载镜像：

```bash
cd /home/pawel/workspace/HomeBuild-Log/deploy
cp -p .env "$HOME/homebuild-env-before-https"
chmod 600 "$HOME/homebuild-env-before-https"
sudo docker compose --profile https --env-file .env config --quiet
sudo docker compose --profile https --env-file .env up --detach --no-build caddy
sudo docker compose --profile https --env-file .env ps
```

`caddy` 是可选 `https` profile，普通 `docker compose up app` 不会要求 Caddy 镜像。Caddy 通过 Compose 内部网络访问应用；HTTP 8000 在并行期保持现状。Caddyfile 使用 `tls internal`，CA 和证书保存在 Compose 的 `homebuild-log_caddy_data` 卷中。

为家庭网段开放 443/TCP，检查现有防火墙规则后执行：

```bash
sudo ufw allow from 192.168.1.0/24 to 192.168.1.17 port 443 proto tcp comment 'HomeBuild Log HTTPS LAN'
sudo ufw status
curl -k --fail --show-error https://192.168.1.17/api/v1/health
```

`curl -k` 只用于尚未安装根证书时的首次连通性检查。Docker 的端口发布有时绕过 UFW，因此 Caddyfile 还按直连客户端 IP 拒绝非家庭网段；需要从实际设备验证此限制。若设备被误判为网段外，先检查 Docker、路由和访问路径，不要直接删除访问限制。UFW 若为 inactive，上述规则不会生效；不要在远程会话中贸然启用 UFW，应先核对 SSH 等现有放行规则。

## 导出并信任根证书

确认 HTTPS 可以应答后，仅导出**公开根证书**，不要导出或分发同目录的 `root.key`：

```bash
sudo docker compose --profile https --env-file .env exec -T caddy \
  cat /data/caddy/pki/authorities/local/root.crt > "$HOME/homebuild-ca-root.crt"
openssl x509 -in "$HOME/homebuild-ca-root.crt" -noout -subject -fingerprint -sha256
curl --cacert "$HOME/homebuild-ca-root.crt" --fail --show-error \
  https://192.168.1.17/api/v1/health
```

通过可信途径把 `homebuild-ca-root.crt` 复制到实际使用的设备，先逐台核对 SHA-256 指纹，再在设备的**受信任根证书颁发机构**中安装并启用信任。Windows 可导入当前用户的“受信任的根证书颁发机构”；iPhone/iPad 在安装描述文件后还需在证书信任设置中开启完全信任；Android、macOS 和 Firefox 的信任入口随版本而异，按设备实际设置操作。证书安装后直接访问 `https://192.168.1.17`，确认浏览器没有证书警告，再验证登录、麦克风权限、录音和转写。

建议在切换前备份 CA 卷，备份文件应放在仓库之外并限制为仅本人可读。例如确认 `homebuild-log_caddy_data` 卷存在后，暂时停止 Caddy 再用已准备好的镜像打包；并行期 HTTP 仍可用：

```bash
sudo docker volume inspect homebuild-log_caddy_data
sudo docker compose --profile https --env-file .env stop caddy
sudo docker run --rm --pull=never --entrypoint tar \
  -v homebuild-log_caddy_data:/source:ro \
  -v "$HOME:/backup" \
  caddy:2.11.4-alpine \
  -C /source -czf /backup/homebuild-caddy-data.tar.gz .
sudo chown "$(id -u):$(id -g)" "$HOME/homebuild-caddy-data.tar.gz"
chmod 600 "$HOME/homebuild-caddy-data.tar.gz"
sudo docker compose --profile https --env-file .env start caddy
```

该归档含 CA 私钥，只能保存在受控位置。恢复时必须在 Caddy 停止后恢复整卷，不能只复制 `root.crt`。

## 关闭局域网 HTTP 与回退

实际设备验收通过后，把 `.env` 中的 `HOMEBUILD_BIND_ADDRESS` 改为 `127.0.0.1`，保留 `HOMEBUILD_PORT=8000` 供 Ubuntu 本机验证。然后只重建 app 容器，不重建 Caddy 卷：

```bash
sudo docker compose --profile https --env-file .env up --detach --no-build --no-deps app
sudo docker compose --profile https --env-file .env ps
curl --cacert "$HOME/homebuild-ca-root.crt" --fail --show-error \
  https://192.168.1.17/api/v1/health
sudo ufw delete allow from 192.168.1.0/24 to 192.168.1.17 port 8000 proto tcp
```

从家庭网内另一台设备确认 `http://192.168.1.17:8000` 不再可访问，且 HTTPS 的登录和录音继续正常。不要把绑定地址改成 `0.0.0.0`。

若 HTTPS 尚未验收，可保持原 HTTP 配置并停止 Caddy：`sudo docker compose --profile https --env-file .env stop caddy`。若已关闭局域网 HTTP，需要回退时将 `HOMEBUILD_BIND_ADDRESS` 改回 `192.168.1.17`，执行 `sudo docker compose --profile https --env-file .env up --detach --no-build --no-deps app`，按需恢复原 8000 防火墙规则；确认 HTTP 可用后再停止 Caddy。整个回退过程不要删除 `homebuild-log_caddy_data` 卷。
