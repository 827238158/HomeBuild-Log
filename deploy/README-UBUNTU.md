# HomeBuild Log Ubuntu 离线部署

## 前置条件

- Ubuntu 26.04 x86_64（已完成空数据实机验证；24.04 未验证）。
- 已安装 Docker Engine 与 Docker Compose v2；当前账号可使用 `sudo`。
- 当前 Docker 基线默认只监听 `127.0.0.1:8000`，不提供公网、HTTPS 或 Tailscale。

## 首次部署

1. 把整个离线包复制到 `/opt/homebuild-log`。
2. 如需从 Windows 访问，在 `.env` 中把 `HOMEBUILD_BIND_ADDRESS` 改为 Ubuntu 的家庭局域网地址；不要填写 `0.0.0.0`。
3. 执行：

   ```bash
   cd /opt/homebuild-log
   sudo chmod +x ./*.sh
   sudo ./deploy.sh
   ```

4. 本机浏览器访问 `http://127.0.0.1:8000`。首次启动生成的管理员密码可通过 `sudo docker compose logs app` 查看，随后应妥善保存。

## 真实数据迁移

先在 Windows 停止 HomeBuild Log，再运行项目中的数据导出脚本。把生成的 `.tar.gz` 和 `.sha256` 一并复制到 Ubuntu，在首次启动前执行：

```bash
cd /opt/homebuild-log
sudo ./import-data.sh /路径/homebuild-data-时间.tar.gz
sudo ./deploy.sh
```

数据包包含管理员密钥、AI 配置和附件，应使用可信移动介质并限制文件读取权限。

## 验证、升级和回退

- 健康复查：`sudo ./verify.sh`
- 查看状态：`sudo docker compose --env-file .env ps`
- 查看日志：`sudo docker compose --env-file .env logs --tail 100 app`
- 升级：把新离线包内的镜像和 `SHA256SUMS` 放入本目录，执行 `sudo ./upgrade.sh 新镜像标签`。
- 升级失败：执行 `sudo ./rollback.sh`，按风险提示输入确认词。
