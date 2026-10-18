import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './domainApi'
import { AiAnalyticsView, OverviewView, RecordsAnalyticsView } from './AnalyticsViews'

vi.mock('./domainApi', () => ({ getOverview: vi.fn(), getRecordsAnalytics: vi.fn(), getAiAnalyticsOverview: vi.fn(), getAiAnalyticsRuns: vi.fn(), listSpaces: vi.fn(), listEntities: vi.fn() }))
vi.mock('./LazyEChart', () => ({ LazyEChart: ({ title, selectedKey, onDataClick }: { title: string; selectedKey?: string; onDataClick?: (key: string) => void }) => <figure><h3>{title}</h3>{onDataClick && <button aria-label={`${title}测试数据项`} onClick={() => onDataClick(selectedKey === 'pending' ? '' : 'pending')}>数据项</button>}{selectedKey && <button aria-label={`清除${title}筛选`} onClick={() => onDataClick?.('')}>×</button>}</figure> }))
vi.mock('./Select', () => ({ Select: ({ children, value, onChange }: { children: React.ReactNode; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement> }) => <select value={value} onChange={onChange}>{children}</select> }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const records = (total: number): api.RecordsAnalyticsResponse => ({ summary: { total, unknown_date_count: 0, status_distribution: [{ key: 'pending', label: '待处理', value: total }], type_distribution: [], time_trend: [] }, specific: {}, records: [] })
const recordsWithCards = (count: number): api.RecordsAnalyticsResponse => ({
  ...records(count),
  records: Array.from({ length: count }, (_, index) => ({
    id: `record-${index}`, record_type: 'event', title: `记录 ${index + 1}`, status: 'confirmed',
    description: null, archived_at: null, source_refs: [], occurred_date: null, original_time_text: null,
    created_at: '2026-10-17T00:00:00Z', space_ids: [], spaces: [], material_ids: [], materials: [],
    participant_ids: [], participants: [], attachment_ids: [],
  })),
})
const overview = (count: number): api.OverviewResponse => ({ as_of_date: '2026-10-04', horizon_date: '2026-10-11', summary: { open_issue_count: count, overdue_count: 0, upcoming_count: 0 }, open_issues: [], overdue: [], upcoming: [], recent_records: [], stage_distribution: [] })
const aiOverview = (count: number): api.AiAnalyticsOverview => ({ range: '30d', summary: { request_count: count, success_rate: 1, fallback_rate: 0, average_duration_ms: 1, p95_duration_ms: 1, total_tokens: 1, token_request_count: 1 }, trend: [], engine_distribution: [], error_distribution: [] })

describe('分析查询保护', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.listSpaces).mockResolvedValue([])
    vi.mocked(api.listEntities).mockResolvedValue([])
    vi.mocked(api.getAiAnalyticsRuns).mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
  })

  it('记录类型切换忽略迟到响应，状态可以键盘筛选，清除恢复全部类型', async () => {
    const old = deferred<api.RecordsAnalyticsResponse>()
    vi.mocked(api.getRecordsAnalytics).mockReturnValueOnce(old.promise).mockResolvedValue(records(222))
    render(<RecordsAnalyticsView onOpen={vi.fn()} refreshRevision={0} />)
    fireEvent.click(screen.getByRole('tab', { name: '待办与问题' }))
    await screen.findByText('222')
    await act(async () => old.resolve(records(111)))
    expect(screen.queryByText('111')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.change(screen.getByLabelText('记录状态'), { target: { value: 'pending' } })
    await waitFor(() => expect(api.getRecordsAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ record_type: 'issue', status: 'pending' })))
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await waitFor(() => expect(api.getRecordsAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ record_type: '', status: '' })))
  })

  it('默认收起条件但保留类型标签，收起与重新展开不丢条件也不重新查询', async () => {
    vi.mocked(api.getRecordsAnalytics).mockResolvedValue(records(2))
    render(<RecordsAnalyticsView onOpen={vi.fn()} refreshRevision={0} />)
    await screen.findByText('2')
    const toggle = screen.getByRole('button', { name: '筛选' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('combobox', { name: '记录状态' })).toBeNull()
    expect(screen.getByRole('tablist', { name: '记录类型' })).toBeTruthy()
    const initialCalls = vi.mocked(api.getRecordsAnalytics).mock.calls.length
    fireEvent.click(toggle)
    expect(screen.getByRole('combobox', { name: '记录状态' })).toBeTruthy()
    expect(api.getRecordsAnalytics).toHaveBeenCalledTimes(initialCalls)
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-18' } })
    await waitFor(() => expect(api.getRecordsAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ date_from: '2026-10-01', date_to: '2026-10-18' })))
    const filteredCalls = vi.mocked(api.getRecordsAnalytics).mock.calls.length
    fireEvent.click(toggle)
    expect(screen.queryByRole('combobox', { name: '记录状态' })).toBeNull()
    expect(toggle.textContent).toContain('2')
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeTruthy()
    fireEvent.click(toggle)
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('2026-10-01')
    expect((screen.getByLabelText('结束日期') as HTMLInputElement).value).toBe('2026-10-18')
    expect(api.getRecordsAnalytics).toHaveBeenCalledTimes(filteredCalls)
  })

  it('类型不计入折叠条件，图表设置状态后在收起区外仍可清除全部筛选', async () => {
    vi.mocked(api.getRecordsAnalytics).mockImplementation(async filters => records(filters?.status ? 0 : 2))
    render(<RecordsAnalyticsView onOpen={vi.fn()} refreshRevision={0} />)
    await screen.findByText('2')
    fireEvent.click(screen.getByRole('tab', { name: '待办与问题' }))
    await waitFor(() => expect(api.getRecordsAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ record_type: 'issue' })))
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: '状态分布测试数据项' }))
    await screen.findByRole('button', { name: '清除状态分布筛选' })
    expect(screen.getByRole('button', { name: '筛选' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('combobox', { name: '记录状态' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await waitFor(() => expect(api.getRecordsAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ record_type: '', status: '', space_id: '', stage_id: '', date_from: '', date_to: '' })))
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull()
    expect(screen.getByRole('tab', { name: '全部' }).getAttribute('aria-selected')).toBe('true')
  })

  it('分析更新时隐藏旧指标，失败后可重试', async () => {
    vi.mocked(api.getRecordsAnalytics).mockResolvedValueOnce(records(111)).mockRejectedValueOnce(new Error('网络暂不可用')).mockResolvedValue(records(222))
    render(<RecordsAnalyticsView onOpen={vi.fn()} refreshRevision={0} />)
    await screen.findByText('111')
    fireEvent.click(screen.getByRole('tab', { name: '账目' }))
    expect(screen.queryByText('111')).toBeNull()
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByText('222')
  })

  it('标签请求期间保留统计和图表外壳，只隐藏旧值并保留滚动位置', async () => {
    const next = deferred<api.RecordsAnalyticsResponse>()
    vi.mocked(api.getRecordsAnalytics).mockResolvedValueOnce(records(111)).mockReturnValueOnce(next.promise)
    const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')
    try {
      const view = render(<RecordsAnalyticsView onOpen={vi.fn()} refreshRevision={0} />)
      await screen.findByText('111')
      const panel = view.container.querySelector<HTMLElement>('.view-panel')!
      const metric = view.container.querySelector('.summary-card')!
      const chart = view.container.querySelector('.chart-grid figure')!
      vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ top: -200 } as DOMRect)
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 400 })
      fireEvent.click(screen.getByRole('tab', { name: '账目' }))
      expect(screen.queryByText('111')).toBeNull()
      expect(view.container.querySelector('.summary-card')).toBe(metric)
      expect(view.container.querySelector('.chart-grid figure')).toBe(chart)
      expect(view.container.querySelector('.records-analytics-value-placeholder')).toBeTruthy()
      expect(view.container.querySelector('.records-analytics-content')?.getAttribute('aria-busy')).toBe('true')
      expect(panel.style.minHeight).not.toBe('')
      await act(async () => next.resolve(records(2)))
      expect(screen.getByText('2')).toBeTruthy()
      expect(view.container.querySelector('.summary-card')).toBe(metric)
      expect(view.container.querySelector('.chart-grid figure')).toBe(chart)
      expect(view.container.querySelector('.records-analytics-value-placeholder')).toBeNull()
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
      fireEvent.scroll(window)
      expect(panel.style.minHeight).toBe('')
    } finally {
      if (originalScrollY) Object.defineProperty(window, 'scrollY', originalScrollY)
    }
  })

  it('连续切换只接收最后结果，旧响应迟到时外壳保持到空态落定', async () => {
    const stale = deferred<api.RecordsAnalyticsResponse>()
    const latest = deferred<api.RecordsAnalyticsResponse>()
    vi.mocked(api.getRecordsAnalytics)
      .mockResolvedValueOnce(records(111))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise)
    const view = render(<RecordsAnalyticsView onOpen={vi.fn()} refreshRevision={0} />)
    await screen.findByText('111')
    fireEvent.click(screen.getByRole('tab', { name: '待办与问题' }))
    fireEvent.click(screen.getByRole('tab', { name: '账目' }))
    await act(async () => stale.resolve(records(222)))
    expect(screen.queryByText('111')).toBeNull()
    expect(screen.queryByText('222')).toBeNull()
    expect(view.container.querySelector('.records-analytics-dashboard')).toBeTruthy()
    expect(view.container.querySelector('.records-analytics-value-placeholder')).toBeTruthy()
    await act(async () => latest.resolve(records(0)))
    expect(view.container.querySelector('.records-analytics-dashboard')).toBeNull()
    expect(view.container.querySelector('.records-analytics-content')?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByText('录入并确认正式记录后，可按类型、空间和阶段查看趋势。')).toBeTruthy()
  })

  it('对应记录每次追加一批，切换标签后从首批重新显示', async () => {
    vi.mocked(api.getRecordsAnalytics).mockResolvedValueOnce(recordsWithCards(23)).mockResolvedValueOnce(recordsWithCards(16))
    const view = render(<RecordsAnalyticsView onOpen={vi.fn()} refreshRevision={0} />)
    await screen.findByText('记录 9')
    const visibleCards = () => view.container.querySelectorAll('.records-analytics-records .projection-card')
    expect(visibleCards()).toHaveLength(9)
    fireEvent.click(screen.getByRole('button', { name: /展开更多/ }))
    expect(visibleCards()).toHaveLength(18)
    fireEvent.click(screen.getByRole('button', { name: /展开更多/ }))
    expect(visibleCards()).toHaveLength(23)
    expect(screen.queryByRole('button', { name: /展开更多/ })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '账目' }))
    await waitFor(() => expect(visibleCards()).toHaveLength(9))
    expect(screen.getByRole('button', { name: /展开更多/ })).toBeTruthy()
  })

  it('键盘切换只滚动标签栏并避免页面焦点滚动', async () => {
    vi.mocked(api.getRecordsAnalytics).mockResolvedValue(records(1))
    render(<RecordsAnalyticsView onOpen={vi.fn()} refreshRevision={0} />)
    const tablist = screen.getByRole('tablist', { name: '记录类型' })
    const tabs = screen.getAllByRole('tab')
    const last = tabs[tabs.length - 1]
    Object.defineProperty(tablist, 'clientWidth', { configurable: true, value: 300 })
    Object.defineProperty(last, 'offsetLeft', { configurable: true, value: 600 })
    Object.defineProperty(last, 'offsetWidth', { configurable: true, value: 100 })
    const focus = vi.spyOn(last, 'focus')
    tabs[0].focus()
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(tablist.scrollLeft).toBe(404)
    expect(last.getAttribute('aria-selected')).toBe('true')
  })

  it('状态筛选返回空结果仍保留图表清除入口，清除只恢复状态维度', async () => {
    vi.mocked(api.getRecordsAnalytics).mockImplementation(async filters => records(filters?.status ? 0 : 2))
    render(<RecordsAnalyticsView onOpen={vi.fn()} refreshRevision={0} />)
    fireEvent.click(screen.getByRole('tab', { name: '待办与问题' }))
    fireEvent.click(await screen.findByRole('button', { name: '状态分布测试数据项' }))
    const clear = await screen.findByRole('button', { name: '清除状态分布筛选' })
    expect(screen.getByRole('heading', { name: '状态分布' })).toBeTruthy()
    expect(screen.queryByText('当前按状态筛选，点击取消')).toBeNull()
    fireEvent.click(clear)
    await waitFor(() => expect(api.getRecordsAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ record_type: 'issue', status: '' })))
  })

  it('AI范围切换忽略旧统计', async () => {
    const old = deferred<api.AiAnalyticsOverview>()
    vi.mocked(api.getAiAnalyticsOverview).mockReturnValueOnce(old.promise).mockResolvedValue(aiOverview(222))
    render(<AiAnalyticsView />)
    fireEvent.change(screen.getByLabelText('统计范围'), { target: { value: '7d' } })
    await screen.findByText('222')
    await act(async () => old.resolve(aiOverview(111)))
    expect(screen.queryByText('111')).toBeNull()
  })

  it('概览刷新忽略旧结果，失败显示重试', async () => {
    const old = deferred<api.OverviewResponse>()
    vi.mocked(api.getOverview).mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('概览网络错误')).mockResolvedValue(overview(222))
    const view = render(<OverviewView onOpen={vi.fn()} refreshRevision={0} />)
    view.rerender(<OverviewView onOpen={vi.fn()} refreshRevision={1} />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByText('222')
    await act(async () => old.resolve(overview(111)))
    expect(screen.queryByText('111')).toBeNull()
  })
})
