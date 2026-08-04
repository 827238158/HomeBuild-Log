---
version: "1.0"
name: HomeBuild Log
description: 面向个人业主的冷静、可信、可追溯的装修事实工作台。
colors:
  canvas: "#f5f6f8"
  surface: "#ffffff"
  surface-soft: "#f8fafc"
  surface-muted: "#eef2f6"
  sidebar: "#171d24"
  sidebar-active: "#293746"
  ink: "#1f2328"
  ink-muted: "#667085"
  ink-subtle: "#8a94a3"
  border: "#e1e6eb"
  border-strong: "#cfd6de"
  primary: "#1769c2"
  primary-active: "#0d5cad"
  primary-soft: "#e8f2ff"
  accent: "#a4512f"
  risk: "#c93434"
  risk-soft: "#fff0f0"
  warning: "#9a650e"
  warning-soft: "#fff7e6"
  success: "#28784c"
  success-soft: "#ecf8f1"
typography:
  page-title:
    fontFamily: "PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.3
  section-title:
    fontFamily: "PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  control: "8px"
  card: "12px"
  panel: "16px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
---

# HomeBuild Log 设计系统

## 方向

界面是装修事实、费用、问题、决策和证据的个人工作台。它应该显得冷静、可信、可追溯，而不是营销页、社交产品或炫技型数据大屏。

视觉基线为浅色主工作区加深色侧栏。层级主要依靠留白、细边框、字号和字重建立；阴影只用于抽屉、弹层和悬浮预览。中文内容优先，数据密度适中。

## 颜色

- 主操作只使用 `{colors.primary}`，用于保存、确认、当前焦点和可点击数据下钻。
- `{colors.accent}` 只用于少量装修领域提示或品牌标记，不与主操作竞争。
- 风险、警告、成功必须使用固定语义色，并配合文字或图标。
- 页面背景使用 `{colors.canvas}`；主要内容、表单和图表使用 `{colors.surface}`；分组或禁用区域使用 `{colors.surface-soft}`。
- 深色侧栏只承载导航与服务状态，正文和数据分析保持浅色。

## 字体与密度

- 中文优先使用苹方、微软雅黑和系统字体；不要下载参考品牌专有字体。
- 页面标题 24px，区块标题 18px，正文 14px，字段标签 13px。
- 金额和核心指标使用稳定数字对齐；不要用超大字号伪造驾驶舱效果。
- 不使用负字距，不用大间距全大写英文制造装饰感。

## 布局

- 桌面侧栏宽 224px；内容区最大宽度 1480px，左右留白至少 24px。
- 4px 为基础单位，常用间距为 8、12、16、24、32px。
- 页面遵循“标题与说明 -> 筛选 -> 摘要 -> 图表/明细”的稳定顺序。
- 摘要卡在 1280px 桌面端优先保持一行；不足时自然换行，不压缩金额和状态文字。
- 主要桌面验收尺寸为 1440x900 和 1280x720；900px 以下保留现有响应式行为。

## 组件

- 导航：线性图标加文字；当前项有明确视觉状态并保留 `aria-current="page"`。
- 按钮：同一区域只保留一个高强调主按钮；危险操作必须使用危险语义并二次确认。
- 表单：标签置于控件上方；焦点使用主色边框和淡蓝焦点环；错误信息紧邻字段。
- 摘要卡：标签、数值、解释三层；可点击卡片必须是原生按钮并有明确焦点态。
- 图表面板：标题和说明位于绘图区外；颜色、图例、数值和可访问摘要共同表达含义。
- 状态标签：使用“文字 + 语义色”；AI 推断、用户确认、待复核必须视觉可区分。
- 详情抽屉：固定标题与关闭入口，内容按正式记录、来源证据、关联记录、操作记录分区。
- 空、错、加载状态：占用与最终内容相近的空间，并提供可行动说明，不伪装成成功。

## 页面行为

- 当前主导航为概览、录入、时间线、账本、问题、空间、记录分析、智能分析、搜索。
- 登录后默认进入概览；桌面端左侧分组导航，移动端折叠为顶部菜单。
- 录入区标题使用“智能拆分”；普通保存和重新进入页面不得静默触发分析。
- 候选卡展示类型、摘要、原文依据和可信程度；用户可修改类型、字段、空间、材料、参与者、阶段、商家，并可关联已有记录或本批其他候选。
- 全部未确认候选默认勾选；确认失败必须保留编辑状态并给出可行动错误。
- 图表只消费服务端聚合结果，不能在前端重算账本金额、空间继承或问题状态。
- 图表点击筛选必须与当前页面明细共用筛选口径，并提供清除筛选方式。
- 搜索和各核心视图均可打开右侧详情抽屉。

## 禁止项

- 不复制参考品牌的 Logo、专有字体、插画、吉祥物或营销构图。
- 不在组件内直接新增十六进制颜色；确实需要时先补语义令牌。
- 不使用颜色作为唯一状态信号。
- 不引入大面积渐变、霓虹、玻璃拟态、过度圆角或装饰动画。
- 不为了视觉重构改变前端业务计算、API 契约、数据结构或统计口径。
