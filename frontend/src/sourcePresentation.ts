export interface SourcePresentation {
  text: string | null
  isGeneratedSnapshot: boolean
  snapshotTitle?: string
}

const snapshotSeparator = '\n录入字段：\n'
const associationKeys = ['topic_ids', 'space_ids', 'material_ids', 'participant_ids', 'attachment_ids', 'related_record_ids'] as const
const commonKeys = ['title', 'description', 'occurred_date', 'original_time_text', 'timezone', 'stage_id', 'record_type', 'status', ...associationKeys]
const ledgerKeys = ['ledger_kind', 'direction', 'payment_kind', 'amount_minor', 'currency', 'payment_date', 'payment_method', 'vendor_id']
const issueKeys = ['due_date', 'discovered_at', 'phenomenon', 'severity', 'responsible_party', 'handling_plan', 'completed_at', 'actual_result', 'resolution_kind']

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isNullableString(value)
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isDate(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function isGeneratedPayload(payload: Record<string, unknown>, title: string): boolean {
  if (payload.title !== title || !isNonemptyString(payload.title)
    || !isOptionalString(payload.description)
    || (payload.timezone !== undefined && !isNonemptyString(payload.timezone))
    || !isDate(payload.occurred_date) || !isOptionalString(payload.original_time_text)
    || !isOptionalString(payload.stage_id)) return false

  // 旧快照可能缺少后加的默认字段；已有字段仍严格校验，避免误识别普通用户 JSON。
  if (!associationKeys.every(key => payload[key] === undefined || (Array.isArray(payload[key])
    && payload[key].every(item => isNonemptyString(item))))) return false

  if (payload.record_type === 'ledger') {
    if (Object.keys(payload).some(key => !commonKeys.includes(key) && !ledgerKeys.includes(key))) return false
    const kind = payload.ledger_kind
    if (kind !== 'payment' && kind !== 'refund' && kind !== 'income') return false
    const completedStatus = kind === 'payment' ? 'paid' : 'posted'
    return payload.direction === (kind === 'payment' ? 'expense' : kind)
      && typeof payload.status === 'string' && ['planned', 'voided', completedStatus].includes(payload.status)
      && typeof payload.amount_minor === 'number' && Number.isSafeInteger(payload.amount_minor)
      && payload.amount_minor > 0 && payload.currency === 'CNY'
      && isNonemptyString(payload.vendor_id) && isNonemptyString(payload.payment_kind)
      && isDate(payload.payment_date) && isOptionalString(payload.payment_method)
  }

  if (payload.record_type === 'issue') {
    if (Object.keys(payload).some(key => !commonKeys.includes(key) && !issueKeys.includes(key))) return false
    return typeof payload.status === 'string' && ['pending', 'in_progress', 'done'].includes(payload.status)
      && typeof payload.severity === 'string' && ['low', 'medium', 'high'].includes(payload.severity)
      && isNonemptyString(payload.phenomenon)
      && isDate(payload.due_date) && isDate(payload.completed_at)
      && isOptionalString(payload.discovered_at)
      && ['responsible_party', 'handling_plan', 'actual_result', 'resolution_kind']
        .every(key => isOptionalString(payload[key]))
  }
  return false
}

/** 仅为阅读生成摘要；来源原文仍由原有编辑、证据校验和保存流程使用。 */
export function presentSourceText(originalText: string | null | undefined): SourcePresentation {
  const unchanged: SourcePresentation = { text: originalText ?? null, isGeneratedSnapshot: false }
  if (!originalText) return unchanged
  // 标题本身可以含有分隔文字；JSON 字符串中的换行会被转义，最后一个分隔符才是正文边界。
  const separatorAt = originalText.lastIndexOf(snapshotSeparator)
  if (separatorAt <= 0) return unchanged
  const title = originalText.slice(0, separatorAt)
  let payload: unknown
  try {
    payload = JSON.parse(originalText.slice(separatorAt + snapshotSeparator.length))
  } catch {
    return unchanged
  }
  if (!isObject(payload) || !isGeneratedPayload(payload, title)) return unchanged
  const description = typeof payload.description === 'string' ? payload.description.trim() : ''
  const explanation = description || (payload.record_type === 'issue' ? String(payload.phenomenon).trim() : '')
  const parts = [title.trim(), explanation].filter(Boolean)
  // 证据回填必须使用原始标题，不能使用已裁剪或拼接后的阅读摘要。
  return { text: [...new Set(parts)].join('\n'), isGeneratedSnapshot: true, snapshotTitle: title }
}
