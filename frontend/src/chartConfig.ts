import type { EChartsCoreOption } from 'echarts/core'

import type { DistributionItem } from './domainApi'

export const chartPalette = {
  primary: '#1769c2',
  primarySoft: '#e8f2ff',
  accent: '#a4512f',
  risk: '#c93434',
  warning: '#9a650e',
  success: '#28784c',
  slate: '#667085',
  muted: '#a8b0bc',
  grid: '#e7ebef',
  text: '#1f2328',
}

export const chartCategoryColors = [
  chartPalette.primary,
  chartPalette.accent,
  chartPalette.success,
  chartPalette.warning,
  chartPalette.slate,
]

const tooltip = {
  backgroundColor: '#ffffff',
  borderColor: '#e1e6eb',
  borderWidth: 1,
  textStyle: { color: chartPalette.text },
}

export function lineOption(rows: DistributionItem[], unit = '项'): EChartsCoreOption {
  const rotate = rows.length > 8 ? 32 : 0
  return {
    color: [chartPalette.primary],
    tooltip: { ...tooltip, trigger: 'axis', valueFormatter: (value: unknown) => `${value}${unit}` },
    grid: { left: 12, right: 18, top: 26, bottom: rotate ? 54 : 28, containLabel: true },
    xAxis: {
      type: 'category', boundaryGap: false, data: rows.map((item) => item.label),
      axisLine: { lineStyle: { color: '#cfd6de' } }, axisTick: { show: false },
      axisLabel: { color: '#667085', rotate, hideOverlap: true },
    },
    yAxis: {
      type: 'value', minInterval: unit === '项' ? 1 : undefined,
      axisLabel: { color: '#667085' }, axisLine: { show: true, lineStyle: { color: '#cfd6de' } },
      splitLine: { lineStyle: { color: chartPalette.grid } },
    },
    series: [{
      type: 'line', smooth: rows.length >= 4, symbol: 'circle', symbolSize: 7,
      // 保留原始标识供点击事件使用，避免用本地化月份文案构造查询条件。
      data: rows.map((item) => ({ key: item.key, value: item.value })), lineStyle: { width: 3 },
      itemStyle: { color: chartPalette.primary },
      areaStyle: { color: 'rgba(23, 105, 194, 0.08)' },
      label: { show: rows.length <= 8, position: 'top', color: chartPalette.text, formatter: `{c}${unit}` },
    }],
  }
}

export function horizontalBarOption(
  rows: DistributionItem[],
  unit = '项',
  preserveOrder = false,
  showTooltip = true,
  itemColors?: Record<string, string>,
): EChartsCoreOption {
  const ordered = preserveOrder ? rows : [...rows].sort((a, b) => a.value - b.value)
  return {
    color: [chartPalette.primary],
    tooltip: showTooltip
      ? { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: unknown) => `${value}${unit}` }
      : { show: false, showContent: false },
    grid: { left: 12, right: 54, top: 12, bottom: 20, containLabel: true },
    xAxis: {
      type: 'value', minInterval: unit === '项' ? 1 : undefined,
      axisLabel: { color: '#667085' }, axisLine: { show: true, lineStyle: { color: '#cfd6de' } },
      splitLine: { lineStyle: { color: chartPalette.grid } },
    },
    yAxis: {
      type: 'category', data: ordered.map((item) => item.label),
      axisLabel: { color: chartPalette.text, width: 120, overflow: 'truncate' },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [{
      type: 'bar', barMaxWidth: 24,
      data: ordered.map((item) => {
        const override = itemColors?.[item.key]
        return {
          value: item.value, key: item.key, name: item.label,
          ...(override ? { itemStyle: { color: override, borderRadius: [0, 4, 4, 0] } } : {}),
        }
      }),
      itemStyle: { color: chartPalette.primary, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', color: chartPalette.text, formatter: `{c}${unit}` },
      emphasis: { itemStyle: { color: chartPalette.accent } },
    }],
  }
}

export function compactChartValue(value: number, unit = '项') {
  const absolute = Math.abs(value)
  const compact = (divisor: number, suffix: string) => {
    const scaled = value / divisor
    const scaledAbsolute = Math.abs(scaled)
    const decimals = scaledAbsolute >= 100 ? 0 : scaledAbsolute >= 10 ? 1 : 2
    const factor = 10 ** decimals
    // 中心文案只做紧凑展示，截断可避免 9999.99 万被四舍五入为 10000 万。
    const truncated = Math.trunc(scaled * factor) / factor
    return `${truncated}${suffix}${unit}`
  }
  if (absolute >= 100_000_000) return compact(100_000_000, '亿')
  if (absolute >= 10_000) return compact(10_000, '万')
  return `${new Intl.NumberFormat('zh-CN', { useGrouping: false, maximumFractionDigits: 2 }).format(value)}${unit}`
}

export function donutOption(rows: DistributionItem[], unit = '项', showTooltip = true): EChartsCoreOption {
  const total = rows.reduce((sum, item) => sum + item.value, 0)
  const centerText = compactChartValue(total, unit)
  const centerFontSize = centerText.length <= 6 ? 22 : centerText.length <= 8 ? 18 : 15
  return {
    color: chartCategoryColors,
    tooltip: showTooltip
      ? { ...tooltip, trigger: 'item', valueFormatter: (value: unknown) => `${value}${unit}` }
      : { show: false, showContent: false },
    legend: { bottom: 0, type: 'scroll', textStyle: { color: '#667085' }, icon: 'circle' },
    graphic: [{
      type: 'text', left: 'center', top: '40%',
      style: { text: centerText, fill: chartPalette.text, fontSize: centerFontSize, fontWeight: 700, textAlign: 'center' },
    }],
    series: [{
      type: 'pie', radius: ['48%', '70%'], center: ['50%', '43%'],
      avoidLabelOverlap: true,
      data: rows.map((item, index) => ({
        value: item.value, name: item.label, key: item.key,
        itemStyle: { color: chartCategoryColors[index % chartCategoryColors.length], borderColor: '#ffffff', borderWidth: 3 },
      })),
      label: { show: rows.length <= 5, formatter: `{b}\n{c}${unit}`, color: chartPalette.text },
      labelLine: { length: 10, length2: 8 },
      emphasis: { scaleSize: 5 },
    }],
  }
}

export function chartSummary(title: string, rows: DistributionItem[], unit = '项') {
  return rows.length
    ? `${title}：${rows.map((item) => `${item.label}${item.value}${unit}`).join('，')}。`
    : `${title}：暂无数据。`
}
