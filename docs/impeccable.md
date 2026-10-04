# Impeccable 项目接入

## 安装组成

上游：<https://github.com/pbakaus/impeccable>。项目内技能 4.5.0 保存在 `.agents/skills/impeccable/`，包含原始参考文件、agents、脚本与 LICENSE/NOTICE。

Windows x64 引擎 0.1.11 位于 `.local-artifacts/impeccable/bin/0.1.11/impeccable.exe`，官方 SHA-256：`605b5b442d2a65d270ef989de13371444849526249f511d397ca7424c184db49`。二进制不进入 Git，其他机器需单独准备。

`scripts/impeccable.cmd` 固定项目缓存并检查引擎存在；缺失时退出，不自动下载。上游技能启动器命令在本项目 Windows 环境统一使用此入口。`PRODUCT.md` 保存产品事实；既有 `DESIGN.md` 保持原内容。共享检测配置在 `.impeccable/config.json`。

`.codex/hooks.json` 追加 PostToolUse 与 Stop 设计检测，保留三条记忆 Hook。检测提示只提供修正线索，项目规则和用户要求优先。

## 使用

安装后下一轮尝试 `$impeccable`；如技能未出现，重新打开项目或重启 Codex。自动 Hook 的信任由 Codex 管理，出现批准提示时在 `/hooks` 检查并批准。手动命令通过不代表自动 Hook 已生效。

可直接对助手说：“用 Impeccable critique 审查调研笔记页，先报告，不修改”，或“用 Impeccable polish 打磨调研笔记页，保持业务逻辑与现有中文字体”。

从项目根目录执行：

```powershell
& scripts/impeccable.cmd context --target frontend/src/ResearchView.tsx
& scripts/impeccable.cmd hooks status
& scripts/impeccable.cmd detect frontend/src/research.css
& scripts/impeccable.cmd detect frontend/src
```

detect 退出 0 表示无主要命中，2 表示存在主要命中，1 表示扫描目标失败。应按实际影响评估，不按命中数量批量改页面。

前端位于子目录：已观察到根目录 context 的 hasVisualImplementation 返回 false，即使传入实际 TSX 目标也如此。不可据此把项目当作空白项目；必须结合 DESIGN 与实际页面和代码确认现有界面。浏览器 live/generate 尚未配置或验收。

## 更新与迁移

不要直接用安装器覆盖 `.codex/hooks.json`，不要用 document 覆盖 DESIGN。更新前记录版本、备份配置；先在独立临时目录安装新技能，核对差异后替换并合并 Hook。

其他 Windows 机器准备引擎：读取技能 scripts/VERSION，从官方 release 下载同版本 impeccable-windows-x64.exe 与 .sha256，用 Get-FileHash -Algorithm SHA256 核对后放到 `.local-artifacts/impeccable/bin/<版本>/impeccable.exe`。优先让用户手动准备，不绕过校验。地址格式：`https://github.com/pbakaus/impeccable/releases/download/engine-v<版本>/impeccable-windows-x64.exe`。

包装入口仅支持 Windows。Linux 部署应用无需该开发技能；如需 Linux 开发，另行准备对应引擎并验证 Hook。

## 已验证（2026-10-04）

官方引擎摘要通过；Windows 包装入口可运行；context 加载 PRODUCT/DESIGN；hooks status 显示 enabled；research.css 静态扫描无命中。忽略目录中的渐变文字样例以 no-config 扫描命中 gradient-text，退出 2；手动 PostToolUse 输入返回对应检测提示，Stop 输入退出 0。以上不能证明 Codex Hook 信任已批准或真实自动触发。

缓存与输出已忽略，未改业务源码、数据库、README，未推送或部署。
