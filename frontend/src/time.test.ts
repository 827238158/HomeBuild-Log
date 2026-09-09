import { describe, expect, it } from 'vitest'

import { formatBeijingDate, formatBeijingDateTime, formatCalendarDate, monthDateRange } from './time'

describe('月份筛选范围', () => {
  it.each([
    ['2024-02', '2024-02-29'], ['2026-02', '2026-02-28'],
    ['2100-02', '2100-02-28'], ['2000-02', '2000-02-29'],
    ['2025-12', '2025-12-31'], ['2026-01', '2026-01-31'], ['2026-04', '2026-04-30'],
  ])('%s 使用真实公历月底', (month, lastDay) => {
    expect(monthDateRange(month)).toEqual({ date_from: `${month}-01`, date_to: lastDay })
  })
  it('拒绝展示标签和无效月份', () => {
    expect(() => monthDateRange('2026年6月')).toThrow('月份格式无效')
    expect(() => monthDateRange('2026-13')).toThrow('月份格式无效')
  })
})

describe('北京时间展示', () => {
  it('把 UTC 时间稳定转换为 Asia/Shanghai', () => {
    const formatted = formatBeijingDateTime('2026-06-30T00:00:00+00:00')
    expect(formatted).toContain('2026/06/30')
    expect(formatted).toContain('08:00:00')
    expect(formatted).toContain('北京时间')
  })

  it('未知发生时间显示中文待补充', () => {
    expect(formatCalendarDate(null)).toBe('待补充')
    expect(formatCalendarDate('2026-06-28')).toBe('2026年6月28日')
  })

  it('把跨日 UTC 时间转换为北京时间日期并忽略无效值', () => {
    expect(formatBeijingDate('2026-06-30T18:00:00+00:00')).toBe('2026-07-01')
    expect(formatBeijingDate('无效时间')).toBe('')
    expect(formatBeijingDate(null)).toBe('')
  })
})
