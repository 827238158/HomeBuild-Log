import { describe, expect, it } from 'vitest'

import { formatBeijingDateTime, formatCalendarDate } from './time'

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
})
