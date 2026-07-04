import { describe, expect, it } from 'vitest'
import { formatMoney, formatYuan, parseYuanToMinor } from './currency'

describe('currency', () => {
  it('将分格式化为人民币字符串', () => {
    expect(formatMoney(110000)).toBe('¥1,100.00')
    expect(formatMoney(0)).toBe('¥0.00')
    expect(formatMoney(undefined)).toBe('¥0.00')
    expect(formatMoney(null)).toBe('¥0.00')
  })

  it('将分格式化为元字符串', () => {
    expect(formatYuan(50000)).toBe('500.00')
  })

  it('将元字符串转换为分，无效输入返回 null', () => {
    expect(parseYuanToMinor('123.45')).toBe(12345)
    expect(parseYuanToMinor('')).toBeNull()
    expect(parseYuanToMinor('abc')).toBeNull()
  })
})
