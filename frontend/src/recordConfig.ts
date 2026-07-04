export const recordConfig = {
  event: { label: '事件', statuses: ['planned', 'occurred', 'completed', 'cancelled'] },
  ledger: { label: '账目', statuses: ['planned', 'paid', 'posted', 'voided'] },
  issue: { label: '问题', statuses: ['pending', 'in_progress', 'done'] },
  measurement: { label: '尺寸', statuses: ['active', 'superseded', 'cancelled'] },
  decision: { label: '决策', statuses: ['pending', 'confirmed', 'cancelled'] },
  research: { label: '调研', statuses: ['collecting', 'comparing', 'concluded', 'archived'] },
} as const

export type RecordType = keyof typeof recordConfig

export function statusesForRecordType(recordType: string): readonly string[] {
  if (recordType in recordConfig) return recordConfig[recordType as RecordType].statuses
  // 未限定类型时为全局搜索提供去重后的完整状态集合。
  return [...new Set(Object.values(recordConfig).flatMap((config) => [...config.statuses]))]
}

export function statusesForRecord(recordType: RecordType, ledgerKind?: string): readonly string[] {
  if (recordType !== 'ledger') return recordConfig[recordType].statuses
  return ledgerKind === 'payment'
    ? ['planned', 'paid', 'voided']
    : ['planned', 'posted', 'voided']
}

export function completedStatusForLedgerKind(ledgerKind: string): 'paid' | 'posted' {
  return ledgerKind === 'payment' ? 'paid' : 'posted'
}
