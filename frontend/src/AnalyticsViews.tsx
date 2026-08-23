import { useEffect, useMemo, useState } from 'react'
import { Select } from './Select'
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

const types = Object.entries(recordTypeLabels)
function loadMessage(loading: boolean, error: string, empty: boolean, hint: string) {
  if (loading) return <p className="view-state" role="status">正在加载分析…</p>
  if (error) return <p className="view-state view-state--error" role="alert">{error}</p>
  if (empty) return <div className="empty-guidance"><strong>暂时没有可分析的数据</strong><p>{hint}</p></div>
  return null
}

function RecordCard({ record, onOpen }: { record: ProjectionRecord; onOpen: (id: string) => void }) {
  return <button type="button" className="projection-card" onClick={() => onOpen(record.id)}>
    <span className="record-type-tag">{recordTypeLabels[record.record_type]}</span>
    <strong>{record.title}</strong>
    <span>{recordStatusLabel(record.record_type, record.status, record.ledger_kind)}</span>
    <small>{formatCalendarDate(record.occurred_date)}</small>
  </button>
}

export function OverviewView({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    getOverview().then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '概览加载失败'))
      .finally(() => setLoading(false))
  }, [])
  const stageTotal = data?.stage_distribution.reduce((sum, item) => sum + item.value, 0) ?? 0
  return <section className="view-panel"><header><p className="eyebrow">日常行动面板</p><h2>装修概览</h2><p>先看需要处理的风险，再回到最近发生的事情。</p></header>
    {loadMessage(loading, error, !loading && !data, '先录入问题、待办或采购记录，概览会自动整理风险。')}
    {data && <>
      <div className="summary-grid overview-summary">
        <article className="summary-card summary-card--risk"><span>未关闭问题</span><strong>{data.summary.open_issue_count}</strong><small>需要持续跟进</small></article>
        <article className="summary-card summary-card--warning"><span>已逾期事项</span><strong>{data.summary.overdue_count}</strong><small>建议优先处理</small></article>
        <article className="summary-card summary-card--info"><span>未来 7 天事项</span><strong>{data.summary.upcoming_count}</strong><small>提前安排资源</small></article>
      </div>
      {data.stage_distribution.length > 0 && <section className="overview-stage-panel"><EChart title="阶段事项分布" description="查看当前记录主要集中在哪个装修阶段" kind="donut" option={donutOption(data.stage_distribution)} summary={chartSummary('阶段事项分布', data.stage_distribution)} /><aside><header><h3>阶段明细</h3><span>共 {stageTotal} 项</span></header><div className="stage-breakdown">{data.stage_distribution.map((item, index) => <div key={item.key}><span className="stage-breakdown__dot" style={{ backgroundColor: chartCategoryColors[index % chartCategoryColors.length] }} /><strong>{item.label}</strong><span>{item.value} 项</span><em>{stageTotal ? `${Math.round((item.value / stageTotal) * 1000) / 10}%` : '0%'}</em></div>)}</div></aside></section>}
      {(data.overdue.length > 0 || data.upcoming.length > 0) && <section className="projection-section"><h3>近期需要行动</h3><div className="card-grid">{[...data.overdue, ...data.upcoming].map((record) => <RecordCard key={record.id} record={record} onOpen={onOpen} />)}</div></section>}
      {data.open_issues.length > 0 && <section className="projection-section"><h3>未关闭问题</h3><div className="card-grid">{data.open_issues.map((record) => <RecordCard key={record.id} record={record} onOpen={onOpen} />)}</div></section>}
      {data.recent_records.length > 0 ? <section className="projection-section"><h3>最近动态</h3><div className="card-grid">{data.recent_records.map((record) => <RecordCard key={record.id} record={record} onOpen={onOpen} />)}</div></section> : <div className="empty-guidance"><strong>还没有最近动态</strong><p>完成一次录入并确认正式记录后，这里会显示最新变化。</p></div>}
    </>}
  </section>
}

export function RecordsAnalyticsView({ onOpen }: { onOpen: (id: string) => void }) {
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

  useEffect(() => { Promise.all([listSpaces(), listEntities('stages')]).then(([a, b]) => { setSpaces(a); setStages(b) }) }, [])
  useEffect(() => {
    setLoading(true)
    getRecordsAnalytics({ record_type: recordType, status, space_id: spaceId, stage_id: stageId, date_from: dateFrom, date_to: dateTo })
      .then((result) => { setData(result); setError('') })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '记录分析加载失败'))
      .finally(() => setLoading(false))
  }, [recordType, status, spaceId, stageId, dateFrom, dateTo])

  const clear = () => { setStatus(''); setSpaceId(''); setStageId(''); setDateFrom(''); setDateTo('') }
  return <section className="view-panel"><header><p className="eyebrow">八类正式记录</p><h2>记录分析</h2><p>从分布和趋势进入同一批真实记录。</p></header>
    <div className="type-tabs" role="tablist" aria-label="记录类型"><button type="button" className={!recordType ? 'is-active' : ''} onClick={() => { setRecordType(''); setStatus('') }}>全部</button>{types.map(([key, label]) => <button type="button" key={key} className={recordType === key ? 'is-active' : ''} onClick={() => { setRecordType(key); setStatus('') }}>{label}</button>)}</div>
    <div className="filter-grid"><label className="field-stack"><span>空间</span><Select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">全部空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label><label className="field-stack"><span>装修阶段</span><Select value={stageId} onChange={(event) => setStageId(event.target.value)}><option value="">全部阶段</option>{stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={clear}>清除筛选</button></div>
    {loadMessage(loading, error, data?.summary.total === 0, '录入并确认正式记录后，可按类型、空间和阶段查看趋势。')}
    {data && data.summary.total > 0 && <><div className="summary-grid"><article className="summary-card summary-card--info"><span>符合条件的记录</span><strong>{data.summary.total}</strong></article><article className="summary-card"><span>日期待补充</span><strong>{data.summary.unknown_date_count}</strong></article>{typeof data.specific.overdue_count === 'number' && <article className="summary-card summary-card--warning"><span>逾期待办</span><strong>{data.specific.overdue_count}</strong></article>}</div><div className="chart-grid"><EChart title="时间趋势" description="按业务发生日期观察记录变化" kind="line" option={lineOption(data.summary.time_trend)} summary={chartSummary('时间趋势', data.summary.time_trend)} /><EChart title="状态分布" description="点击状态可筛选下方记录" kind="donut" option={donutOption(data.summary.status_distribution)} summary={chartSummary('状态分布', data.summary.status_distribution)} onDataClick={setStatus} selectedKey={status} />{data.specific.distribution && <EChart title="类型专属分布" description="当前记录类型的核心分类对比" kind="bar" option={horizontalBarOption(data.specific.distribution)} summary={chartSummary('类型专属分布', data.specific.distribution)} />}</div>{status && <button type="button" className="clear-filter" onClick={() => setStatus('')}>当前按状态筛选，点击取消</button>}<section className="projection-section"><h3>对应记录</h3><div className="card-grid">{data.records.map((record) => <RecordCard key={record.id} record={record} onOpen={onOpen} />)}</div></section></>}
  </section>
}

const rangeLabels: Record<string, string> = { '7d': '最近7天', '30d': '最近30天', '90d': '最近90天', all: '全部时间' }

export function AiAnalyticsView() {
  const [range, setRange] = useState('30d')
  const [overview, setOverview] = useState<AiAnalyticsOverview | null>(null)
  const [runs, setRuns] = useState<AiAnalyticsRunsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    setLoading(true)
    Promise.all([getAiAnalyticsOverview(range), getAiAnalyticsRuns(range)])
      .then(([a, b]) => { setOverview(a); setRuns(b); setError('') })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '智能分析运行数据加载失败'))
      .finally(() => setLoading(false))
  }, [range])
  const trend = useMemo(() => overview?.trend.map((item) => ({ key: item.key, label: item.label, value: item.requests })) ?? [], [overview])
  return <section className="view-panel"><header><p className="eyebrow">安全运行数据</p><h2>智能分析</h2><p>只展示运行结果和性能，不展示提示词、原始响应或密钥。</p></header>
    <label className="field-stack range-picker"><span>统计范围</span><Select value={range} onChange={(event) => setRange(event.target.value)}>{Object.entries(rangeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
    {loadMessage(loading, error, overview?.summary.request_count === 0, '在录入页的“智能拆分”区域运行分析后，这里会展示成功、回退和耗时。')}
    {overview && overview.summary.request_count > 0 && <><div className="summary-grid summary-grid--metrics"><article className="summary-card summary-card--info"><span>分析请求</span><strong>{overview.summary.request_count}</strong></article><article className="summary-card summary-card--success"><span>成功率</span><strong>{Math.round(overview.summary.success_rate * 100)}%</strong></article><article className="summary-card summary-card--warning"><span>回退率</span><strong>{Math.round(overview.summary.fallback_rate * 100)}%</strong></article><article className="summary-card"><span>平均耗时</span><strong>{overview.summary.average_duration_ms}<small>毫秒</small></strong></article><article className="summary-card"><span>P95 耗时</span><strong>{overview.summary.p95_duration_ms}<small>毫秒</small></strong></article><article className="summary-card"><span>已使用 token</span><strong>{overview.summary.total_tokens}</strong></article></div><div className="chart-grid"><EChart title="请求趋势" description="统计范围内每天的智能分析请求数" kind="line" option={lineOption(trend)} summary={chartSummary('请求趋势', trend)} /><EChart title="最终引擎分布" description="请求最终由哪个分析引擎完成" kind="donut" option={donutOption(overview.engine_distribution)} summary={chartSummary('最终引擎分布', overview.engine_distribution)} />{overview.error_distribution.length > 0 && <EChart title="错误类型分布" description="按出现次数从低到高排列" kind="bar" option={horizontalBarOption(overview.error_distribution)} summary={chartSummary('错误类型分布', overview.error_distribution)} />}</div></>}
    {runs && runs.items.length > 0 && <section className="projection-section"><h3>安全运行明细</h3><div className="run-table" role="table" aria-label="智能分析运行明细">{runs.items.map((run) => <article role="row" className="run-row" key={run.request_id}><div><strong>{run.status === 'succeeded' ? '成功' : '失败'}{run.fallback ? ' · 已回退' : ''}</strong><small>{formatBeijingDateTime(run.started_at)}</small></div><span>最终引擎：{run.final_engine}</span><span>耗时：{run.duration_ms}毫秒</span><span>token：{run.total_tokens ?? '未报告'}</span>{run.error_summary && <span className="warning-text">错误摘要：{run.error_summary}</span>}</article>)}</div></section>}
  </section>
}
