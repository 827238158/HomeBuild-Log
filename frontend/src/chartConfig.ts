import type { EChartsCoreOption } from 'echarts/core'

import type { DistributionItem } from './domainApi'

export const chartPalette = {
  primary: '#315b70',
  primarySoft: '#dce9ee',
  accent: '#b6633f',
  risk: '#b64b4b',
  warning: '#c28a35',
  success: '#4f7d67',
  slate: '#71808a',
  muted: '#a9b2b7',
  grid: '#e5e9eb',
  text: '#24323a',
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
  borderColor: '#dce2e5',
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
      axisLine: { lineStyle: { color: '#b8c2c7' } }, axisTick: { show: false },
      axisLabel: { color: '#687780', rotate, hideOverlap: true },
    },
    yAxis: {
      type: 'value', minInterval: unit === '项' ? 1 : undefined,
      axisLabel: { color: '#687780' }, axisLine: { show: true, lineStyle: { color: '#b8c2c7' } },
      splitLine: { lineStyle: { color: chartPalette.grid } },
    },
    series: [{
      type: 'line', smooth: rows.length >= 4, symbol: 'circle', symbolSize: 7,
      data: rows.map((item) => item.value), lineStyle: { width: 3 },
      itemStyle: { color: chartPalette.primary },
      areaStyle: { color: 'rgba(49, 91, 112, 0.10)' },
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
      axisLabel: { color: '#687780' }, axisLine: { show: true, lineStyle: { color: '#b8c2c7' } },
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

export function donutOption(rows: DistributionItem[], unit = '项', showTooltip = true): EChartsCoreOption {
  const total = rows.reduce((sum, item) => sum + item.value, 0)
  return {
    color: chartCategoryColors,
    tooltip: showTooltip
      ? { ...tooltip, trigger: 'item', valueFormatter: (value: unknown) => `${value}${unit}` }
      : { show: false, showContent: false },
    legend: { bottom: 0, type: 'scroll', textStyle: { color: '#5f6d75' }, icon: 'circle' },
    graphic: [{
      type: 'text', left: 'center', top: '40%',
      style: { text: `${total}${unit}`, fill: chartPalette.text, fontSize: 22, fontWeight: 700, textAlign: 'center' },
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
