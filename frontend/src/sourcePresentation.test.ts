import { describe, expect, it } from 'vitest'
import { presentSourceText } from './sourcePresentation'

const separator = '\n录入字段：\n'
const common = {
  title: '确认灯带款项', description: null, occurred_date: '2026-10-08',
  original_time_text: null, timezone: 'Asia/Shanghai', stage_id: null,
  topic_ids: [], space_ids: ['space-1'], material_ids: [], participant_ids: [],
  attachment_ids: [], related_record_ids: ['record-1'],
}
const ledger = {
  ...common, record_type: 'ledger', ledger_kind: 'payment', direction: 'expense',
  status: 'paid', payment_kind: '全款', amount_minor: 1540, currency: 'CNY',
  payment_date: '2026-10-08', payment_method: null, vendor_id: 'vendor-1',
}
const issue = {
  ...common, record_type: 'issue', status: 'pending', phenomenon: '请电工核对接线',
  severity: 'medium', due_date: null, discovered_at: null, responsible_party: null,
  handling_plan: '现场确认', completed_at: null, actual_result: null, resolution_kind: null,
}
function snapshot(payload: Record<string, unknown>, title = String(payload.title)): string {
  return title + separator + JSON.stringify(payload, null, 2)
}

describe('presentSourceText', () => {
  it.each([
    ['payment', 'expense', 'paid'], ['refund', 'refund', 'posted'], ['income', 'income', 'posted'],
  ])('将%s快照显示为标题和说明', (ledger_kind, direction, status) => {
    const original = snapshot({ ...ledger, ledger_kind, direction, status, description: '已核对交易凭证' })
    expect(presentSourceText(original)).toEqual({ text: '确认灯带款项\n已核对交易凭证', isGeneratedSnapshot: true, snapshotTitle: common.title })
    expect(original).toContain('"vendor_id": "vendor-1"')
  })

  it.each([null, '', '  '])('账目说明为%j时只显示标题', description => {
    expect(presentSourceText(snapshot({ ...ledger, description }))).toEqual({ text: common.title, isGeneratedSnapshot: true, snapshotTitle: common.title })
  })

  it.each([null, '', '  '])('待办说明为%j时回退事项内容', description => {
    expect(presentSourceText(snapshot({ ...issue, description }))).toEqual({ text: `${common.title}\n请电工核对接线`, isGeneratedSnapshot: true, snapshotTitle: common.title })
  })

  it('待办优先展示补充说明，不追加其他业务字段', () => {
    const result = presentSourceText(snapshot({ ...issue, description: '先和电工沟通' }))
    expect(result.text).toBe(`${common.title}\n先和电工沟通`)
    expect(result.text).not.toContain('现场确认')
  })

  it('兼容尚无截止日期字段的旧待办快照', () => {
    expect(presentSourceText(snapshot({ ...issue, due_date: undefined })).isGeneratedSnapshot).toBe(true)
  })

  it('兼容没有默认及后加字段的旧账目和待办快照', () => {
    expect(presentSourceText(snapshot({
      record_type: 'ledger', title: '旧账目', status: 'paid', ledger_kind: 'payment',
      direction: 'expense', payment_kind: '支出', amount_minor: 1540, currency: 'CNY', vendor_id: 'vendor-1',
    }))).toEqual({ text: '旧账目', isGeneratedSnapshot: true, snapshotTitle: '旧账目' })
    expect(presentSourceText(snapshot({
      record_type: 'issue', title: '旧事项', status: 'pending', phenomenon: '事项内容', severity: 'medium',
    }))).toEqual({ text: '旧事项\n事项内容', isGeneratedSnapshot: true, snapshotTitle: '旧事项' })
  })

  it.each([
    { ...ledger, description: common.title },
    { ...ledger, description: `  ${common.title}  ` },
    { ...issue, phenomenon: common.title },
    { ...issue, description: common.title, phenomenon: common.title },
  ])('去除标题和说明完全相同的重复文字', payload => {
    expect(presentSourceText(snapshot(payload)).text).toBe(common.title)
  })

  it('保留长文、换行和说明内部重复文字', () => {
    const description = `${'很长的现场说明'.repeat(300)}\n重复\n重复`
    expect(presentSourceText(snapshot({ ...ledger, description })).text).toBe(`${common.title}\n${description}`)
  })

  it('正确识别标题本身及说明中含分隔符的快照', () => {
    const title = `第一段${separator}标题后半段`
    const description = `说明${separator}说明后半段`
    expect(presentSourceText(snapshot({ ...ledger, title, description }))).toEqual({ text: `${title}\n${description}`, isGeneratedSnapshot: true, snapshotTitle: title })
  })

  it('保留标题原始空白，确保回填值是来源中的连续原文', () => {
    const title = `  现场标题${separator}标题后半段 \n`
    const original = snapshot({ ...ledger, title, description: '说明第一行\n说明第二行' })
    const result = presentSourceText(original)
    expect(result.snapshotTitle).toBe(title)
    expect(original.includes(result.snapshotTitle!)).toBe(true)
    expect(original.startsWith(result.snapshotTitle! + separator)).toBe(true)
    expect(result.text).toBe(`${title.trim()}\n说明第一行\n说明第二行`)
  })

  it.each([
    { record_type: 'event' }, { record_type: 'research' }, { title: '另一标题' },
    { description: {} }, { timezone: null }, { occurred_date: 123 },
    { space_ids: 'space-1' }, { participant_ids: [1] }, { topic_ids: null },
    { amount_minor: '1540' }, { amount_minor: 1.5 }, { amount_minor: 0 },
    { amount_minor: Number.MAX_SAFE_INTEGER + 1 }, { currency: 'USD' },
    { ledger_kind: 'refund' }, { direction: 'income' }, { status: 'done' }, { status: { toString: null } },
    { vendor_id: null }, { payment_kind: '' }, { payment_date: {} },
    { payment_method: [] }, { internal_extra: 'unknown' },
  ])('账目错误字段或非系统结构原样显示：%j', changes => {
    const original = snapshot({ ...ledger, ...changes }, common.title)
    expect(presentSourceText(original)).toEqual({ text: original, isGeneratedSnapshot: false })
  })

  it.each([
    { status: 'paid' }, { severity: 'critical' }, { severity: { toString: null } }, { phenomenon: '' },
    { due_date: 42 }, { discovered_at: {} }, { handling_plan: [] },
    { actual_result: true }, { completed_at: {} },
  ])('待办错误字段原样显示：%j', changes => {
    const original = snapshot({ ...issue, ...changes })
    expect(presentSourceText(original)).toEqual({ text: original, isGeneratedSnapshot: false })
  })

  it.each([
    '普通现场记录', '{"title":"手写 JSON","record_type":"ledger"}',
    `用户输入${separator}{"title":"用户输入","record_type":"ledger"}`,
    `${common.title}${separator}{坏JSON}`, `${common.title}${separator}null`,
    `${common.title}${separator}[]`, `${common.title}${separator}42`,
    `${common.title}${separator}${JSON.stringify(ledger)}\n附加文字`,
    `${separator}${JSON.stringify(ledger)}`, '',
  ])('普通文字、用户JSON或损坏内容不变：%s', original => {
    expect(presentSourceText(original)).toEqual({ text: original, isGeneratedSnapshot: false })
  })

  it('缺失原文返回null', () => {
    expect(presentSourceText(null)).toEqual({ text: null, isGeneratedSnapshot: false })
    expect(presentSourceText(undefined)).toEqual({ text: null, isGeneratedSnapshot: false })
  })
})
