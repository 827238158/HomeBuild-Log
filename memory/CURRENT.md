# 当前状态

## 最近确认：2026-09-25 Ubuntu Docker 与内网 HTTPS 部署

以下为该日已验证事实。

- `ubuntu26` 的应用镜像为 `homebuild-log:b3fe9f56246e`（OCI 版本标签一致），Caddy 为 `caddy:2.11.4-alpine`。应用 `healthy`，Caddy 运行中，两个容器均为 `restart: unless-stopped`。Ubuntu 源码经校验过的增量 Git bundle 快进到 `7d5e9b4`（后续仅含记忆更新），已与先行推送的 GitHub `main` 一致；运行镜像仍对应 `b3fe9f5`。
- HTTP `192.168.1.17:8000` 与 HTTPS `192.168.1.17:443` 正在并行；Caddy 只转发家庭网段 `192.168.1.0/24`，Ubuntu UFW 实际为不活动。Ubuntu 以根证书、Windows 当前用户以系统信任库验证 HTTPS 健康接口均返回 200；Windows 未认证转写请求返回 401。用户已确认电脑浏览器可打开 HTTPS 页面，麦克风录音及手机、平板尚未验收。
- 数据库 revision 为 `0019_add_pitfall_logs`，SQLite 完整性为 `ok`；97 条记录、80 条来源、23 条问题、22 条关系、1 条旧待办备份、2 条踩坑和 2 条处理记录仍在。构建及验收见 `LOG.md` 的 2026-09-25 记录。
- 此次无迁移文件变化；停写后创建的 `deploy/.deployment-backups/local-data-pre-b3fe9f56246e.tar.gz` 已通过 SHA-256 与归档可读性校验，归档以 `.local-data/` 为顶层。`.last-upgrade` 现指向这份备份和直接上一版镜像 `homebuild-log:825e98ee2a29`；`rollback.sh` 已加入归档、镜像检查与 HTTPS profile 支持，语法通过，**实际破坏性回退尚未演练**。
- 用户授权后，Ubuntu 已删除 8 月至上一版本的旧数据归档及旧 `.env` 副本；部署备份目录只保留当前恢复点和 SHA-256 文件。Caddy CA 卷备份 `/home/pawel/homebuild-caddy-data-825e98ee2a29.tar.gz` 仍存在、校验可读且权限为 600。11 个更早的应用镜像标签仍在：自动审批认为“删除旧备份”未覆盖镜像删除并拒绝了该操作，待用户明确授权；当前和上一版镜像均保留。
- 根证书保存在 Windows 工作区忽略目录 `deploy/.local-data/homebuild-ca-root.crt` 和 Ubuntu `/home/pawel/homebuild-ca-root.crt`；Windows 当前用户已安装并信任。SHA-256 指纹为 `FC:72:5D:E4:0D:54:84:D5:25:E8:DF:A8:EA:0A:8A:74:B8:A2:CE:BC:4A:4D:52:16:46:C7:A4:FA:E6:17:56:4B`。
- 构建使用 DaoCloud、npmmirror 和阿里云 PyPI；本次 Ubuntu 直连 GitHub 超时，最终经校验过的 Git bundle 快进源码；临时 Mihomo 尝试后已关闭。
- AI 配置沿用小米 `mimo-v2.6-pro` 优先、DeepSeek `deepseek-flash` 备用；语音转写已通过真实小米请求验证，来源提取接口的供应商兼容性仍需单独实测。

## 当前未完成：2026-09-25 录入页真实设备验收

- 录入页的快速记录、待整理布局和模型选择已完成本地测试、TypeScript 检查、前端构建及 Ubuntu 部署；仍需在真实手机、平板浏览器验收。

## 当前未完成：2026-09-25 快速记录语音输入实机验收与 HTTPS 收口

- 语音录入和鉴权转写接口已部署；本地后端 129 项、前端 129 项自动化测试、前端 lint 与构建通过。麦克风按钮已改为无边框、44×44 点击区，在输入框内右下各留 4px；Windows 经 HTTPS 取得的新 CSS 含该规则，但真实浏览器视觉验收仍待完成。Ubuntu 正式容器的鉴权接口对本机系统合成的 4.5 秒中文 WAV 调用小米模型并返回忠实转写，接口全程约 1.7 秒、模型处理约 1.6 秒；该样本不能代表手机现场录音质量或端到端耗时。
- Windows 的根证书已信任，但实际桌面浏览器的登录、麦克风权限、录音声波、文字回填仍需确认；本轮浏览器控制服务不可用，未以命令行 HTTPS 校验代替浏览器验收。手机和平板仍需逐台安装并信任根证书，再测试登录、录音与转写。
- 仅在电脑、手机、平板实际验收通过后，才把 HTTP 8000 改绑 `127.0.0.1`，保留可回退配置；当前局域网 HTTP 仍开放。

## 待验收

- 原手机和平板浏览器上的响应式布局、日期控件及手机真实登录；桌面 Chromium 尺寸模拟不能替代真实 iOS/WebKit 验收。
- Ubuntu 整机重启恢复、机械硬盘运行和资源占用。
- 手机/PWA、离线同步、OCR 和视觉理解不属于已验收能力。
