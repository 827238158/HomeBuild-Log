import { describe, expect, it } from 'vitest'

import { lineOption } from './chartConfig'

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
