# HomeBuild Log

> 本地优先的个人装修事实工作台：保存原始资料，整理事件、账目、问题、尺寸、决策和调研记录，让装修过程有据可查。

HomeBuild Log 面向自己管理装修过程的个人业主。把分散在聊天记录、票据、相册和备忘录里的装修信息集中保存，并通过“原始来源 → 候选信息 → 人工确认 → 正式记录”的方式，避免未经确认的内容直接进入正式档案。

项目采用 React、TypeScript、FastAPI 和 SQLite 构建，在 Windows 本地运行，或通过 Docker 部署到 Ubuntu。业务数据默认保存在本地目录中，AI 分析功能默认关闭。

## 运行指南

推荐使用 **Ubuntu + Docker** 运行 HomeBuild Log。下面的命令除 SSH 端口映射外，均在 Ubuntu 终端执行。完整的构建说明请查看 [Docker 本地快速部署](deploy/README-DOCKER-QUICKSTART.md)。使用预先导出的镜像归档部署时，请查看 [Ubuntu 离线部署说明](deploy/README-UBUNTU.md)。

### Windows 本地运行

获取源码：
```bash
git clone https://github.com/827238158/HomeBuild-Log.git
```

安装前后端依赖：
```bash
py -3.13 -m venv .venv
.venv\Scripts\activate.bat
python -m pip install -r backend\requirements.lock -i https://pypi.tuna.tsinghua.edu.cn/simple
python -m pip install -e backend --no-deps
npm --prefix .\frontend ci --registry=https://registry.npmmirror.com
```

首次运行或项目升级后，需要初始化或升级数据库：

```cmd
pushd backend
..\.venv\Scripts\python.exe -m alembic -c alembic.ini upgrade head
popd
```

该命令会将数据库升级到最新结构。已经是最新版本时不会重复修改；如果迁移失败，请不要继续启动后端。

Windows手动启动前后端：
后端：
```bash
.venv\Scripts\activate.bat
cd backend
python -m fastapi dev app/main.py --host 127.0.0.1 --port 8000
```

前端：
```bash
.venv\Scripts\activate.bat
cd frontend
npm run dev
```

前端页面：
```text
http://127.0.0.1:8000
```
首次启动会自动在cmd生成随机密码，应立即保存，后续密码将以哈希码形式存储在secrets.json中。删除该文件中的密码可再次重新生成。

## 界面预览

> 产品截图将在完成隐私脱敏后补充。计划展示装修概览、来源录入、账本和时间线页面。

## 为什么需要 HomeBuild Log

装修过程中经常遇到这些问题：

- 重要信息散落在微信、图片、PDF、票据和临时笔记中；
- 付款、退款、施工问题和尺寸记录缺少统一入口；
- 很难回溯“什么时候发生了什么，以及原始证据在哪里”；
- 自动提取的信息可能存在误差，不适合未经确认直接写入正式档案；
- 装修资料包含地址、金额、联系方式等隐私，不适合默认上传到第三方服务。

HomeBuild Log 的目标不是替用户自动做决定，而是保存原始事实、辅助整理信息，并把最终确认权留给用户。

## 核心功能

- **来源留存**：录入文字，并可附加单个图片或 PDF 作为原始证据；
- **候选确认**：从来源文字生成候选信息，由用户确认后再进入正式记录；
- **六类记录**：统一管理事件、账目、问题、尺寸、决策和调研；
- **时间线**：按时间回顾装修过程和关键变化；
- **账本**：记录付款、退款和收入，查看装修净支出；
- **问题与空间**：跟踪待处理事项，并按房间或区域组织资料；
- **分析与搜索**：提供装修概览、记录分析、智能分析和全文搜索；
- **本地优先**：SQLite、附件和配置保存在本机 `.local-data/` 目录；
- **可选 AI 分析**：支持 MiMo、DeepSeek 等 OpenAI 兼容接口，未配置时可使用本地规则。

## 工作流程

```text
录入文字和附件
        ↓
保留原始来源
        ↓
生成候选信息
        ↓
用户检查并确认
        ↓
形成正式装修记录
        ↓
进入时间线、账本、问题、空间、分析和搜索
```

## 技术架构

| 层级 | 技术 |
| --- | --- |
| 前端 | React、TypeScript、Vite、ECharts |
| 后端 | Python、FastAPI、SQLAlchemy、Alembic |
| 数据 | SQLite、本地附件目录 |
| 部署 | Docker、Docker Compose |
| 测试 | Pytest、Vitest |

Docker 使用多阶段构建：Node.js 阶段负责构建前端静态资源，Python Slim 阶段安装后端运行依赖并装入前端构建结果。最终容器不包含 Node.js 开发环境，并以非 root 用户运行。

## 数据与隐私

运行数据统一位于项目根目录或部署目录下的 `.local-data/`，包括：

- SQLite 数据库；
- 用户上传的附件；
- 管理员认证配置；
- 可选的 AI 配置。

部署时默认只监听 `127.0.0.1`，不会直接向局域网或公网开放。需要从其他设备访问时，应先完成访问控制、网络边界和备份方案验证。

## 当前状态

目前已经具备：

- 文字来源录入和单个图片/PDF 附件留存；
- 候选信息生成、人工确认和正式记录管理；
- 时间线、账本、问题、空间、记录分析、智能分析和搜索；
- Windows 11 本地运行；
- Ubuntu 26.04 x86_64 空数据 Docker 构建、健康检查和容器重启持久化验证。

尚未完成或尚未验收：

- 局域网访问、资源占用和长期运行验证；
- OCR、图片内容理解、完整 PWA 和离线同步。

## 项目文档

| 文档 | 用途 |
| --- | --- |
| [Docker 本地快速部署](deploy/README-DOCKER-QUICKSTART.md) | Ubuntu 从源码构建镜像并启动容器 |
| [Ubuntu 离线部署说明](deploy/README-UBUNTU.md) | 使用镜像归档和校验文件部署 |
| [运行手册](memory/RUNBOOK.md) | 启动、测试、构建、迁移和恢复命令 |
| [设计规范](DESIGN.md) | UI、视觉和交互规则 |
| [数据库迁移说明](backend/migrations/README.md) | 数据库迁移子系统入口 |
| [Agent 工作规则](AGENTS.md) | AI 编程助手的检索和修改边界 |

## 项目定位

HomeBuild Log 当前首先服务于个人、本地和可信环境，不是面向公网多用户场景设计的 SaaS。项目仍在持续开发中，现阶段更适合个人试用、学习和自托管验证。
