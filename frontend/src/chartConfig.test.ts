import { describe, expect, it } from 'vitest'

import { chartSummary, compactChartValue, donutOption, lineOption, withChartSelection } from './chartConfig'

describe('withChartSelection', () => {
  it('高亮保留数据数值、原始颜色及输入配置，清除后恢复原图', () => {
    const option = donutOption([{ key: 'a', label: '甲', value: 12 }, { key: 'b', label: '乙', value: 7 }])
    const snapshot = JSON.stringify(option)
    const selected = withChartSelection(option, 'a')
    expect(selected.series).toMatchObject([{ data: [
      { key: 'a', value: 12, itemStyle: { color: '#1769c2', opacity: 1, borderWidth: 2 } },
      { key: 'b', value: 7, itemStyle: { color: '#a4512f', opacity: 0.3 } },
    ] }])
    expect(JSON.stringify(option)).toEqual(snapshot)
    expect(withChartSelection(option, '')).toBe(option)
    expect(withChartSelection(option, 'missing')).toBe(option)
  })
})

describe('lineOption', () => {
  it('月份显示文案与点击使用的原始标识分离，跨年仍可准确定位', () => {
    const option = lineOption([
      { key: '2023-12', label: '2023年12月', value: 2 },
      { key: '2024-02', label: '2024年2月', value: 3 },
    ])
    expect(option.xAxis).toMatchObject({ data: ['2023年12月', '2024年2月'] })
    expect(option.series).toMatchObject([{ data: [
      { key: '2023-12', value: 2 },
      { key: '2024-02', value: 3 },
    ] }])
  })
})

describe('donutOption', () => {
  it('中心数值按万和亿紧凑展示，同时保留精确的无障碍摘要', () => {
    expect(compactChartValue(123_456.78, '元')).toBe('12.3万元')
    expect(compactChartValue(123_456_789, '元')).toBe('1.23亿元')

    const rows = [{ key: 'expense', label: '付款', value: 123_456_789 }]
    const option = donutOption(rows, '元')
    expect(option.graphic).toMatchObject([{
      style: { text: '1.23亿元', fontSize: 22 },
    }])
    expect(chartSummary('资金构成', rows, '元')).toContain('付款123456789元')
  })

  it('未达到一万的较长数值缩小中心字号', () => {
    const option = donutOption([{ key: 'total', label: '总计', value: 9999.99 }], '元')
    expect(option.graphic).toMatchObject([{
      style: { text: '9999.99元', fontSize: 18 },
    }])
  })
})
