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
  issue: { pending: '待处理' },
}

export function recordStatusLabel(recordType: string, status: string): string {
  return statusOverrides[recordType]?.[status] ?? generalStatusLabels[status] ?? '未知状态'
}

export function recordStatusDescription(recordType: string, status: string): string | null {
  if (recordType === 'decision' && status === 'pending') return '这个决定还没有最终确定。'
  if (recordType === 'issue' && status === 'pending') return '这个问题还没有开始处理。'
  return null
}

const eventKindLabels: Record<string, string> = {
  acceptance_test: '验收测试', acceptance_test_passed: '验收测试通过',
  construction: '施工', site_visit: '现场查看',
  meeting: '会议沟通', selection: '选购选品', other: '其他事件',
}

const paymentKindLabels: Record<string, string> = {
  advance: '预付款', deposit: '订金', final: '尾款',
  full: '全款', refund: '退款', reimbursement: '报销款',
  income: '收入', other: '其他款项',
}

export function eventKindLabel(kind: string): string {
  return eventKindLabels[kind] ?? kind
}

export function paymentKindLabel(kind: string): string {
  return paymentKindLabels[kind] ?? kind
}
