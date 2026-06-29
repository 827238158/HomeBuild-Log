const generalStatusLabels: Record<string, string> = {
  planned: '计划中', occurred: '已发生', completed: '已完成', cancelled: '已取消',
  posted: '已入账', voided: '已作废', open: '待处理', in_progress: '处理中',
  waiting: '等待中', resolved: '已解决', closed: '已关闭', active: '当前有效',
  superseded: '已替代', pending: '待处理', confirmed: '已确认', ordered: '已下单',
  partially_paid: '部分付款', paid: '已付款', delivery_pending: '待送货',
  delivered: '已送达', returned: '已退货', collecting: '收集中', comparing: '比较中',
  concluded: '已有结论', archived: '已归档', done: '已完成',
}

const statusOverrides: Record<string, Record<string, string>> = {
  decision: { pending: '待确认' },
  todo: { pending: '待处理' },
}

export function recordStatusLabel(recordType: string, status: string): string {
  return statusOverrides[recordType]?.[status] ?? generalStatusLabels[status] ?? '未知状态'
}

export function recordStatusDescription(recordType: string, status: string): string | null {
  if (recordType === 'decision' && status === 'pending') return '这个决定还没有最终确定。'
  if (recordType === 'todo' && status === 'pending') return '这项待办还没有开始处理。'
  return null
}
