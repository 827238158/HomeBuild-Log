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
  listRecords: vi.fn(),
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
  EChart: ({ summary, title, kind, onDataHover, onDataLeave, onDataClick, scrollableContentHeight, scrollableMaxHeight }: {
    summary: string
    title: string
    kind: string
    onDataHover?: (event: { key: string; clientX: number; clientY: number; anchorRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } }) => void
    onDataLeave?: () => void
    onDataClick?: (key: string) => void
    scrollableContentHeight?: number
    scrollableMaxHeight?: number
  }) => {
    const key = title === '主要商家金额' ? '砖世界'
      : title === '记录类型分布' ? 'issue'
        : title === '资金构成' ? 'expense' : 'paid'
    return <figure data-chart-kind={kind} data-scroll-content-height={scrollableContentHeight} data-scroll-max-height={scrollableMaxHeight}><h3>{title}</h3>{summary}<button type="button" aria-label={`${title}测试数据项`} onMouseEnter={() => onDataHover?.({ key, clientX: 100, clientY: 100, anchorRect: { left: 96, top: 96, right: 104, bottom: 104, width: 8, height: 8 } })} onMouseLeave={onDataLeave} onClick={() => onDataClick?.(key)}>数据项</button></figure>
  },
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
  vi.unstubAllGlobals()
  vi.mocked(api.listSpaces).mockResolvedValue([])
  vi.mocked(api.listRecords).mockResolvedValue([record])
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
      expense_minor: 50000, refund_minor: 10000, income_minor: 0, net_expense_minor: 40000,
    },
    ledger_entries: [],
    analytics: {
      money_trend: [],
      payment_composition: [
        { key: 'expense', label: '付款', value: 50000 },
        { key: 'refund', label: '退款', value: 10000 },
        { key: 'income', label: '收入', value: 0 },
      ],
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

  it('记录详情统一展示相关记录标题', async () => {
    const procurement = { ...record, id: 'procurement-1', record_type: 'procurement', title: '花砖采购' }
    vi.mocked(api.listRelations).mockResolvedValue([{
      id: 'relation-1', from_record_id: record.id, to_record_id: procurement.id, relation_type: 'relates_to',
    }])
    vi.mocked(api.getRecord).mockImplementation(async (id) => id === procurement.id ? procurement : record)

    render(<CoreViews><p>录入工作台</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    fireEvent.click(await screen.findByRole('button', { name: /现场查看/ }))

    expect(await screen.findByText('花砖采购')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '相关记录' })).toBeTruthy()
  })

  it('账本明确展示付款、退款、收入和净支出', async () => {
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '账本' }))

    expect(await screen.findByText('¥500.00')).toBeTruthy()
    expect(screen.getByText('¥400.00')).toBeTruthy()
    expect(screen.getByText('¥100.00')).toBeTruthy()
    expect(screen.getAllByText(/付款总额/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/净支出/).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/待付/)).toBeNull()
  })

  it('账本用每月净支出趋势替换逐笔资金流水卡片', async () => {
    vi.mocked(api.getLedgerSummary).mockResolvedValueOnce({
      totals: { expense_minor: 90000, refund_minor: 10000, income_minor: 5000, net_expense_minor: 75000 },
      ledger_entries: [{ ...record, id: 'ledger-trend', record_type: 'ledger', title: '不应显示的流水卡片', ledger_kind: 'payment', direction: 'expense', status: 'paid', amount_minor: 90000 }],
      analytics: {
        money_trend: [
          { key: '2026-05', label: '2026年5月', expense_minor: 50000, refund_minor: 10000, income_minor: 0 },
          { key: '2026-06', label: '2026年6月', expense_minor: 40000, refund_minor: 0, income_minor: 5000 },
        ],
        payment_composition: [], vendor_distribution: [],
      },
    })
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '账本' }))

    expect(await screen.findByRole('heading', { name: '每月净支出趋势' })).toBeTruthy()
    expect(screen.getByText(/2026年5月400元/)).toBeTruthy()
    expect(screen.getByText(/2026年6月350元/)).toBeTruthy()
    expect(screen.queryByText('不应显示的流水卡片')).toBeNull()
    expect(screen.queryByRole('heading', { name: '资金流水' })).toBeNull()
  })

  it('主要商家超过八项后启用共享图表纵向滚动参数', async () => {
    vi.mocked(api.getLedgerSummary).mockResolvedValueOnce({
      totals: { expense_minor: 90000, refund_minor: 0, income_minor: 0, net_expense_minor: 90000 },
      ledger_entries: [],
      analytics: {
        money_trend: [], payment_composition: [],
        vendor_distribution: Array.from({ length: 9 }, (_, index) => ({ key: `商家${index + 1}`, label: `商家${index + 1}`, value: 10000 })),
      },
    })
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '账本' }))

    const chart = (await screen.findByRole('heading', { name: '主要商家金额' })).closest('figure')!
    expect(chart.getAttribute('data-scroll-content-height')).toBe('378')
    expect(chart.getAttribute('data-scroll-max-height')).toBe('360')
  })

  it('账本完整明细栏可渲染并打开长列表中的记录', async () => {
    const ledgerEntries = Array.from({ length: 24 }, (_, index) => ({
      ...record,
      id: `ledger-long-${index + 1}`,
      record_type: 'ledger',
      ledger_kind: 'payment',
      direction: 'expense' as const,
      status: 'paid',
      title: index === 23
        ? '超长标题的第二十四条装修付款记录用于验证卡片换行和排版'
        : `装修付款记录 ${index + 1}`,
      amount_minor: 10000,
    }))
    vi.mocked(api.getLedgerSummary).mockResolvedValueOnce({
      totals: { expense_minor: 240000, refund_minor: 0, income_minor: 0, net_expense_minor: 240000 },
      ledger_entries: ledgerEntries,
      analytics: {
        money_trend: [],
        payment_composition: [{ key: 'expense', label: '付款', value: 240000 }],
        vendor_distribution: [],
      },
    })

    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '账本' }))
    fireEvent.click(await screen.findByRole('button', { name: /付款总额/ }))

    const dialog = await screen.findByRole('dialog', { name: '付款总额' })
    const records = dialog.querySelectorAll('.ledger-detail-record')
    expect(records).toHaveLength(24)
    const lastRecord = within(dialog).getByRole('button', { name: /超长标题的第二十四条/ })
    expect(lastRecord.textContent).toContain('验证卡片换行和排版')
    fireEvent.click(lastRecord)
    await waitFor(() => expect(api.getRecord).toHaveBeenCalledWith('ledger-long-24'))
  })

  it('时间线按十条分批展示并可继续加载和回到顶部', async () => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      ...record,
      id: `event-${index + 1}`,
      title: `时间线记录 ${index + 1}`,
    }))
    vi.mocked(api.getTimeline).mockResolvedValueOnce({
      total: 12,
      groups: [{
        date_key: '2026-06', label: '2026年6月',
        items: records.map((item) => ({ record: item, related_records: [] })),
      }],
      analytics: { ...analytics, total: 12 },
    })
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))

    expect(await screen.findByText('时间线记录 10')).toBeTruthy()
    expect(screen.queryByText('时间线记录 11')).toBeNull()
    const timelineList = document.querySelector('.timeline-list') as HTMLDivElement
    const scrollIntoView = vi.fn()
    timelineList.scrollIntoView = scrollIntoView
    const scrollYSpy = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(200)
    const rectSpy = vi.spyOn(timelineList, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: -100, left: 0, top: -100, right: 800, bottom: 600,
      width: 800, height: 700, toJSON: () => ({}),
    })
    fireEvent.click(screen.getByRole('button', { name: '查看更多' }))
    expect(await screen.findByText('时间线记录 12')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '查看更多' })).toBeNull()
    fireEvent.scroll(window)
    const backToTop = await screen.findByRole('button', { name: '回到顶部' })
    fireEvent.click(backToTop)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    scrollYSpy.mockRestore()
    rectSpy.mockRestore()
  })

  it('点击记录类型分布后立即筛选时间线，取消后恢复全部记录', async () => {
    const issueRecord = {
      ...record,
      id: 'issue-timeline-1',
      record_type: 'issue',
      title: '筛选后的施工问题',
      status: 'open',
    }
    const allTimeline = {
      total: 1,
      groups: [{ date_key: '2026-06', label: '2026年6月', items: [{ record, related_records: [] }] }],
      analytics: { ...analytics, type_distribution: [{ key: 'issue', label: '施工问题', value: 1 }] },
    }
    const filteredTimeline = {
      total: 1,
      groups: [{ date_key: '2026-06', label: '2026年6月', items: [{ record: issueRecord, related_records: [] }] }],
      analytics: { ...analytics, type_distribution: [{ key: 'issue', label: '施工问题', value: 1 }] },
    }
    vi.mocked(api.getTimeline)
      .mockResolvedValueOnce(allTimeline)
      .mockResolvedValueOnce(filteredTimeline)
      .mockResolvedValueOnce(allTimeline)

    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))

    expect(await screen.findByText('现场查看')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '记录类型分布测试数据项' }))

    expect(await screen.findByText('筛选后的施工问题')).toBeTruthy()
    expect(screen.queryByText('现场查看')).toBeNull()
    await waitFor(() => expect(api.getTimeline).toHaveBeenLastCalledWith(expect.objectContaining({ record_type: 'issue' })))

    fireEvent.click(screen.getByRole('button', { name: '当前按记录类型筛选，点击取消' }))
    expect(await screen.findByText('现场查看')).toBeTruthy()
    expect(screen.queryByText('筛选后的施工问题')).toBeNull()
    await waitFor(() => expect(api.getTimeline).toHaveBeenLastCalledWith(expect.objectContaining({ record_type: '' })))
  })

  it('账本统计卡片悬停预览并可进入完整明细', async () => {
    const domRect = (left: number, top: number, width: number, height: number) => ({
      left, top, right: left + width, bottom: top + height, width, height, x: left, y: top,
      toJSON: () => ({}),
    } as DOMRect)
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('ledger-detail-preview')) return domRect(0, 0, 300, 200)
      if (this.textContent?.includes('付款总额')) return domRect(100, 100, 200, 80)
      if (this.textContent?.includes('退款总额')) return domRect(650, 700, 200, 60)
      return domRect(0, 0, 0, 0)
    })
    const ledger = {
      ...record, id: 'ledger-1', record_type: 'ledger', ledger_kind: 'payment', title: '瓷砖付款', status: 'paid',
      direction: 'expense' as const, amount_minor: 50000, vendor: { id: 'vendor-1', name: '砖世界' },
    }
    vi.mocked(api.getLedgerSummary).mockResolvedValueOnce({
      totals: {
        expense_minor: 50000, refund_minor: 0, income_minor: 0, net_expense_minor: 50000,
      },
      ledger_entries: [ledger],
      analytics: {
        money_trend: [],
        payment_composition: [{ key: 'expense', label: '付款', value: 50000 }, { key: 'refund', label: '退款', value: 0 }, { key: 'income', label: '收入', value: 0 }],
        vendor_distribution: [{ key: '砖世界', label: '砖世界', value: 50000 }],
      },
    })
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '账本' }))

    const paymentCard = await screen.findByRole('button', { name: /付款总额/ })
    fireEvent.mouseEnter(paymentCard)
    const preview = await screen.findByLabelText('付款总额明细预览')
    expect(within(preview).getByText('共 1 条记录')).toBeTruthy()
    expect(within(preview).getByText('瓷砖付款')).toBeTruthy()
    expect(preview.parentElement).toBe(document.body)
    expect(preview.getAttribute('data-placement')).toBe('bottom-start')
    expect(preview.getAttribute('style')).toContain('--preview-left: 100px')
    expect(preview.getAttribute('style')).toContain('--preview-top: 188px')

    fireEvent.mouseEnter(screen.getByText('退款总额').closest('button')!)
    const flippedPreview = await screen.findByLabelText('退款总额明细预览')
    expect(flippedPreview.getAttribute('data-placement')).toBe('top-start')
    expect(flippedPreview.getAttribute('style')).toContain('--preview-top: 492px')

    fireEvent.mouseEnter(paymentCard)
    const returnedPreview = await screen.findByLabelText('付款总额明细预览')
    fireEvent.click(within(returnedPreview).getByRole('button', { name: '查看全部明细' }))
    const dialog = await screen.findByRole('dialog', { name: '付款总额' })
    expect(dialog.parentElement).toBe(document.body)
    expect(screen.getByRole('button', { name: '点击遮罩关闭明细' }).parentElement).toBe(document.body)
    expect(within(dialog).getByText('1 条记录')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /瓷砖付款/ }))
    await waitFor(() => expect(api.getRecord).toHaveBeenCalledWith('ledger-1'))
    fireEvent.click(await screen.findByRole('button', { name: '关闭详情' }))
    expect(await screen.findByRole('dialog', { name: '付款总额' })).toBeTruthy()
    rectSpy.mockRestore()
  })

  it('账本图表悬停展示对应摘要且点击打开完整明细', async () => {
    const ledger = {
      ...record, id: 'ledger-1', record_type: 'ledger', ledger_kind: 'payment', title: '商家付款', status: 'paid',
      direction: 'expense' as const, amount_minor: 50000, vendor: { id: 'vendor-1', name: '砖世界' },
    }
    vi.mocked(api.getLedgerSummary).mockResolvedValueOnce({
      totals: {
        expense_minor: 50000, refund_minor: 0, income_minor: 0, net_expense_minor: 50000,
      },
      ledger_entries: [ledger],
      analytics: {
        money_trend: [], payment_composition: [{ key: 'expense', label: '付款', value: 50000 }, { key: 'refund', label: '退款', value: 0 }, { key: 'income', label: '收入', value: 0 }],
        vendor_distribution: [{ key: '砖世界', label: '砖世界', value: 50000 }],
      },
    })
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '账本' }))

    const vendorBar = await screen.findByRole('button', { name: '主要商家金额测试数据项' })
    fireEvent.mouseEnter(vendorBar)
    const preview = await screen.findByLabelText('砖世界明细预览')
    expect(within(preview).getByText('占比：100.0%')).toBeTruthy()
    expect(within(preview).getByText('商家付款')).toBeTruthy()
    fireEvent.click(vendorBar)
    expect(await screen.findByRole('dialog', { name: '砖世界' })).toBeTruthy()
  })

  it('移动端点击统计卡片直接打开底部明细而不显示 hover 预览', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true, media: '(hover: none)', addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }))
    const ledger = {
      ...record, id: 'ledger-mobile', record_type: 'ledger', ledger_kind: 'payment', title: '移动端付款', status: 'paid',
      direction: 'expense' as const, amount_minor: 50000, vendor: { id: 'vendor-1', name: '砖世界' },
    }
    vi.mocked(api.getLedgerSummary).mockResolvedValueOnce({
      totals: {
        expense_minor: 50000, refund_minor: 0, income_minor: 0, net_expense_minor: 50000,
      },
      ledger_entries: [ledger],
      analytics: {
        money_trend: [], payment_composition: [{ key: 'expense', label: '付款', value: 50000 }, { key: 'refund', label: '退款', value: 0 }, { key: 'income', label: '收入', value: 0 }],
        vendor_distribution: [{ key: '砖世界', label: '砖世界', value: 50000 }],
      },
    })
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '账本' }))
    const card = await screen.findByRole('button', { name: /净支出/ })
    fireEvent.mouseEnter(card)
    expect(screen.queryByLabelText('净支出明细预览')).toBeNull()
    fireEvent.click(card)
    expect((await screen.findByRole('dialog', { name: '净支出' })).className).toContain('ledger-detail-panel')
    fireEvent.click(screen.getByRole('button', { name: '关闭明细' }))
    fireEvent.click(screen.getByRole('button', { name: '资金构成测试数据项' }))
    expect(await screen.findByRole('dialog', { name: '付款' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭明细' }))
    fireEvent.click(screen.getByRole('button', { name: '主要商家金额测试数据项' }))
    expect(await screen.findByRole('dialog', { name: '砖世界' })).toBeTruthy()
  })

  it('问题状态更新只提交问题记录类型和新状态', async () => {
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '问题' }))
    const statusSelect = await screen.findByLabelText('处理状态')
    expect(document.querySelector('.issue-page-header .issue-filter-bar')).toBeTruthy()
    fireEvent.change(statusSelect, { target: { value: 'waiting' } })

    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith(
      'issue-1', { record_type: 'issue', status: 'waiting' },
    ))
    const columns = document.querySelectorAll('.issue-column')
    expect(columns).toHaveLength(5)
    columns.forEach((column) => expect(column.querySelector('.issue-column__body')).toBeTruthy())
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
    fireEvent.click(screen.getByLabelText('主卧'))
    fireEvent.click(screen.getByLabelText('次卧'))
    expect(within(spaces).getByRole('button', { name: '主卧、次卧' })).toBeTruthy()
    // 已选项只保留在输入框摘要中，通过下拉选项取消选择。
    fireEvent.click(screen.getByLabelText('次卧'))
    const participants = within(detail).getByRole('group', { name: '参与者' })
    fireEvent.click(within(participants).getByText('请选择（可多选）'))
    fireEvent.click(screen.getByLabelText('张师傅'))
    fireEvent.click(screen.getByLabelText('李师傅'))
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
