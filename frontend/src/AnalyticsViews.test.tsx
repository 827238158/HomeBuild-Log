import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './domainApi'
import { AiAnalyticsView, OverviewView, RecordsAnalyticsView } from './AnalyticsViews'

vi.mock('./domainApi', () => ({ getOverview: vi.fn(), getRecordsAnalytics: vi.fn(), getAiAnalyticsOverview: vi.fn(), getAiAnalyticsRuns: vi.fn(), listSpaces: vi.fn(), listEntities: vi.fn() }))
vi.mock('./LazyEChart', () => ({ LazyEChart: ({ title }: { title: string }) => <div>{title}</div> }))
vi.mock('./Select', () => ({ Select: ({ children, value, onChange }: { children: React.ReactNode; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement> }) => <select value={value} onChange={onChange}>{children}</select> }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const records = (total: number): api.RecordsAnalyticsResponse => ({ summary: { total, unknown_date_count: 0, status_distribution: [{ key: 'pending', label: '待处理', value: total }], type_distribution: [], time_trend: [] }, specific: {}, records: [] })
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
    fireEvent.change(screen.getByLabelText('记录状态'), { target: { value: 'pending' } })
    await waitFor(() => expect(api.getRecordsAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ record_type: 'issue', status: 'pending' })))
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await waitFor(() => expect(api.getRecordsAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ record_type: '', status: '' })))
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
