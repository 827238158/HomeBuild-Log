import type { ProjectionRecord } from './domainApi'
import { formatMoney } from './currency'
import { eventKindLabel, paymentKindLabel } from './recordLabels'
import { measurementRoleLabels, normalizeMeasurementRole } from './recordFields'
import { formatBeijingDateTime } from './time'

function text(value: unknown, fallback = '待补充'): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function RecordFacts({ record }: { record: ProjectionRecord }) {
  const rows: Array<[string, string]> = []
  if (record.record_type === 'ledger') {
    rows.push(['金额', typeof record.amount_minor === 'number' ? formatMoney(record.amount_minor) : '待补充'])
    rows.push(['账目类型', ({ expense: '付款', refund: '退款', income: '收入' } as Record<string, string>)[String(record.direction)] ?? ({ payment: '付款', refund: '退款', income: '收入' } as Record<string, string>)[String(record.ledger_kind)] ?? '待补充'])
    rows.push(['款项性质', paymentKindLabel(text(record.payment_kind))], ['交易对象', record.vendor?.name ?? '未指定'])
  } else if (record.record_type === 'measurement') {
    rows.push(['尺寸对象', text(record.object_name)], ['尺寸用途', measurementRoleLabels[normalizeMeasurementRole(record.measurement_role)]])
    // 保留原始轴名、数值和单位，不把读取视图的尺寸重算为其他口径。
    const values = Array.isArray(record.values) ? record.values : []
    for (const item of values) {
      if (!item || typeof item !== 'object') continue
      const value = item as Record<string, unknown>
      const axis = String(value.axis ?? '')
      rows.push([({ width: '宽度', height: '高度', length: '长度', depth: '深度', diameter: '直径', area: '面积' } as Record<string, string>)[axis] ?? (axis || '尺寸'), value.value === null || value.value === undefined ? '待补充' : `${String(value.value)} ${String(value.unit ?? '')}`.trim()])
    }
    if (!values.length) rows.push(['尺寸数值', '待补充'])
    rows.push(['数值口径', record.approximate === true ? '近似值／粗测' : '未标记为近似值'])
    rows.push(['误差与参照说明', text(record.tolerance_text)], ['测量方法', text(record.method)])
    rows.push(['测量时间', typeof record.measured_at === 'string' && record.measured_at ? formatBeijingDateTime(record.measured_at) : '未记录'])
  } else if (record.record_type === 'decision') {
    rows.push(['决策事项', text(record.topic)], ['备选方案', Array.isArray(record.options) ? record.options.map(String).join('、') || '待补充' : text(record.options)], ['当前选择', text(record.selected_option, '尚未确定')])
  } else if (record.record_type === 'event') {
    rows.push(['事件类别', eventKindLabel(text(record.event_kind))], ['事件结果', text(record.result)])
  } else if (record.record_type === 'issue') {
    rows.push(['问题现象', text(record.phenomenon)], ['处理计划', text(record.handling_plan)], ['约定日期', text(record.promised_date, '未约定')])
  } else if (record.record_type === 'research') {
    rows.push(['调研问题', text(record.question)])
  }
  return <dl className="detail-list record-core-facts">{rows.map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
