import { useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  getIssueBoard,
  getLedgerSummary,
  getRecord,
  getSource,
  getSpaceArchive,
  getTimeline,
  listEntities,
  listRecordAudit,
  listRelations,
  listSpaces,
  searchRecords,
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
} from './domainApi'
import { recordStatusLabel } from './recordLabels'
import { relationLabel } from './relationLabels'

type ViewName = 'capture' | 'timeline' | 'ledger' | 'issues' | 'spaces' | 'search'

const viewLabels: Array<{ key: ViewName; label: string }> = [
  { key: 'capture', label: '录入' },
  { key: 'timeline', label: '时间线' },
  { key: 'ledger', label: '账本' },
  { key: 'issues', label: '问题' },
  { key: 'spaces', label: '空间' },
  { key: 'search', label: '搜索' },
]

const typeLabels: Record<string, string> = {
  event: '事件', ledger: '账目', issue: '施工问题', measurement: '尺寸',
  decision: '决策', procurement: '采购', research: '调研', todo: '待办',
}

const money = (minor: number | undefined, currency = 'CNY') =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format((minor ?? 0) / 100)

function LoadState({ loading, error, empty }: { loading: boolean; error: string; empty?: boolean }) {
  if (loading) return <p className="view-state" role="status">正在加载…</p>
  if (error) return <p className="view-state view-state--error" role="alert">{error}</p>
  if (empty) return <p className="view-state">暂无符合条件的记录。</p>
  return null
}

function RecordButton({ record, onOpen }: { record: ProjectionRecord; onOpen: (id: string) => void }) {
  return (
    <button className="projection-card" type="button" onClick={() => onOpen(record.id)}>
      <span className="record-type-tag">{typeLabels[record.record_type] || record.record_type}</span>
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

  return <section className="view-panel"><header><p className="eyebrow">阶段 2B</p><h2>装修时间线</h2><p>按真实业务日期查看事件和关联事实，未知日期不会被伪装。</p></header>
    <div className="filter-grid"><label className="field-stack"><span>关键词</span><input value={q} onChange={(event) => setQ(event.target.value)} /></label><label className="field-stack"><span>记录类型</span><select value={recordType} onChange={(event) => setRecordType(event.target.value)}><option value="">全部类型</option>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><ReferenceFilters spaces={spaces} stages={stages} spaceId={spaceId} stageId={stageId} onSpace={setSpaceId} onStage={setStageId} /><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={() => setReload((value) => value + 1)}>应用筛选</button></div>
    <LoadState loading={loading} error={error} empty={data?.total === 0} />
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
  return <section className="view-panel"><header><p className="eyebrow">资金流与订单分开</p><h2>装修账本</h2><p>订单金额、实际付款、退款和可计算待付各自保留依据。</p></header>
    <div className="filter-grid filter-grid--compact"><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={() => setReload((value) => value + 1)}>应用筛选</button></div>
    <LoadState loading={loading} error={error} empty={data?.totals_by_currency.length === 0} />
    <div className="summary-grid">{data?.totals_by_currency.map((total) => <article className="summary-card" key={total.currency}><strong>{total.currency}</strong><dl><div><dt>采购总额</dt><dd>{money(total.procurement_total_minor, total.currency)}</dd></div><div><dt>实际支出</dt><dd>{money(total.expense_minor, total.currency)}</dd></div><div><dt>退款</dt><dd>{money(total.refund_minor, total.currency)}</dd></div><div><dt>待付</dt><dd>{money(total.outstanding_minor, total.currency)}</dd></div></dl>{(total.unallocated_expense_minor > 0 || total.unallocated_refund_minor > 0) && <p className="warning-text">存在未关联采购的流水，请在详情中补充关系。</p>}</article>)}</div>
    {data?.warnings.map((warning) => <p className="warning-text" key={warning}>{warning}</p>)}
    {data && data.procurements.length > 0 && <section className="projection-section"><h3>采购付款情况</h3><div className="card-grid">{data.procurements.map((record) => <button className="projection-card ledger-card" key={record.id} type="button" onClick={() => onOpen(record.id)}><strong>{record.title}</strong><span>订单：{money(record.order_total_minor ?? 0, record.currency)}</span><span>净付款：{money(record.net_paid_minor, record.currency)}</span><span>待付：{money(record.outstanding_minor, record.currency)}</span></button>)}</div></section>}
    {data && data.ledger_entries.length > 0 && <section className="projection-section"><h3>资金流水</h3><div className="card-grid">{data.ledger_entries.map((record) => <button className="projection-card" key={record.id} type="button" onClick={() => onOpen(record.id)}><strong>{record.title}</strong><span>{record.direction === 'refund' ? '退款' : '支出'} · {money(record.amount_minor, record.currency)}</span><small>{recordStatusLabel(record.record_type, record.status)}</small></button>)}</div></section>}
  </section>
}

function IssuesView({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<IssueBoardResponse | null>(null)
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [spaceId, setSpaceId] = useState('')
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
      await updateRecord(record.id, { record_type: 'issue', status })
      setReload((value) => value + 1)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '状态更新失败')
    }
  }
  return <section className="view-panel"><header><p className="eyebrow">处理与复核分开</p><h2>问题看板</h2><p>接受现状或决定不返工，不会自动把问题标记为已关闭。</p></header>
    <div className="filter-grid filter-grid--compact"><label className="field-stack"><span>空间</span><select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">全部空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="filter-button" type="button" onClick={() => setReload((value) => value + 1)}>应用筛选</button></div>
    <LoadState loading={loading} error={error} empty={data?.total === 0} />
    <div className="issue-board">{data?.columns.map((column) => <section className="issue-column" key={column.status}><h3>{column.label}<span>{column.items.length}</span></h3>{column.items.length === 0 && <p className="muted">暂无</p>}{column.items.map((record) => <article className="issue-card" key={record.id}><button type="button" className="title-button" onClick={() => onOpen(record.id)}><strong>{record.title}</strong></button><p>{record.phenomenon}</p>{record.spaces.length > 0 && <small>{record.spaces.map((item) => item.name).join(' · ')}</small>}<label className="field-stack"><span>处理状态</span><select value={record.status} onChange={(event) => void changeStatus(record, event.target.value)}>{data.columns.map((item) => <option key={item.status} value={item.status}>{item.label}</option>)}</select></label>{record.next_todos && record.next_todos.length > 0 && <p className="next-action">下一步：{record.next_todos[0].title}</p>}</article>)}</section>)}</div>
  </section>
}

function SpacesView({ onOpen }: { onOpen: (id: string) => void }) {
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [spaceId, setSpaceId] = useState('')
  const [data, setData] = useState<SpaceArchiveResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
    <label className="field-stack space-picker"><span>选择空间</span><select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">请选择空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.kind}</option>)}</select></label>
    <LoadState loading={loading} error={error} empty={!loading && spaces.length === 0} />
    {data && <><p className="breadcrumbs">{data.breadcrumbs.map((item) => item.name).join(' / ')}</p><div className="summary-grid"><article className="summary-card"><strong>{data.space.name}</strong><dl><div><dt>记录</dt><dd>{data.summary.record_count}</dd></div><div><dt>未关闭问题</dt><dd>{data.summary.unclosed_issue_count}</dd></div><div><dt>尺寸</dt><dd>{data.summary.measurement_count}</dd></div><div><dt>材料</dt><dd>{data.summary.material_count}</dd></div></dl></article></div>{Object.entries(data.records_by_type).map(([type, records]) => <section className="projection-section" key={type}><h3>{typeLabels[type] || type}</h3><div className="card-grid">{records.map((record) => <RecordButton key={record.id} record={record} onOpen={onOpen} />)}</div></section>)}</>}
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
    <div className="filter-grid"><label className="field-stack"><span>关键词</span><input value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch() }} placeholder="例如：花砖、主卧、门套" /></label><label className="field-stack"><span>记录类型</span><select value={recordType} onChange={(event) => setRecordType(event.target.value)}><option value="">全部类型</option>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field-stack"><span>状态</span><input value={status} onChange={(event) => setStatus(event.target.value)} placeholder="例如 waiting" /></label><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={() => void runSearch()}>搜索</button></div>
    <LoadState loading={loading} error={error} empty={total === 0} />
    {data && <><p className="result-count">共找到 {total} 项</p>{data.groups.records.length > 0 && <section className="projection-section"><h3>正式记录 · {data.counts.records}</h3><div className="card-grid">{data.groups.records.map((record) => <RecordButton key={record.id} record={record} onOpen={onOpen} />)}</div></section>}{data.groups.sources.length > 0 && <section className="projection-section"><h3>原始来源 · {data.counts.sources}</h3>{data.groups.sources.map((source) => <article className="source-result" key={source.id}><p>{source.original_text || '仅附件来源'}</p><time>{new Date(source.captured_at).toLocaleString('zh-CN')}</time></article>)}</section>}{(['materials', 'vendors', 'spaces'] as const).map((group) => data.groups[group].length > 0 && <section className="projection-section" key={group}><h3>{{ materials: '材料', vendors: '商家', spaces: '空间' }[group]} · {data.counts[group]}</h3><div className="tag-list">{data.groups[group].map((item) => <span key={item.id}>{item.name}</span>)}</div></section>)}</>}
  </section>
}

function RecordDetail({ recordId, onClose }: { recordId: string; onClose: () => void }) {
  const [record, setRecord] = useState<ProjectionRecord | null>(null)
  const [sources, setSources] = useState<SourceDetail[]>([])
  const [relations, setRelations] = useState<RecordRelation[]>([])
  const [relatedRecords, setRelatedRecords] = useState<ProjectionRecord[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    Promise.all([getRecord(recordId), listRelations(recordId), listRecordAudit(recordId)])
      .then(async ([recordResult, relationRows, auditRows]) => {
        const sourceRows = await Promise.all(recordResult.source_refs.map((item) => getSource(item.source_id)))
        const relatedIds = Array.from(new Set(relationRows.flatMap((item) => [item.from_record_id, item.to_record_id]).filter((id) => id !== recordId)))
        const related = await Promise.all(relatedIds.map((id) => getRecord(id)))
        if (!active) return
        setRecord(recordResult); setSources(sourceRows); setRelations(relationRows); setRelatedRecords(related); setAudit(auditRows)
      }).catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : '详情加载失败'))
    return () => { active = false }
  }, [recordId])
  return <aside className="detail-panel" aria-label="记录详情"><div className="detail-panel__header"><div><p className="eyebrow">来源可追溯</p><h2>记录详情</h2></div><button type="button" onClick={onClose} aria-label="关闭详情">关闭</button></div>{error && <p role="alert" className="view-state--error">{error}</p>}{!record && !error && <p role="status">正在加载详情…</p>}{record && <><span className="record-type-tag">{typeLabels[record.record_type]}</span><h3>{record.title}</h3><p>{record.description || '暂无补充说明'}</p><dl className="detail-list"><div><dt>状态</dt><dd>{recordStatusLabel(record.record_type, record.status)}</dd></div><div><dt>时间精度</dt><dd>{record.time_precision || 'unknown'}</dd></div><div><dt>空间</dt><dd>{record.spaces?.map((item) => item.name).join('、') || '未指定'}</dd></div></dl><section><h4>原始来源与附件</h4>{sources.map((source) => <article className="evidence-card" key={source.id}><p>{source.original_text || '仅附件来源'}</p>{source.attachments.map((attachment) => <small key={attachment.id}>附件：{attachment.original_filename} · {Math.ceil(attachment.size_bytes / 1024)} KB</small>)}</article>)}</section><section><h4>关联记录</h4>{relations.length === 0 && <p className="muted">暂无显式关系。</p>}{relations.map((relation) => { const related = relatedRecords.find((item) => item.id === (relation.from_record_id === recordId ? relation.to_record_id : relation.from_record_id)); return <p className="relation-summary" key={relation.id}>{relationLabel(relation.relation_type)} · {related?.title || '关联记录'}</p> })}</section><section><h4>审计历史</h4>{audit.map((item) => <p className="audit-row" key={item.id}>{new Date(item.timestamp).toLocaleString('zh-CN')} · {item.action}</p>)}</section></>}
  </aside>
}

export function CoreViews({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewName>('capture')
  const [detailId, setDetailId] = useState('')
  return <div className="workspace-shell"><nav className="workspace-nav" aria-label="核心功能">{viewLabels.map((item) => <button key={item.key} type="button" className={view === item.key ? 'is-active' : ''} aria-current={view === item.key ? 'page' : undefined} onClick={() => { setView(item.key); setDetailId('') }}>{item.label}</button>)}</nav><div className="workspace-content">{view === 'capture' && children}{view === 'timeline' && <TimelineView onOpen={setDetailId} />}{view === 'ledger' && <LedgerView onOpen={setDetailId} />}{view === 'issues' && <IssuesView onOpen={setDetailId} />}{view === 'spaces' && <SpacesView onOpen={setDetailId} />}{view === 'search' && <SearchView onOpen={setDetailId} />}</div>{detailId && <RecordDetail recordId={detailId} onClose={() => setDetailId('')} />}</div>
}
