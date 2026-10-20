import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Select } from './Select'
import { FilterDisclosure } from './FilterDisclosure'
import { LazyEChart as EChart } from './LazyEChart'
import { chartCategoryColors, chartSummary, donutOption, horizontalBarOption, lineOption } from './chartConfig'
import {
  getAiAnalyticsOverview,
  getAiAnalyticsRuns,
  getOverview,
  getRecordsAnalytics,
  listEntities,
  listSpaces,
  type AiAnalyticsOverview,
  type AiAnalyticsRunsResponse,
  type NamedEntity,
  type OverviewResponse,
  type ProjectionRecord,
  type RecordsAnalyticsResponse,
  type SpaceEntry,
} from './domainApi'
import { recordStatusLabel, recordTypeLabels } from './recordLabels'
import { formatBeijingDateTime, formatCalendarDate } from './time'
import { preserveFilterViewport } from './filterViewport'

const types = Object.entries(recordTypeLabels)

function useSlidingTabIndicator(activeValue: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({})
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const update = () => {
      const activeTab = ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (!activeTab) return
      setStyle({
        '--tab-indicator-left': `${activeTab.offsetLeft}px`,
        '--tab-indicator-width': `${activeTab.offsetWidth}px`,
      } as CSSProperties)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (ref.current) {
      observer?.observe(ref.current)
      ref.current.querySelectorAll<HTMLElement>('[role="tab"]').forEach(tab => observer?.observe(tab))
    }
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [activeValue])
  useEffect(() => {
    // 首次测量先直接定位滑块，下一帧才允许移动动画。
    const frame = window.requestAnimationFrame(() => setReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])
  return { ref, style, ready }
}

function handleTablistKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const currentIndex = tabs.indexOf(event.target as HTMLButtonElement)
  if (currentIndex < 0 || tabs.length === 0) return
  event.preventDefault()
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[nextIndex].focus({ preventScroll: true })
  // 键盘切换只滚动标签容器自身，避免焦点将整页带离当前阅读位置。
  const tablist = event.currentTarget
  const left = tabs[nextIndex].offsetLeft
  const right = left + tabs[nextIndex].offsetWidth
  if (left < tablist.scrollLeft + 4) tablist.scrollLeft = Math.max(0, left - 4)
  else if (right > tablist.scrollLeft + tablist.clientWidth - 4) tablist.scrollLeft = right - tablist.clientWidth + 4
  tabs[nextIndex].click()
}

const ANALYTICS_RECORD_BATCH = 9

function AnalyticsMetric({ label, value, pending, resultKey, tone = '' }: { label: string; value: number; pending: boolean; resultKey: string; tone?: string }) {
  return <article className={`summary-card ${tone}`}>
    <span>{label}</span>
    <strong>{pending ? <i className="records-analytics-value-placeholder" aria-hidden="true" /> : <span key={resultKey} className="records-analytics-value">{value}</span>}</strong>
  </article>
}

function loadMessage(loading: boolean, error: string, empty: boolean, hint: string, retry: () => void) {
  if (loading) return <p className="view-state" role="status">正在加载分析…</p>
  if (error) return <p className="view-state view-state--error" role="alert">{error} <button type="button" onClick={retry}>重新加载</button></p>
  if (empty) return <div className="empty-guidance"><strong>暂时没有可分析的数据</strong><p>{hint}</p></div>
  return null
}

function RecordCard({ record, onOpen }: { record: ProjectionRecord; onOpen: (id: string) => void }) {
  return <button type="button" className="projection-card immersive-tilt immersive-glass" onClick={() => onOpen(record.id)}>
    <span className="record-type-tag">{recordTypeLabels[record.record_type]}</span>
    <strong>{record.title}</strong>
    <span>{recordStatusLabel(record.record_type, record.status, record.ledger_kind)}</span>
    <small>{formatCalendarDate(record.occurred_date)}</small>
  </button>
}

export function OverviewView({ onOpen, refreshRevision }: { onOpen: (id: string) => void; refreshRevision: number }) {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    // 导航与刷新之后，旧请求不能覆盖当前概览。
    getOverview().then((result) => { if (active) setData(result) }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '概览加载失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refreshRevision, retry])
  const stageTotal = data?.stage_distribution.reduce((sum, item) => sum + item.value, 0) ?? 0
  return <section className="view-panel"><header><h2>装修概览</h2></header>
    {loadMessage(loading, error, !loading && !data, '先记下一条装修记录。', () => setRetry(value => value + 1))}
    {!loading && !error && data && <>
      <div className="summary-grid overview-summary">
        <article className="summary-card summary-card--risk"><span>未关闭问题</span><strong>{data.summary.open_issue_count}</strong></article>
        <article className="summary-card summary-card--warning"><span>已逾期事项</span><strong>{data.summary.overdue_count}</strong></article>
        <article className="summary-card summary-card--info"><span>未来7天事项（含今天）</span><strong>{data.summary.upcoming_count}</strong></article>
      </div>
      {data.stage_distribution.length > 0 && <section className="overview-stage-panel"><EChart title="阶段事项分布" description="" kind="donut" option={donutOption(data.stage_distribution)} summary={chartSummary('阶段事项分布', data.stage_distribution)} /><aside><header><h3>阶段明细</h3><span>共 {stageTotal} 项</span></header><div className="stage-breakdown">{data.stage_distribution.map((item, index) => <div key={item.key}><span className="stage-breakdown__dot" style={{ backgroundColor: chartCategoryColors[index % chartCategoryColors.length] }} /><strong>{item.label}</strong><span>{item.value} 项</span><em>{stageTotal ? `${Math.round((item.value / stageTotal) * 1000) / 10}%` : '0%'}</em></div>)}</div></aside></section>}
      {(data.overdue.length > 0 || data.upcoming.length > 0) && <section className="projection-section"><h3>近期需要行动</h3><div className="card-grid">{[...data.overdue, ...data.upcoming].map((record) => <RecordCard key={record.id} record={record} onOpen={onOpen} />)}</div></section>}
      {data.open_issues.length > 0 && <section className="projection-section"><h3>未关闭问题</h3><div className="card-grid">{data.open_issues.map((record) => <RecordCard key={record.id} record={record} onOpen={onOpen} />)}</div></section>}
      {data.recent_records.length > 0 ? <section className="projection-section"><h3>最近动态</h3><div className="card-grid">{data.recent_records.map((record) => <RecordCard key={record.id} record={record} onOpen={onOpen} />)}</div></section> : <div className="empty-guidance"><strong>还没有最近动态</strong><p>先记下一条装修记录。</p></div>}
    </>}
  </section>
}

export function RecordsAnalyticsView({ onOpen, refreshRevision }: { onOpen: (id: string) => void; refreshRevision: number }) {
  const [recordType, setRecordType] = useState('')
  const [status, setStatus] = useState('')
  const [spaceId, setSpaceId] = useState('')
  const [stageId, setStageId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [stages, setStages] = useState<NamedEntity[]>([])
  const [data, setData] = useState<RecordsAnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settledKey, setSettledKey] = useState('')
  const [visibleCount, setVisibleCount] = useState(ANALYTICS_RECORD_BATCH)

  const [filterError, setFilterError] = useState('')
  const [filterRetry, setFilterRetry] = useState(0)
  const [retry, setRetry] = useState(0)
  const [statusOptions, setStatusOptions] = useState<{ key: string; label: string }[]>([])
  const typeTabs = useSlidingTabIndicator(recordType)
  const requestKey = JSON.stringify([recordType, status, spaceId, stageId, dateFrom, dateTo, refreshRevision, retry])
  const pending = loading || settledKey !== requestKey
  const showDashboard = !error && data !== null && (data.summary.total > 0 || Boolean(status))
  const stageDistribution = data?.specific.stage_distribution ?? []
  const spaceDistribution = data?.specific.space_distribution ?? []
  useEffect(() => {
    let active = true
    // 筛选项加载失败要显示重试入口；卸载后忽略迟到的响应。
    Promise.all([listSpaces(), listEntities('stages')])
      .then(([nextSpaces, nextStages]) => {
        if (!active) return
        setSpaces(nextSpaces)
        setStages(nextStages)
        setFilterError('')
      })
      .catch((reason: unknown) => {
        if (active) setFilterError(reason instanceof Error ? reason.message : '筛选项加载失败')
      })
    return () => { active = false }
  }, [filterRetry])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    // 筛选变化时只接受最新请求，避免图表与当前条件不一致。
    getRecordsAnalytics({ record_type: recordType, status, space_id: spaceId, stage_id: stageId, date_from: dateFrom, date_to: dateTo })
      .then((result) => { if (!active) return; setData(result); setSettledKey(requestKey); setVisibleCount(ANALYTICS_RECORD_BATCH); if (!status) setStatusOptions(result.summary.status_distribution) })
      .catch((reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : '记录分析加载失败'); setSettledKey(requestKey) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [recordType, status, spaceId, stageId, dateFrom, dateTo, refreshRevision, retry, requestKey])

  const clear = () => { setRecordType(''); setStatus(''); setSpaceId(''); setStageId(''); setDateFrom(''); setDateTo('') }
  const chooseType = (nextType: string) => preserveFilterViewport(typeTabs.ref.current, () => {
    setRecordType(nextType)
    setStatus('')
    if (nextType) setStatusOptions([])
  })
  // 类型是常用切换，保持可见；仅统计折叠区里的条件，收起不改变查询。
  const activeFilterCount = [status, spaceId, stageId, dateFrom, dateTo].filter(Boolean).length
  return <section className="view-panel">
    <FilterDisclosure title="记录分析" activeCount={activeFilterCount} onClear={clear} toolbar={
      <div ref={typeTabs.ref} className="type-tabs" data-indicator-ready={typeTabs.ready} role="tablist" aria-label="记录类型" style={typeTabs.style} onKeyDown={handleTablistKeyDown}><button type="button" role="tab" aria-selected={!recordType} tabIndex={!recordType ? 0 : -1} className={!recordType ? 'is-active' : ''} onClick={() => chooseType('')}>全部</button>{types.map(([key, label]) => <button type="button" role="tab" aria-selected={recordType === key} tabIndex={recordType === key ? 0 : -1} key={key} className={recordType === key ? 'is-active' : ''} onClick={() => chooseType(key)}>{label}</button>)}</div>
    }>
      {filterError && <p className="view-state view-state--error" role="alert">筛选项加载失败：{filterError} <button type="button" onClick={() => setFilterRetry((value) => value + 1)}>重试</button></p>}
      <div className="filter-grid"><label className="field-stack"><span>记录状态</span><Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{statusOptions.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</Select></label><label className="field-stack"><span>空间</span><Select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">全部空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label><label className="field-stack"><span>装修阶段</span><Select value={stageId} onChange={(event) => setStageId(event.target.value)}><option value="">全部阶段</option>{stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div>
    </FilterDisclosure>
    {pending && data && <p className="sr-only" role="status">正在加载分析…</p>}
    <div className="records-analytics-content" aria-busy={pending}>
      {!showDashboard && (!pending || data === null) && loadMessage(pending, error, data?.summary.total === 0, '录入并确认正式记录后，可按类型、空间和阶段查看趋势。', () => setRetry(value => value + 1))}
      {showDashboard && data && <div className="records-analytics-dashboard" data-pending={pending} inert={pending}>
        <div className="summary-grid">
          <AnalyticsMetric label="符合条件的记录" value={data.summary.total} pending={pending} resultKey={settledKey} tone="summary-card--info" />
          <AnalyticsMetric label="日期待补充" value={data.summary.unknown_date_count} pending={pending} resultKey={settledKey} />
          {typeof data.specific.overdue_count === 'number' && <AnalyticsMetric label="逾期待办" value={data.specific.overdue_count} pending={pending} resultKey={settledKey} tone="summary-card--warning" />}
        </div>
        <div className="chart-grid">
          <EChart title="时间趋势" kind="line" option={lineOption(data.summary.time_trend)} summary={chartSummary('时间趋势', data.summary.time_trend)} smoothUpdate />
          <EChart title="状态分布" description="" kind="donut" option={donutOption(data.summary.status_distribution)} summary={chartSummary('状态分布', data.summary.status_distribution)} onDataClick={setStatus} selectedKey={status} accessibleItems={data.summary.status_distribution.map(item => ({ key: item.key, label: item.label }))} smoothUpdate />
          {recordType && (recordType === 'decision' || recordType === 'research'
            ? <div className="analytics-space-chart"><details className="analytics-space-help"><summary aria-label="空间分布统计口径">统计口径</summary><p>一条记录关联多个空间时，分别计入各空间。</p></details><EChart title="空间分布" kind="bar" option={horizontalBarOption(spaceDistribution)} summary={chartSummary('空间分布', spaceDistribution)} scrollableContentHeight={spaceDistribution.length > 8 ? spaceDistribution.length * 32 + 44 : undefined} scrollableMaxHeight={290} smoothUpdate /></div>
            : data.specific.distribution && <EChart title="类型专属分布" description="" kind="bar" option={horizontalBarOption(data.specific.distribution)} summary={chartSummary('类型专属分布', data.specific.distribution)} smoothUpdate />)}
          {recordType && <EChart title="装修阶段分布" kind="bar" option={horizontalBarOption(stageDistribution)} summary={chartSummary('装修阶段分布', stageDistribution)} scrollableContentHeight={stageDistribution.length > 8 ? stageDistribution.length * 32 + 44 : undefined} scrollableMaxHeight={290} smoothUpdate />}
        </div>
        <section className="projection-section records-analytics-records">
          <h3>对应记录</h3>
          <div className="card-grid">{data.records.slice(0, visibleCount).map(record => <RecordCard key={record.id} record={record} onOpen={onOpen} />)}</div>
          {!pending && visibleCount < data.records.length && <button type="button" className="records-analytics-more secondary-button" aria-label={`展开更多，接下来 ${Math.min(ANALYTICS_RECORD_BATCH, data.records.length - visibleCount)} 条记录`} onClick={() => setVisibleCount(count => count + ANALYTICS_RECORD_BATCH)}>展开更多<span className="records-analytics-more__chevron" aria-hidden="true" /></button>}
        </section>
      </div>}
    </div>
  </section>
}

const rangeLabels: Record<string, string> = { '7d': '最近7天', '30d': '最近30天', '90d': '最近90天', all: '全部时间' }

export function AiAnalyticsView() {
  const [range, setRange] = useState('30d')
  const [overview, setOverview] = useState<AiAnalyticsOverview | null>(null)
  const [runs, setRuns] = useState<AiAnalyticsRunsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    // 范围切换后的旧响应不更新指标、明细或加载状态。
    Promise.all([getAiAnalyticsOverview(range), getAiAnalyticsRuns(range)])
      .then(([a, b]) => { if (active) { setOverview(a); setRuns(b) } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'AI 运行数据加载失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [range, retry])
  const trend = useMemo(() => overview?.trend.map((item) => ({ key: item.key, label: item.label, value: item.requests })) ?? [], [overview])
  return <section className="view-panel"><header><h2>AI 运行记录</h2></header>
    <label className="field-stack range-picker"><span>统计范围</span><Select value={range} onChange={(event) => setRange(event.target.value)}>{Object.entries(rangeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
    {loadMessage(loading, error, overview?.summary.request_count === 0, '在录入页的“智能拆分”区域运行分析后，这里会展示成功、回退和耗时。', () => setRetry(value => value + 1))}
    {!loading && !error && overview && overview.summary.request_count > 0 && <><div className="summary-grid summary-grid--metrics"><article className="summary-card summary-card--info"><span>分析请求</span><strong>{overview.summary.request_count}</strong></article><article className="summary-card summary-card--success"><span>成功率</span><strong>{Math.round(overview.summary.success_rate * 100)}%</strong></article><article className="summary-card summary-card--warning"><span>回退率</span><strong>{Math.round(overview.summary.fallback_rate * 100)}%</strong></article><article className="summary-card"><span>平均耗时</span><strong>{overview.summary.average_duration_ms}<small>毫秒</small></strong></article><article className="summary-card"><span>P95 耗时</span><strong>{overview.summary.p95_duration_ms}<small>毫秒</small></strong></article><article className="summary-card"><span>已使用 token</span><strong>{overview.summary.total_tokens}</strong></article></div><div className="chart-grid"><EChart title="请求趋势" description="" kind="line" option={lineOption(trend)} summary={chartSummary('请求趋势', trend)} /><EChart title="最终引擎分布" description="" kind="donut" option={donutOption(overview.engine_distribution)} summary={chartSummary('最终引擎分布', overview.engine_distribution)} />{overview.error_distribution.length > 0 && <EChart title="错误类型分布" description="" kind="bar" option={horizontalBarOption(overview.error_distribution)} summary={chartSummary('错误类型分布', overview.error_distribution)} />}</div></>}
    {!loading && !error && runs && runs.items.length > 0 && <section className="projection-section"><h3>运行明细</h3><div className="run-table" role="table" aria-label="AI 运行明细">{runs.items.map((run) => <article role="row" className="run-row" key={run.request_id}><div><strong>{run.status === 'succeeded' ? '成功' : '失败'}{run.fallback ? ' · 已回退' : ''}</strong><small>{formatBeijingDateTime(run.started_at)}</small></div><span>最终引擎：{run.final_engine}</span><span>耗时：{run.duration_ms}毫秒</span><span>token：{run.total_tokens ?? '未报告'}</span>{run.error_summary && <span className="warning-text">错误摘要：{run.error_summary}</span>}</article>)}</div></section>}
  </section>
}
