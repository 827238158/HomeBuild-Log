const beijingFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const beijingDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatBeijingDateTime(value: string | null | undefined): string {
  if (!value) return '待补充'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间格式无效'
  return `${beijingFormatter.format(date)}（北京时间）`
}

export function formatBeijingDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  // 使用明确的北京时间日历字段，避免直接截取 UTC 字符串导致跨日错误。
  const parts = beijingDateFormatter.formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return '待补充'
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(value)
  if (!match) return '时间格式无效'
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return '时间格式无效'
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`
}

export function beijingToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
