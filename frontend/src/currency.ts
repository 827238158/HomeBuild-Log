/** 人民币金额格式化与元/分转换工具，避免在组件中重复实现。 */

const rmbFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
})

const yuanFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 将“分”为单位的金额格式化为人民币字符串；空值按 0 处理。 */
export function formatMoney(minor: number | undefined | null): string {
  return rmbFormatter.format((minor ?? 0) / 100)
}

/** 将“分”为单位的金额格式化为“元”数值字符串（不含 ¥ 符号）。 */
export function formatYuan(minor: number | undefined | null): string {
  return yuanFormatter.format((minor ?? 0) / 100)
}

/** 将用户输入的“元”字符串转换为“分”；无效输入返回 null。 */
export function parseYuanToMinor(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}
