import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { AiAnalyticsView, OverviewView, RecordsAnalyticsView } from './AnalyticsViews'
import { defaultPayload, payloadForSave, RecordEditFields, type RecordType } from './DomainWorkspace'
import { EChart } from './EChart'
import { chartSummary, donutOption, horizontalBarOption, lineOption } from './chartConfig'
import {
  getIssueBoard,
  getLedgerSummary,
  getRecord,
  getSource,
  getSpaceArchive,
  getTimeline,
  deleteRecord,
  listEntities,
  listRecordAudit,
  listRelations,
  listSpaces,
  searchRecords,
  reviewRecordSource,
  updateRecord,
  type AuditEntry,
  type IssueBoardResponse,
  type LedgerResponse,
  type NamedEntity,
  type ProjectionRecord,
  type RecordRelation,
  type SearchResponse,
  type SourceDetail,
  type SpaceArchiveResponse,
  type SpaceEntry,
  type TimelineResponse,
  type DistributionItem,
} from './domainApi'
import { recordStatusLabel } from './recordLabels'
import { relationLabel } from './relationLabels'
import { beijingToday, formatBeijingDateTime, formatCalendarDate } from './time'

type ViewName = 'overview' | 'capture' | 'timeline' | 'ledger' | 'issues' | 'spaces' | 'records' | 'ai' | 'search'

const viewLabels: Array<{ key: ViewName; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'capture', label: '录入' },
  { key: 'timeline', label: '时间线' },
  { key: 'ledger', label: '账本' },
  { key: 'issues', label: '问题' },
  { key: 'spaces', label: '空间' },
  { key: 'records', label: '记录分析' },
  { key: 'ai', label: '智能分析' },
  { key: 'search', label: '搜索' },
]

const viewGroups: Array<{ label: string; items: ViewName[] }> = [
  { label: '工作台', items: ['overview', 'capture'] },
  { label: '业务管理', items: ['timeline', 'ledger', 'issues', 'spaces'] },
  { label: '数据分析', items: ['records', 'ai'] },
  { label: '工具', items: ['search'] },
]

const typeLabels: Record<string, string> = {
  event: '事件', ledger: '账目', issue: '问题', measurement: '尺寸',
  decision: '决策', procurement: '采购', research: '调研',
}

const money = (minor: number | undefined) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format((minor ?? 0) / 100)

const spaceKindLabels: Record<string, string> = { house: '房屋', room: '房间', component: '构件', surface: '表面' }
const auditActionLabels: Record<string, string> = { create: '创建记录', update: '修改内容', delete: '删除记录', archive: '隐藏记录', restore: '重新显示', review: '复核来源', confirm: '确认候选' }

function AnalyticsChart({
  title, rows, onClick, unit = '项', kind, description, selectedKey,
}: {
  title: string
  rows: DistributionItem[]
  onClick?: (key: string) => void
  unit?: string
  kind: 'line' | 'bar' | 'donut'
  description: string
  selectedKey?: string
}) {
  const option = kind === 'line' ? lineOption(rows, unit)
    : kind === 'donut' ? donutOption(rows, unit)
    : horizontalBarOption(rows, unit)
  return <EChart title={title} description={description} kind={kind} option={option} summary={chartSummary(title, rows, unit)} onDataClick={onClick} selectedKey={selectedKey} />
}

function LoadState({ loading, error, empty }: { loading: boolean; error: string; empty?: boolean }) {
  if (loading) return <p className="view-state" role="status">正在加载…</p>
  if (error) return <p className="view-state view-state--error" role="alert">{error}</p>
  if (empty) return <p className="view-state">暂无符合条件的记录。</p>
  return null
}

function RecordButton({ record, onOpen }: { record: ProjectionRecord; onOpen: (id: string) => void }) {
  return (
    <button className="projection-card" type="button" onClick={() => onOpen(record.id)}>
      <span className="record-type-tag">{typeLabels[record.record_type] || '未知类型'}</span>
      <strong>{record.title}</strong>
      <span>{recordStatusLabel(record.record_type, record.status)}</span>
      {record.spaces.length > 0 && <small>{record.spaces.map((item) => item.name).join(' · ')}</small>}
    </button>
  )
}

function ReferenceFilters({
  spaces, stages, spaceId, stageId, onSpace, onStage,
}: {
  spaces: SpaceEntry[]; stages: NamedEntity[]; spaceId: string; stageId: string
  onSpace: (value: string) => void; onStage: (value: string) => void
}) {
  return <>
    <label className="field-stack"><span>空间</span><select value={spaceId} onChange={(event) => onSpace(event.target.value)}><option value="">全部空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="field-stack"><span>装修阶段</span><select value={stageId} onChange={(event) => onStage(event.target.value)}><option value="">全部阶段</option>{stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
  </>
}

function TimelineView({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<TimelineResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [recordType, setRecordType] = useState('')
  const [spaceId, setSpaceId] = useState('')
  const [stageId, setStageId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [reload, setReload] = useState(0)
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [stages, setStages] = useState<NamedEntity[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      getTimeline({ q, record_type: recordType, space_id: spaceId, stage_id: stageId, date_from: dateFrom, date_to: dateTo }),
      listSpaces(), listEntities('stages'),
    ]).then(([result, spaceRows, stageRows]) => {
      if (!active) return
      setData(result); setSpaces(spaceRows); setStages(stageRows); setError('')
    }).catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : '时间线加载失败'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [reload])

  return <section className="view-panel"><header><p className="eyebrow">阶段 2B</p><h2>装修时间线</h2><p>按真实发生日期查看事件和关联事实，未知时间不会被伪装。</p></header>
    <div className="filter-grid"><label className="field-stack"><span>关键词</span><input value={q} onChange={(event) => setQ(event.target.value)} /></label><label className="field-stack"><span>记录类型</span><select value={recordType} onChange={(event) => setRecordType(event.target.value)}><option value="">全部类型</option>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><ReferenceFilters spaces={spaces} stages={stages} spaceId={spaceId} stageId={stageId} onSpace={setSpaceId} onStage={setStageId} /><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={() => setReload((value) => value + 1)}>应用筛选</button></div>
    <LoadState loading={loading} error={error} empty={data?.total === 0} />
    {data && data.total > 0 && <div className="chart-grid"><AnalyticsChart title="记录时间趋势" description="按业务发生日期观察记录变化" kind="line" rows={data.analytics.time_trend} /><AnalyticsChart title="记录类型分布" description="点击类型可筛选下方时间线" kind="donut" rows={data.analytics.type_distribution} onClick={setRecordType} selectedKey={recordType} /></div>}
    {recordType && <button type="button" className="clear-filter" onClick={() => setRecordType('')}>当前按记录类型筛选，点击清除</button>}
    {data?.groups.map((group) => <section className="timeline-group" key={group.date_key}><h3>{group.label}</h3><div className="timeline-day-items">{group.items.map((item) => <article className="timeline-item" key={item.record.id}><RecordButton record={item.record} onOpen={onOpen} />{item.related_records.length > 0 && <div className="related-strip"><span>关联事实</span>{item.related_records.map((record) => <RecordButton key={record.id} record={record} onOpen={onOpen} />)}</div>}</article>)}</div></section>)}
  </section>
}

function LedgerView({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<LedgerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    getLedgerSummary({ date_from: dateFrom, date_to: dateTo })
      .then((result) => { if (active) { setData(result); setError('') } })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : '账本加载失败'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [reload])
  return <section className="view-panel"><header><p className="eyebrow">资金流与订单分开</p><h2>装修账本</h2><p>订单金额、实际付款、退款、收入和可计算待付各自保留依据。</p></header>
    <div className="filter-grid filter-grid--compact"><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={() => setReload((value) => value + 1)}>应用筛选</button></div>
    <LoadState loading={loading} error={error} empty={data ? data.procurements.length === 0 && data.ledger_entries.length === 0 : false} />
    {data && <><div className="summary-grid summary-grid--money"><article className="summary-card summary-card--info"><span>采购总额</span><strong>{money(data.totals.procurement_total_minor)}</strong><small>全部已入账支出</small></article><article className="summary-card"><span>实际支出</span><strong>{money(data.totals.net_paid_minor)}</strong><small>支出减退款与收入</small></article><article className="summary-card summary-card--success"><span>退款与收入</span><strong>{money(data.totals.refund_minor + data.totals.income_minor)}</strong></article><article className="summary-card summary-card--warning"><span>待付金额</span><strong>{money(data.totals.outstanding_minor)}</strong></article></div>{(data.totals.unallocated_expense_minor > 0 || data.totals.unallocated_refund_minor > 0 || data.totals.unallocated_income_minor > 0) && <p className="warning-text">存在未关联采购的流水，请在详情中补充关系。</p>}</>}
    {data && (data.analytics.payment_composition.length > 0 || data.analytics.vendor_distribution.length > 0) && <div className="chart-grid"><AnalyticsChart title="采购付款构成" description="订单付款、待付与溢付的金额构成" kind="donut" unit="元" rows={data.analytics.payment_composition.map((item) => ({ ...item, value: item.value / 100 }))} /><AnalyticsChart title="主要商家金额" description="按账目中的交易对象汇总净流水；支出为正，退款与收入为负" kind="bar" unit="元" rows={data.analytics.vendor_distribution.map((item) => ({ ...item, value: item.value / 100 }))} /></div>}
    {data?.warnings.map((warning) => <p className="warning-text" key={warning}>{warning}</p>)}
    {data && data.procurements.length > 0 && <section className="projection-section"><h3>采购付款情况</h3><div className="card-grid">{data.procurements.map((record) => <button className="projection-card ledger-card" key={record.id} type="button" onClick={() => onOpen(record.id)}><strong>{record.title}</strong><span>订单：{money(record.order_total_minor ?? 0)}</span><span>净付款：{money(record.net_paid_minor)}</span><span>待付：{money(record.outstanding_minor)}</span></button>)}</div></section>}
    {data && data.ledger_entries.length > 0 && <section className="projection-section"><h3>资金流水</h3><div className="card-grid">{data.ledger_entries.map((record) => <button className="projection-card" key={record.id} type="button" onClick={() => onOpen(record.id)}><strong>{record.title}</strong><span>{{ expense: '支出', refund: '退款', income: '收入' }[record.direction as string] || '未知方向'} · {money(record.amount_minor)}</span><small>{recordStatusLabel(record.record_type, record.status)}</small></button>)}</div></section>}
  </section>
}

function IssuesView({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<IssueBoardResponse | null>(null)
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [spaceId, setSpaceId] = useState('')
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([getIssueBoard({ space_id: spaceId }), listSpaces()])
      .then(([result, rows]) => { if (active) { setData(result); setSpaces(rows); setError('') } })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : '问题看板加载失败'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [reload])
  const changeStatus = async (record: ProjectionRecord, status: string) => {
    try {
      const payload: Record<string, unknown> = { record_type: 'issue', status }
      if (status === 'done') {
        const result = window.prompt('请填写实际处理结果，保存后系统会自动登记完成日期。', String(record.actual_result ?? ''))
        if (!result?.trim()) return
        payload.actual_result = result.trim()
      }
      await updateRecord(record.id, payload)
      setReload((value) => value + 1)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '状态更新失败')
    }
  }
  return <section className="view-panel"><header><p className="eyebrow">统一跟踪处理事项</p><h2>问题看板</h2><p>待办、普通问题和施工问题统一在这里处理；完成时登记结果和日期。</p></header>
    <div className="filter-grid filter-grid--compact"><label className="field-stack"><span>空间</span><select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">全部空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="filter-button" type="button" onClick={() => setReload((value) => value + 1)}>应用筛选</button></div>
    <LoadState loading={loading} error={error} empty={data?.total === 0} />
    {data && data.total > 0 && <div className="chart-grid"><AnalyticsChart title="问题状态分布" description="点击状态可聚焦对应处理列" kind="donut" rows={data.analytics.status_distribution} onClick={setStatusFilter} selectedKey={statusFilter} /><AnalyticsChart title="问题严重程度" description="按问题数量比较风险等级" kind="bar" rows={data.analytics.severity_distribution} /></div>}
    {statusFilter && <button type="button" className="clear-filter" onClick={() => setStatusFilter('')}>当前按问题状态筛选，点击清除</button>}
    <div className="issue-board">{data?.columns.filter((column) => !statusFilter || column.status === statusFilter).map((column) => <section className="issue-column" key={column.status}><h3>{column.label}<span>{column.items.length}</span></h3>{column.items.length === 0 && <p className="muted">暂无</p>}{column.items.map((record) => <article className="issue-card" key={record.id}><button type="button" className="title-button" onClick={() => onOpen(record.id)}><strong>{record.title}</strong></button><p>{record.phenomenon}</p>{record.spaces.length > 0 && <small>{record.spaces.map((item) => item.name).join(' · ')}</small>}<label className="field-stack"><span>处理状态</span><select value={record.status} onChange={(event) => void changeStatus(record, event.target.value)}>{data.columns.map((item) => <option key={item.status} value={item.status}>{item.label}</option>)}</select></label></article>)}</section>)}</div>
  </section>
}

function SpacesView({ onOpen }: { onOpen: (id: string) => void }) {
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [spaceId, setSpaceId] = useState('')
  const [data, setData] = useState<SpaceArchiveResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  useEffect(() => {
    let active = true
    listSpaces().then((rows) => {
      if (!active) return
      setSpaces(rows)
      if (!spaceId && rows[0]) setSpaceId(rows[0].id)
      if (!rows[0]) setLoading(false)
    }).catch((reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : '空间加载失败'); setLoading(false) } })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!spaceId) return
    let active = true
    setLoading(true)
    getSpaceArchive(spaceId).then((result) => { if (active) { setData(result); setError('') } })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : '空间档案加载失败'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [spaceId])
  return <section className="view-panel"><header><p className="eyebrow">房屋 → 房间 → 局部</p><h2>空间档案</h2><p>父空间自动聚合后代空间的同一批正式记录。</p></header>
    <label className="field-stack space-picker"><span>选择空间</span><select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">请选择空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name} · {spaceKindLabels[item.kind] || '其他空间'}</option>)}</select></label>
    <LoadState loading={loading} error={error} empty={!loading && spaces.length === 0} />
    {data && <><p className="breadcrumbs">{data.breadcrumbs.map((item) => item.name).join(' / ')}</p><div className="space-overview"><div><span className="record-type-tag">当前空间</span><h3>{data.space.name}</h3><p>汇总当前空间及下级空间的正式记录</p></div><dl><div><dt>记录</dt><dd>{data.summary.record_count}</dd></div><div><dt>未关闭问题</dt><dd>{data.summary.unclosed_issue_count}</dd></div><div><dt>尺寸</dt><dd>{data.summary.measurement_count}</dd></div><div><dt>材料</dt><dd>{data.summary.material_count}</dd></div><div><dt>实际支出</dt><dd>{money(data.analytics.expense_minor - data.analytics.refund_minor)}</dd></div></dl></div>{data.analytics.type_distribution.length > 0 && <div className="chart-grid"><AnalyticsChart title="空间记录类型" description="点击类型可筛选下方记录" kind="donut" rows={data.analytics.type_distribution} onClick={setTypeFilter} selectedKey={typeFilter} /><AnalyticsChart title="空间问题状态" description="查看该空间问题的处理进度" kind="bar" rows={data.analytics.issue_status_distribution} /></div>}{typeFilter && <button type="button" className="clear-filter" onClick={() => setTypeFilter('')}>当前按记录类型筛选，点击清除</button>}{Object.entries(data.records_by_type).filter(([type]) => !typeFilter || type === typeFilter).map(([type, records]) => <section className="projection-section" key={type}><h3>{typeLabels[type] || '未知类型'}</h3><div className="card-grid">{records.map((record) => <RecordButton key={record.id} record={record} onOpen={onOpen} />)}</div></section>)}</>}
  </section>
}

function SearchView({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [recordType, setRecordType] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const runSearch = async () => {
    setLoading(true)
    try {
      setData(await searchRecords({ q, record_type: recordType, status, date_from: dateFrom, date_to: dateTo }))
      setError('')
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '搜索失败')
    } finally {
      setLoading(false)
    }
  }
  const total = useMemo(() => data ? Object.values(data.counts).reduce((sum, count) => sum + count, 0) : null, [data])
  return <section className="view-panel"><header><p className="eyebrow">基础搜索</p><h2>查找装修事实</h2><p>搜索原始来源、正式记录、材料、商家和空间；结果保持来源追溯。</p></header>
    <div className="filter-grid"><label className="field-stack"><span>关键词</span><input value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch() }} placeholder="例如：花砖、主卧、门套" /></label><label className="field-stack"><span>记录类型</span><select value={recordType} onChange={(event) => setRecordType(event.target.value)}><option value="">全部类型</option>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field-stack"><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{['planned', 'occurred', 'completed', 'cancelled', 'posted', 'open', 'in_progress', 'waiting', 'resolved', 'closed', 'pending', 'confirmed', 'ordered', 'delivery_pending', 'delivered', 'collecting', 'comparing', 'concluded', 'done'].map((value) => <option key={value} value={value}>{recordStatusLabel(recordType, value)}</option>)}</select></label><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={() => void runSearch()}>搜索</button></div>
    <LoadState loading={loading} error={error} empty={total === 0} />
    {data && <><p className="result-count">共找到 {total} 项</p>{data.groups.records.length > 0 && <section className="projection-section"><h3>正式记录 · {data.counts.records}</h3><div className="card-grid">{data.groups.records.map((record) => <RecordButton key={record.id} record={record} onOpen={onOpen} />)}</div></section>}{data.groups.sources.length > 0 && <section className="projection-section"><h3>原始来源 · {data.counts.sources}</h3>{data.groups.sources.map((source) => <article className="source-result" key={source.id}><p>{source.original_text || '仅附件来源'}</p><time>{formatBeijingDateTime(source.captured_at)}</time></article>)}</section>}{(['materials', 'vendors', 'spaces'] as const).map((group) => data.groups[group].length > 0 && <section className="projection-section" key={group}><h3>{{ materials: '材料', vendors: '商家', spaces: '空间' }[group]} · {data.counts[group]}</h3><div className="tag-list">{data.groups[group].map((item) => <span key={item.id}>{item.name}</span>)}</div></section>)}</>}
  </section>
}

function RecordDetail({ recordId, onClose, onChanged }: { recordId: string; onClose: () => void; onChanged: () => void }) {
  const [record, setRecord] = useState<ProjectionRecord | null>(null)
  const [sources, setSources] = useState<SourceDetail[]>([])
  const [relations, setRelations] = useState<RecordRelation[]>([])
  const [relatedRecords, setRelatedRecords] = useState<ProjectionRecord[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editPayload, setEditPayload] = useState<Record<string, unknown>>({})
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [editEntities, setEditEntities] = useState({
    materials: [] as NamedEntity[], vendors: [] as NamedEntity[],
    participants: [] as NamedEntity[], stages: [] as NamedEntity[],
  })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    Promise.all([
      getRecord(recordId), listRelations(recordId), listRecordAudit(recordId), listSpaces(),
      listEntities('materials'), listEntities('vendors'), listEntities('participants'), listEntities('stages'),
    ])
      .then(async ([recordResult, relationRows, auditRows, spaceRows, materials, vendors, participants, stages]) => {
        const sourceRows = await Promise.all(recordResult.source_refs.map((item) => getSource(item.source_id)))
        const relatedIds = Array.from(new Set(relationRows.flatMap((item) => [item.from_record_id, item.to_record_id]).filter((id) => id !== recordId)))
        const related = await Promise.all(relatedIds.map((id) => getRecord(id)))
        if (!active) return
        setRecord(recordResult); setSources(sourceRows); setRelations(relationRows); setRelatedRecords(related); setAudit(auditRows)
        setSpaces(spaceRows); setEditEntities({ materials, vendors, participants, stages })
      }).catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : '详情加载失败'))
    return () => { active = false }
  }, [recordId, reload])

  const acknowledgeSource = async (sourceId: string) => {
    try {
      await reviewRecordSource(recordId, sourceId)
      setReload((value) => value + 1)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '确认复核失败')
    }
  }

  const beginEdit = () => {
    if (!record) return
    setEditPayload(defaultPayload(record.record_type as RecordType, record))
    setError('')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setError('')
  }

  const changeEditField = (field: string, value: unknown) => {
    setEditPayload((current) => {
      const next = { ...current, [field]: value }
      if (record?.record_type === 'issue' && field === 'status') {
        if (value === 'done' && !current.completed_at) next.completed_at = beijingToday()
        if (value !== 'done') next.completed_at = null
      }
      return next
    })
  }

  const saveEdit = async () => {
    if (!record) return
    setBusy(true)
    try {
      const payload: Record<string, unknown> = payloadForSave(record.record_type, {
        ...editPayload,
        record_type: record.record_type,
      })
      delete payload.source_refs
      await updateRecord(record.id, payload)
      setEditing(false)
      setError('')
      setReload((value) => value + 1)
      onChanged()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '保存记录失败')
    } finally {
      setBusy(false)
    }
  }

  const removeRecord = async () => {
    if (!record || !window.confirm(`确认永久删除“${record.title}”吗？\n\n记录及关联关系会被删除，原始来源和审计历史会保留。`)) return
    setBusy(true)
    try {
      await deleteRecord(record.id)
      onChanged()
      onClose()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '删除记录失败')
      setBusy(false)
    }
  }

  return <aside className="detail-panel" aria-label="记录详情">
    <div className="detail-panel__header"><div><p className="eyebrow">{editing ? '编辑正式记录' : '来源可追溯'}</p><h2>{editing ? '修改记录' : '记录详情'}</h2></div>{!editing && <button type="button" onClick={onClose} aria-label="关闭详情">关闭</button>}</div>
    {error && <p role="alert" className="view-state--error">{error}</p>}
    {!record && !error && <p role="status">正在加载详情…</p>}
    {record && editing ? <section className="detail-edit-section"><RecordEditFields recordType={record.record_type as RecordType} payload={editPayload} spaces={spaces} entities={editEntities} onChange={changeEditField} /><div className="record-actions"><button type="button" disabled={busy} onClick={() => void saveEdit()}>{busy ? '保存中…' : '保存修改'}</button><button type="button" disabled={busy} onClick={cancelEdit}>取消</button></div></section> : record && <>
      <div className="detail-record-actions"><button type="button" disabled={busy} onClick={beginEdit}>修改记录</button><button className="danger-button" type="button" disabled={busy} onClick={() => void removeRecord()}>删除记录</button></div>
      <span className="record-type-tag">{typeLabels[record.record_type]}</span>
      <h3>{record.title}</h3>
      <p>{record.description || '暂无补充说明'}</p>
      <dl className="detail-list">
        <div><dt>状态</dt><dd>{recordStatusLabel(record.record_type, record.status)}</dd></div>
        <div><dt>事情发生日期</dt><dd>{formatCalendarDate(record.occurred_date)}</dd></div>
        <div><dt>正式记录创建时间</dt><dd>{formatBeijingDateTime(record.created_at)}</dd></div>
        <div><dt>空间</dt><dd>{record.spaces?.map((item) => item.name).join('、') || '未指定'}</dd></div>
        <div><dt>{record.record_type === 'issue' ? '处理人' : '参与者'}</dt><dd>{record.participants?.map((item) => item.name).join('、') || '未指定'}</dd></div>
        {record.record_type === 'issue' && <><div><dt>严重程度</dt><dd>{{ low: '低', medium: '中', high: '高' }[String(record.severity)] || '未评估'}</dd></div><div><dt>实际完成日期</dt><dd>{formatCalendarDate(record.completed_at)}</dd></div><div><dt>实际处理结果</dt><dd>{record.actual_result || '待补充'}</dd></div></>}
      </dl>
      <section><h4>原始来源与附件</h4>{sources.map((source) => {
        const sourceRef = record.source_refs.find((item) => item.source_id === source.id)
        return <article className="evidence-card" key={source.id}>
          {sourceRef?.needs_review && <div className="source-review-warning"><span>原始数据已修改，这条正式记录待复核。</span><button type="button" onClick={() => void acknowledgeSource(source.id)}>已核对，无需修改</button></div>}
          <p>{source.original_text || '仅附件来源'}</p>
          <small>录入时间：{formatBeijingDateTime(source.captured_at)} · 来源版本 {source.revision}</small>
          {source.attachments.map((attachment) => <small key={attachment.id}>附件：{attachment.original_filename} · {Math.ceil(attachment.size_bytes / 1024)} 千字节</small>)}
        </article>
      })}</section>
      <section><h4>关联记录</h4>{relations.length === 0 && <p className="muted">暂无显式关系。</p>}{relations.map((relation) => { const related = relatedRecords.find((item) => item.id === (relation.from_record_id === recordId ? relation.to_record_id : relation.from_record_id)); return <p className="relation-summary" key={relation.id}>{relationLabel(relation.relation_type)} · {related?.title || '关联记录'}</p> })}</section>
      <section><h4>操作记录</h4><p className="muted">这里记录数据如何变化：“隐藏记录”只是从常用视图隐藏，“重新显示”会让它再次出现；它们都不会删除历史。</p>{audit.map((item) => <p className="audit-row" key={item.id}>{formatBeijingDateTime(item.timestamp)} · {auditActionLabels[item.action] || '数据操作'}</p>)}</section>
    </>}
  </aside>
}

export function CoreViews({ children, onLogout }: { children: ReactNode; onLogout?: () => void }) {
  const [view, setView] = useState<ViewName>('overview')
  const [detailId, setDetailId] = useState('')
  const [viewRevision, setViewRevision] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  const currentLabel = viewLabels.find((item) => item.key === view)?.label ?? '工作台'
  const selectView = (next: ViewName) => { setView(next); setDetailId(''); setNavOpen(false) }
  return <div className="workspace-shell">
    <aside className={`workspace-sidebar${navOpen ? ' is-open' : ''}`}>
      <div className="workspace-brand"><span className="workspace-brand__mark">H</span><div><strong>HomeBuild Log</strong><small>装修事实工作台</small></div></div>
      <nav className="workspace-nav" aria-label="核心功能">{viewGroups.map((group) => <section key={group.label}><h2>{group.label}</h2>{group.items.map((key) => { const item = viewLabels.find((entry) => entry.key === key)!; return <button key={key} type="button" className={view === key ? 'is-active' : ''} aria-current={view === key ? 'page' : undefined} onClick={() => selectView(key)}><span aria-hidden="true">{item.label.slice(0, 1)}</span>{item.label}</button> })}</section>)}</nav>
      <footer className="workspace-sidebar__footer"><p><span className="service-dot" />本地服务运行正常</p>{onLogout && <button type="button" onClick={onLogout}>退出登录</button>}</footer>
    </aside>
    {navOpen && <button type="button" className="nav-backdrop" aria-label="关闭导航" onClick={() => setNavOpen(false)} />}
    <div className="workspace-main">
      <header className="workspace-topbar"><button type="button" className="menu-button" aria-label="打开导航" aria-expanded={navOpen} onClick={() => setNavOpen((value) => !value)}>☰</button><div><small>HomeBuild Log</small><strong>{currentLabel}</strong></div><span><span className="service-dot" />服务正常</span></header>
      <main className="workspace-content" key={`${view}-${viewRevision}`}>{view === 'overview' && <OverviewView onOpen={setDetailId} />}{view === 'capture' && children}{view === 'timeline' && <TimelineView onOpen={setDetailId} />}{view === 'ledger' && <LedgerView onOpen={setDetailId} />}{view === 'issues' && <IssuesView onOpen={setDetailId} />}{view === 'spaces' && <SpacesView onOpen={setDetailId} />}{view === 'records' && <RecordsAnalyticsView onOpen={setDetailId} />}{view === 'ai' && <AiAnalyticsView />}{view === 'search' && <SearchView onOpen={setDetailId} />}</main>
    </div>
    {detailId && <RecordDetail recordId={detailId} onClose={() => setDetailId('')} onChanged={() => setViewRevision((value) => value + 1)} />}
  </div>
}
