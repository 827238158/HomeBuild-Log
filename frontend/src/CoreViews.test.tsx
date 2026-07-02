import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from './domainApi'
import { CoreViews } from './CoreViews'
import type { ProjectionRecord } from './domainApi'

vi.mock('./domainApi', () => ({
  getOverview: vi.fn(),
  getRecordsAnalytics: vi.fn(),
  getAiAnalyticsOverview: vi.fn(),
  getAiAnalyticsRuns: vi.fn(),
  getTimeline: vi.fn(),
  getLedgerSummary: vi.fn(),
  getIssueBoard: vi.fn(),
  getSpaceArchive: vi.fn(),
  searchRecords: vi.fn(),
  listSpaces: vi.fn(),
  listEntities: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  getRecord: vi.fn(),
  getSource: vi.fn(),
  listRelations: vi.fn(),
  listRecordAudit: vi.fn(),
  reviewRecordSource: vi.fn(),
}))
vi.mock('./EChart', () => ({
  EChart: ({ summary, title, kind }: { summary: string; title: string; kind: string }) => <figure data-chart-kind={kind}><h3>{title}</h3>{summary}</figure>,
}))

const analytics = {
  total: 1, unknown_date_count: 0,
  status_distribution: [{ key: 'occurred', label: '已发生', value: 1 }],
  type_distribution: [{ key: 'event', label: '事件', value: 1 }],
  time_trend: [{ key: '2026-06', label: '2026年6月', value: 1 }],
}

const record: ProjectionRecord = {
  id: 'event-1',
  record_type: 'event',
  title: '现场查看',
  status: 'occurred',
  description: null,
  archived_at: null,
  source_refs: [{
    source_id: 'source-1', evidence_excerpt: '现场查看', source_revision: 1, needs_review: false,
  }],
  occurred_date: '2026-06-28',
  original_time_text: '6月27日',
  created_at: '2026-06-28T10:00:00+08:00',
  space_ids: [],
  spaces: [],
  material_ids: [],
  materials: [],
  participant_ids: [],
  participants: [],
  attachment_ids: [],
}

beforeEach(() => {
  vi.mocked(api.listSpaces).mockResolvedValue([])
  vi.mocked(api.listEntities).mockResolvedValue([])
  vi.mocked(api.getOverview).mockResolvedValue({
    as_of_date: '2026-07-01', horizon_date: '2026-07-08',
    summary: { open_issue_count: 0, overdue_count: 0, upcoming_count: 0 },
    open_issues: [], overdue: [], upcoming: [], recent_records: [record], stage_distribution: [],
  })
  vi.mocked(api.getRecordsAnalytics).mockResolvedValue({
    summary: analytics, specific: {}, records: [record],
  })
  vi.mocked(api.getAiAnalyticsOverview).mockResolvedValue({
    range: '30d',
    summary: {
      request_count: 1, success_rate: 1, fallback_rate: 0,
      average_duration_ms: 20, p95_duration_ms: 20, total_tokens: 30, token_request_count: 1,
    },
    trend: [{ key: '2026-07-01', label: '07月01日', requests: 1, successes: 1, fallbacks: 0, average_duration_ms: 20, total_tokens: 30 }],
    engine_distribution: [{ key: 'local-rule-v1', label: '本地规则', value: 1 }],
    error_distribution: [],
  })
  vi.mocked(api.getAiAnalyticsRuns).mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
  vi.mocked(api.getTimeline).mockResolvedValue({
    total: 1,
    groups: [{ date_key: '2026-06', label: '2026年6月', items: [{ record, related_records: [] }] }],
    analytics,
  })
  vi.mocked(api.getLedgerSummary).mockResolvedValue({
    totals: {
      procurement_total_minor: 110000, expense_minor: 50000,
      refund_minor: 0, income_minor: 0, net_paid_minor: 50000, outstanding_minor: 60000,
      overpaid_minor: 0, unallocated_expense_minor: 0, unallocated_refund_minor: 0,
      unallocated_income_minor: 0,
    },
    procurements: [], ledger_entries: [], warnings: [],
    analytics: {
      money_trend: [],
      payment_composition: [{ key: 'paid', label: '净付款', value: 2000000 }],
      vendor_distribution: [],
    },
  })
  vi.mocked(api.getIssueBoard).mockResolvedValue({
    total: 1,
    columns: [
      { status: 'open', label: '发现', items: [{ ...record, id: 'issue-1', record_type: 'issue', title: '地砖破裂', status: 'open', phenomenon: '小破裂' }] },
      { status: 'in_progress', label: '处理中', items: [] },
      { status: 'waiting', label: '等待', items: [] },
      { status: 'resolved', label: '已解决', items: [] },
      { status: 'closed', label: '已关闭', items: [] },
    ],
    analytics: {
      status_distribution: [{ key: 'open', label: '待处理', value: 1 }],
      space_distribution: [], severity_distribution: [],
    },
  })
  vi.mocked(api.updateRecord).mockResolvedValue({ ...record, record_type: 'issue', status: 'waiting' })
  vi.mocked(api.deleteRecord).mockResolvedValue(undefined)
  vi.mocked(api.searchRecords).mockResolvedValue({
    query: '现场', counts: { sources: 1, records: 1, materials: 0, vendors: 0, spaces: 0 },
    groups: {
      sources: [{ id: 'source-1', original_text: '现场查看', captured_at: '2026-06-28T10:00:00+08:00' }],
      records: [record], materials: [], vendors: [], spaces: [],
    },
    limit: 20, offset: 0,
  })
  vi.mocked(api.getRecord).mockResolvedValue(record)
  vi.mocked(api.listRelations).mockResolvedValue([])
  vi.mocked(api.listRecordAudit).mockResolvedValue([])
  vi.mocked(api.getSource).mockResolvedValue({
    id: 'source-1', project_id: 'project-1', input_type: 'text', original_text: '现场查看',
    captured_at: '2026-06-28T10:00:00+08:00', reported_time_text: null,
    updated_at: '2026-06-28T10:00:00+08:00', revision: 1, attachments: [],
  })
})

describe('CoreViews', () => {
  it('概览阶段分布同时展示图表和阶段明细', async () => {
    vi.mocked(api.getOverview).mockResolvedValueOnce({
      as_of_date: '2026-07-01', horizon_date: '2026-07-08',
      summary: { open_issue_count: 0, overdue_count: 0, upcoming_count: 0 },
      open_issues: [], overdue: [], upcoming: [], recent_records: [],
      stage_distribution: [
        { key: 'demolition', label: '拆改', value: 2 },
        { key: 'tiling', label: '瓦工', value: 1 },
      ],
    })
    const { container } = render(<CoreViews><p>录入</p></CoreViews>)

    expect(await screen.findByRole('heading', { name: '阶段明细' })).toBeTruthy()
    expect(container.querySelector('.overview-stage-panel')).toBeTruthy()
    expect(screen.getByText('共 3 项')).toBeTruthy()
    expect(screen.getByText('66.7%')).toBeTruthy()
    expect(screen.getByText('33.3%')).toBeTruthy()
  })

  it('使用分组侧栏导航并可展开移动端导航', async () => {
    const { container } = render(<CoreViews><p>录入工作台</p></CoreViews>)
    expect(screen.getByRole('heading', { name: '工作台' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '业务管理' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '数据分析' })).toBeTruthy()
    const menu = screen.getByRole('button', { name: '打开导航' })
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(menu)
    expect(menu.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.workspace-sidebar.is-open')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭导航' }))
    expect(menu.getAttribute('aria-expanded')).toBe('false')
  })

  it('时间趋势使用折线图，类型构成使用环形图', async () => {
    const { container } = render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    await screen.findByRole('heading', { name: '装修时间线' })
    expect(container.querySelector('[data-chart-kind="line"]')).toBeTruthy()
    expect(container.querySelector('[data-chart-kind="donut"]')).toBeTruthy()
  })

  it('在录入与时间线之间导航，并能打开可追溯详情', async () => {
    render(<CoreViews><p>录入工作台</p></CoreViews>)
    expect(await screen.findByText('装修概览')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '录入' }))
    expect(screen.getByText('录入工作台')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    expect(await screen.findByText('装修时间线')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /现场查看/ }))

    expect(await screen.findByRole('heading', { name: '记录详情' })).toBeTruthy()
    expect(screen.getByText('原始来源与附件')).toBeTruthy()
    expect(api.getSource).toHaveBeenCalledWith('source-1')
  })

  it('记录详情使用中文关系名称', async () => {
    const procurement = { ...record, id: 'procurement-1', record_type: 'procurement', title: '花砖采购' }
    vi.mocked(api.listRelations).mockResolvedValue([{
      id: 'relation-1', from_record_id: record.id, to_record_id: procurement.id, relation_type: 'produces',
    }])
    vi.mocked(api.getRecord).mockImplementation(async (id) => id === procurement.id ? procurement : record)

    render(<CoreViews><p>录入工作台</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    fireEvent.click(await screen.findByRole('button', { name: /现场查看/ }))

    expect(await screen.findByText('产生 · 花砖采购')).toBeTruthy()
    expect(screen.queryByText(/produces/)).toBeNull()
  })

  it('账本明确展示采购、支出和待付', async () => {
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '账本' }))

    expect(await screen.findByText('¥1,100.00')).toBeTruthy()
    expect(screen.getByText('¥500.00')).toBeTruthy()
    expect(screen.getByText('¥600.00')).toBeTruthy()
    expect(screen.getByText(/净付款20000元/)).toBeTruthy()
    expect(screen.queryByText(/净付款2000000项/)).toBeNull()
  })

  it('问题状态更新只提交问题记录类型和新状态', async () => {
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '问题' }))
    const statusSelect = await screen.findByLabelText('处理状态')
    fireEvent.change(statusSelect, { target: { value: 'waiting' } })

    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith(
      'issue-1', { record_type: 'issue', status: 'waiting' },
    ))
  })

  it('基础搜索返回正式记录和原始来源', async () => {
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.change(screen.getByPlaceholderText('例如：花砖、主卧、门套'), {
      target: { value: '现场' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: '搜索' }).at(-1)!)

    expect(await screen.findByText('正式记录 · 1')).toBeTruthy()
    expect(screen.getByText('原始来源 · 1')).toBeTruthy()
    expect(api.searchRecords).toHaveBeenCalledWith(expect.objectContaining({ q: '现场' }))
  })

  it('记录分析和智能分析使用中文导航与摘要', async () => {
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '记录分析' }))
    expect(await screen.findByRole('heading', { name: '记录分析' })).toBeTruthy()
    expect(screen.getByText('符合条件的记录')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '智能分析' }))
    expect(await screen.findByRole('heading', { name: '智能分析' })).toBeTruthy()
    expect(screen.getByText('分析请求')).toBeTruthy()
    expect(screen.getByText('已使用 token')).toBeTruthy()
    expect(screen.getByText('P95 耗时')).toBeTruthy()
    expect(screen.queryByText('succeeded')).toBeNull()
  })

  it('记录详情可修改状态、日期、空间和参与者', async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([
      { id: 'room-1', name: '主卧', kind: 'room', parent_id: null },
      { id: 'room-2', name: '次卧', kind: 'room', parent_id: null },
    ])
    vi.mocked(api.listEntities).mockImplementation(async (type) => type === 'participants'
      ? [{ id: 'person-1', name: '张师傅' }, { id: 'person-2', name: '李师傅' }]
      : [])
    vi.mocked(api.updateRecord).mockResolvedValue({ ...record, status: 'completed' })
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    fireEvent.click(await screen.findByRole('button', { name: /现场查看/ }))
    const detail = await screen.findByLabelText('记录详情')
    const updateCallsBeforeEdit = vi.mocked(api.updateRecord).mock.calls.length
    fireEvent.click(within(detail).getByRole('button', { name: '修改记录' }))
    expect(within(detail).queryByRole('button', { name: '关闭详情' })).toBeNull()
    expect(within(detail).queryByRole('button', { name: '删除记录' })).toBeNull()
    expect(within(detail).queryByText('原始来源与附件')).toBeNull()
    fireEvent.click(within(detail).getByRole('button', { name: '取消' }))
    expect(within(detail).getByRole('button', { name: '关闭详情' })).toBeTruthy()
    expect(within(detail).getByText('原始来源与附件')).toBeTruthy()
    expect(vi.mocked(api.updateRecord).mock.calls).toHaveLength(updateCallsBeforeEdit)

    fireEvent.click(within(detail).getByRole('button', { name: '修改记录' }))
    fireEvent.change(within(detail).getByLabelText('状态'), { target: { value: 'completed' } })
    fireEvent.change(within(detail).getByLabelText('发生日期'), { target: { value: '2026-07-01' } })
    const spaces = within(detail).getByRole('group', { name: '空间' })
    fireEvent.click(within(spaces).getByText('请选择（可多选）'))
    fireEvent.click(within(spaces).getByLabelText('主卧'))
    fireEvent.click(within(spaces).getByLabelText('次卧'))
    fireEvent.click(within(spaces).getByRole('button', { name: '移除空间：次卧' }))
    const participants = within(detail).getByRole('group', { name: '参与者' })
    fireEvent.click(within(participants).getByText('请选择（可多选）'))
    fireEvent.click(within(participants).getByLabelText('张师傅'))
    fireEvent.click(within(participants).getByLabelText('李师傅'))
    fireEvent.click(within(detail).getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith('event-1', expect.objectContaining({
      record_type: 'event', status: 'completed', occurred_date: '2026-07-01',
      space_ids: ['room-1'], participant_ids: ['person-1', 'person-2'],
    })))
    expect(vi.mocked(api.updateRecord).mock.calls.at(-1)?.[1]).not.toHaveProperty('source_refs')
    await waitFor(() => expect(within(detail).getByRole('button', { name: '关闭详情' })).toBeTruthy())
  })

  it('记录修改失败时停留在编辑界面', async () => {
    vi.mocked(api.updateRecord).mockRejectedValueOnce(new Error('保存失败测试'))
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    fireEvent.click(await screen.findByRole('button', { name: /现场查看/ }))
    const detail = await screen.findByLabelText('记录详情')
    fireEvent.click(within(detail).getByRole('button', { name: '修改记录' }))
    fireEvent.click(within(detail).getByRole('button', { name: '保存修改' }))

    expect((await within(detail).findByRole('alert')).textContent).toContain('保存失败测试')
    expect(within(detail).getByRole('button', { name: '保存修改' })).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: '关闭详情' })).toBeNull()
  })

  it('记录详情二次确认后删除记录', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    fireEvent.click(await screen.findByRole('button', { name: /现场查看/ }))
    const detail = await screen.findByLabelText('记录详情')
    fireEvent.click(within(detail).getByRole('button', { name: '删除记录' }))
    await waitFor(() => expect(api.deleteRecord).toHaveBeenCalledWith('event-1'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('原始来源和审计历史会保留'))
    confirm.mockRestore()
  })
})
