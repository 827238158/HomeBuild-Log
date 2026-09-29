import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Select } from './Select'
import { monthDateRange } from './time'

import { AiAnalyticsView, OverviewView, RecordsAnalyticsView } from './AnalyticsViews'
import { defaultPayload, payloadForSave, RecordEditFields, type RecordType } from './DomainWorkspace'
import { LazyEChart as EChart } from './LazyEChart'
import { PitfallsView } from './PitfallsView'
import { WorkspaceAtmosphere } from './WorkspaceAtmosphere'
import { chartPalette, chartSummary, donutOption, horizontalBarOption, lineOption } from './chartConfig'
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
  listRecords,
  listRelations,
  listSpaces,
  searchRecords,
  reviewRecordSource,
  updateRecord,
  type AuditEntry,
  type DomainRecord,
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
import { formatMoney } from './currency'
import { recordStatusLabel, recordTypeLabels } from './recordLabels'
import { statusesForRecordType } from './recordConfig'
import { beijingToday, formatBeijingDateTime, formatCalendarDate } from './time'

type ViewName = 'overview' | 'capture' | 'timeline' | 'ledger' | 'issues' | 'pitfalls' | 'spaces' | 'records' | 'ai' | 'search'

const viewLabels: Array<{ key: ViewName; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'capture', label: '录入' },
  { key: 'timeline', label: '时间线' },
  { key: 'ledger', label: '账本' },
  { key: 'issues', label: '问题' },
  { key: 'pitfalls', label: '踩坑记录' },
  { key: 'spaces', label: '空间' },
  { key: 'records', label: '记录分析' },
  { key: 'ai', label: 'AI 运行记录' },
  { key: 'search', label: '搜索' },
]

const viewGroups: Array<{ label: string; items: ViewName[] }> = [
  { label: '工作台', items: ['overview', 'capture'] },
  { label: '业务管理', items: ['timeline', 'ledger', 'issues', 'pitfalls', 'spaces'] },
  { label: '数据分析', items: ['records', 'ai'] },
  { label: '工具', items: ['search'] },
]

function NavIcon({ view }: { view: ViewName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
    {view === 'overview' && <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>}
    {view === 'capture' && <><path d="M12 5v14M5 12h14" /><circle cx="12" cy="12" r="9" /></>}
    {view === 'timeline' && <><path d="M7 3v18M7 7h8M7 12h11M7 17h6" /><circle cx="7" cy="7" r="1.5" /><circle cx="7" cy="12" r="1.5" /><circle cx="7" cy="17" r="1.5" /></>}
    {view === 'ledger' && <><path d="M4 7.5h14.5A1.5 1.5 0 0 1 20 9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" /><path d="M15 12h5v4h-5a2 2 0 0 1 0-4Z" /></>}
    {view === 'issues' && <><path d="m12 3 9 16H3L12 3Z" /><path d="M12 9v4" /><path d="M12 16h.01" /></>}
    {view === 'pitfalls' && <><path d="M9 3h6l1 3h3v15H5V6h3l1-3Z" /><path d="M9 11h6M9 15h4" /><path d="m16.5 14.5 1 1 2-2" /></>}
    {view === 'spaces' && <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>}
    {view === 'records' && <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>}
    {view === 'ai' && <><path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z" /><path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7L18 14Z" /></>}
    {view === 'search' && <><circle cx="11" cy="11" r="7" /><path d="m16.2 16.2 4 4" /></>}
  </svg>
}


const spaceKindLabels: Record<string, string> = { house: '房屋', room: '房间', component: '构件', surface: '表面' }
const auditActionLabels: Record<string, string> = { create: '创建记录', update: '修改内容', delete: '删除记录', archive: '隐藏记录', restore: '重新显示', review: '复核来源', confirm: '确认候选' }

function AnalyticsChart({
  title, rows, onClick, unit = '项', kind, description, selectedKey, onHover, onLeave, disableTooltip = false,
  verticalScrollAfter,
  itemColors,
  interactionHint,
}: {
  title: string
  rows: DistributionItem[]
  onClick?: (key: string) => void
  unit?: string
  kind: 'line' | 'bar' | 'donut'
  description: string
  selectedKey?: string
  onHover?: (event: { key: string; clientX: number; clientY: number; anchorRect: FloatingAnchorRect }) => void
  onLeave?: () => void
  disableTooltip?: boolean
  verticalScrollAfter?: number
  itemColors?: Record<string, string>
  interactionHint?: string
}) {
  const option = kind === 'line' ? lineOption(rows, unit)
    : kind === 'donut' ? donutOption(rows, unit, !disableTooltip)
    : horizontalBarOption(rows, unit, false, !disableTooltip, itemColors)
  // 类目超过可读阈值后增加真实画布高度，由共享图表容器负责限高滚动。
  const scrollable = verticalScrollAfter !== undefined && rows.length > verticalScrollAfter
  return <EChart title={title} description={description} kind={kind} option={option} summary={chartSummary(title, rows, unit)} onDataClick={onClick} onDataHover={onHover} onDataLeave={onLeave} selectedKey={selectedKey} interactionHint={interactionHint} scrollableContentHeight={scrollable ? Math.max(290, rows.length * 42) : undefined} scrollableMaxHeight={scrollable ? 360 : undefined} />
}

function LoadState({ loading, error, empty }: { loading: boolean; error: string; empty?: boolean }) {
  if (loading) return <p className="view-state" role="status">正在加载…</p>
  if (error) return <p className="view-state view-state--error" role="alert">{error}</p>
  if (empty) return <p className="view-state">暂无符合条件的记录。</p>
  return null
}

function RecordButton({ record, onOpen }: { record: ProjectionRecord; onOpen: (id: string) => void }) {
  return (
    <button className="projection-card immersive-tilt immersive-glass" type="button" onClick={() => onOpen(record.id)}>
      <span className="record-type-tag">{recordTypeLabels[record.record_type] || '未知类型'}</span>
      <strong>{record.title}</strong>
      <span>{recordStatusLabel(record.record_type, record.status, record.ledger_kind)}</span>
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
    <label className="field-stack"><span>空间</span><Select value={spaceId} onChange={(event) => onSpace(event.target.value)}><option value="">全部空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
    <label className="field-stack"><span>装修阶段</span><Select value={stageId} onChange={(event) => onStage(event.target.value)}><option value="">全部阶段</option>{stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
  </>
}

function TimelineView({ onOpen, refreshRevision }: { onOpen: (id: string) => void; refreshRevision: number }) {
  const timelineBatchSize = 10
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
  const [visibleCount, setVisibleCount] = useState(timelineBatchSize)
  const [showBackToTop, setShowBackToTop] = useState(false)
  // 输入框只编辑草稿；请求和图表标签始终使用已应用条件。
  const [applied, setApplied] = useState({ q: '', record_type: '', space_id: '', stage_id: '', date_from: '', date_to: '' })
  const [selectedMonth, setSelectedMonth] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      getTimeline(applied),
      listSpaces(), listEntities('stages'),
    ]).then(([result, spaceRows, stageRows]) => {
      if (!active) return
      setData(result); setSpaces(spaceRows); setStages(stageRows); setError('')
    }).catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : '时间线加载失败'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [reload, applied, refreshRevision])

  const applyRecordTypeImmediately = (nextRecordType: string) => {
    // 图表筛选和取消操作需要立即重新请求，不再等待“应用筛选”按钮。
    setRecordType(nextRecordType)
    setVisibleCount(timelineBatchSize)
    setApplied((current) => ({ ...current, record_type: nextRecordType }))
  }

  const applyMonth = (month: string) => {
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return
    const range = month ? monthDateRange(month) : { date_from: '', date_to: '' }
    setDateFrom(range.date_from); setDateTo(range.date_to); setSelectedMonth(month)
    setVisibleCount(timelineBatchSize)
    setApplied((current) => ({ ...current, ...range }))
  }

  const applyForm = () => {
    setSelectedMonth('')
    setVisibleCount(timelineBatchSize)
    setApplied({ q, record_type: recordType, space_id: spaceId, stage_id: stageId, date_from: dateFrom, date_to: dateTo })
    setReload((value) => value + 1)
  }

  const totalTimelineItems = useMemo(
    () => data?.groups.reduce((total, group) => total + group.items.length, 0) ?? 0,
    [data],
  )
  const visibleGroups = useMemo(() => {
    let remaining = visibleCount
    return (data?.groups ?? []).map((group) => {
      const items = group.items.slice(0, Math.max(0, remaining))
      remaining -= items.length
      return { ...group, items }
    }).filter((group) => group.items.length > 0)
  }, [data, visibleCount])
  const motionGroups = useMemo(() => {
    let motionIndex = 0
    return visibleGroups.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ item, motionIndex: motionIndex++ })),
    }))
  }, [visibleGroups])
  useEffect(() => {
    const update = () => setShowBackToTop(window.scrollY > 320)
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return <section className="view-panel"><header><h2>装修时间线</h2></header>
    <div className="filter-grid"><label className="field-stack"><span>关键词</span><input value={q} onChange={(event) => setQ(event.target.value)} /></label><label className="field-stack"><span>记录类型</span><Select value={recordType} onChange={(event) => setRecordType(event.target.value)}><option value="">全部类型</option>{Object.entries(recordTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label><ReferenceFilters spaces={spaces} stages={stages} spaceId={spaceId} stageId={stageId} onSpace={setSpaceId} onStage={setStageId} /><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={applyForm}>应用筛选</button></div>
    <LoadState loading={loading} error={error} empty={data?.total === 0} />
    {data && data.total > 0 && <div className="chart-grid"><AnalyticsChart title="记录时间趋势" description="" kind="line" rows={data.analytics.time_trend} onClick={applyMonth} selectedKey={selectedMonth} /><AnalyticsChart title="记录类型分布" description="" kind="donut" rows={data.analytics.type_distribution} onClick={applyRecordTypeImmediately} selectedKey={applied.record_type} /></div>}
    {applied.record_type && <button type="button" className="clear-filter" onClick={() => applyRecordTypeImmediately('')}>当前按记录类型筛选，点击取消</button>}
    {(applied.date_from || applied.date_to) && <button type="button" className="clear-filter" onClick={() => applyMonth('')}>当前日期：{applied.date_from || '不限'} 至 {applied.date_to || '不限'}，点击取消</button>}
    <div className="timeline-list">{motionGroups.map((group) => <section className="timeline-group" key={group.date_key}><h3>{group.label}</h3><div className="timeline-day-items">{group.items.map(({ item, motionIndex }) => <article className="timeline-item timeline-motion-item" data-motion-index={motionIndex} style={{ '--motion-index': motionIndex } as CSSProperties} key={item.record.id}><RecordButton record={item.record} onOpen={onOpen} />{item.related_records.length > 0 && <div className="related-strip"><span>关联事实</span>{item.related_records.map((record) => <RecordButton key={record.id} record={record} onOpen={onOpen} />)}</div>}</article>)}</div></section>)}</div>
    {visibleCount < totalTimelineItems && <button type="button" className="timeline-load-more" onClick={() => setVisibleCount((count) => Math.min(count + timelineBatchSize, totalTimelineItems))}>查看更多</button>}
    {showBackToTop && <button type="button" className="timeline-back-to-top" aria-label="回到顶部" onClick={() => window.scrollTo({ top: 0, left: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>}
  </section>
}

type LedgerDetailGroup = {
  id: string
  title: string
  amountMinor: number
  percentage?: number | null
  records: ProjectionRecord[]
  previewLimit: number
}

type LedgerPreviewState = {
  group: LedgerDetailGroup
  anchorRect: FloatingAnchorRect
}

type FloatingAnchorRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function calculatePreviewPosition(
  anchor: FloatingAnchorRect,
  floatingWidth: number,
  floatingHeight: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const offset = 8
  const boundary = 8
  const candidates = [
    { placement: 'bottom-start', left: anchor.left, top: anchor.bottom + offset },
    { placement: 'right-start', left: anchor.right + offset, top: anchor.top },
    { placement: 'top-start', left: anchor.left, top: anchor.top - floatingHeight - offset },
    { placement: 'left-start', left: anchor.left - floatingWidth - offset, top: anchor.top },
  ]
  const fitting = candidates.find(({ left, top }) => (
    left >= boundary && top >= boundary
    && left + floatingWidth <= viewportWidth - boundary
    && top + floatingHeight <= viewportHeight - boundary
  )) ?? candidates[0]
  return {
    placement: fitting.placement,
    left: Math.max(boundary, Math.min(fitting.left, viewportWidth - floatingWidth - boundary)),
    top: Math.max(boundary, Math.min(fitting.top, viewportHeight - floatingHeight - boundary)),
  }
}

function useCompactLedgerInteraction() {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(hover: none), (pointer: coarse), (max-width: 720px)')
    const update = () => setCompact(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return compact
}

function ledgerRecordSummary(record: ProjectionRecord) {
  const direction = record.direction === 'expense' ? '支出'
    : record.direction === 'refund' ? '退款'
      : record.direction === 'income' ? '收入' : '流水'
  return `${direction} ${formatMoney(record.amount_minor ?? 0)}`
}

function isEffectiveLedger(record: ProjectionRecord) {
  return (record.ledger_kind === 'payment' && record.direction === 'expense' && record.status === 'paid')
    || (record.ledger_kind === 'refund' && record.direction === 'refund' && record.status === 'posted')
    || (record.ledger_kind === 'income' && record.direction === 'income' && record.status === 'posted')
}

function LedgerDetailPreview({
  state, onEnter, onLeave, onViewAll,
}: {
  state: LedgerPreviewState
  onEnter: () => void
  onLeave: () => void
  onViewAll: () => void
}) {
  const { group } = state
  const previewRef = useRef<HTMLElement>(null)
  const [position, setPosition] = useState(() => ({ left: state.anchorRect.left, top: state.anchorRect.bottom + 8, placement: 'bottom-start' }))
  useLayoutEffect(() => {
    const node = previewRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const width = rect.width || Math.min(340, window.innerWidth - 16)
    const height = rect.height || Math.min(360, window.innerHeight - 16)
    setPosition(calculatePreviewPosition(state.anchorRect, width, height, window.innerWidth, window.innerHeight))
  }, [state.anchorRect, group.id])
  const style = { '--preview-left': `${position.left}px`, '--preview-top': `${position.top}px` } as CSSProperties
  // Portal 到 body，确保 fixed 定位与 getBoundingClientRect 都使用视口坐标系。
  return createPortal(<aside ref={previewRef} className="ledger-detail-preview" data-placement={position.placement} style={style} onMouseEnter={onEnter} onMouseLeave={onLeave} aria-label={`${group.title}明细预览`}>
    <header><div><strong>{group.title}</strong><span>{formatMoney(group.amountMinor)}</span></div>{group.percentage !== undefined && <small>占比：{group.percentage === null ? '无法计算' : `${group.percentage.toFixed(1)}%`}</small>}</header>
    <p>共 {group.records.length} 条记录</p>
    <ul>{group.records.slice(0, group.previewLimit).map((record) => <li key={record.id}><strong>{record.title}</strong><span>{ledgerRecordSummary(record)}</span></li>)}</ul>
    {group.records.length === 0 && <p className="muted">暂无对应记录</p>}
    <button type="button" onClick={onViewAll}>查看全部明细</button>
  </aside>, document.body)
}

function LedgerDetailPanel({
  group, obscured, onClose, onOpenRecord,
}: {
  group: LedgerDetailGroup
  obscured: boolean
  onClose: () => void
  onOpenRecord: (id: string) => void
}) {
  // 挂载到 body，避免看板祖先的 transform/overflow 改变 fixed 定位参照。
  return createPortal(<>
    {!obscured && <button type="button" className="ledger-detail-backdrop" aria-label="点击遮罩关闭明细" onClick={onClose} />}
    <aside className={`detail-panel ledger-detail-panel immersive-glass immersive-glass--strong${obscured ? ' is-obscured' : ''}`} role="dialog" aria-modal={!obscured} aria-hidden={obscured} aria-labelledby="ledger-detail-title">
      <header className="detail-panel__header ledger-detail-panel__header"><div><p className="eyebrow">完整明细</p><h2 id="ledger-detail-title">{group.title}</h2></div><button type="button" onClick={onClose} aria-label="关闭明细" autoFocus={!obscured}>关闭</button></header>
      <div className="ledger-detail-panel__summary"><strong>{formatMoney(group.amountMinor)}</strong><span>{group.records.length} 条记录</span>{group.percentage !== undefined && <span>占比 {group.percentage === null ? '无法计算' : `${group.percentage.toFixed(1)}%`}</span>}</div>
      <div className="ledger-detail-panel__records">
        {group.records.length === 0 && <p className="muted">暂无对应记录。</p>}
        {group.records.map((record) => <button type="button" className="ledger-detail-record" key={record.id} onClick={() => onOpenRecord(record.id)}><strong>{record.title}</strong><span>{ledgerRecordSummary(record)}</span><small>{record.occurred_date || recordStatusLabel(record.record_type, record.status, record.ledger_kind)}</small></button>)}
      </div>
    </aside>
  </>, document.body)
}

function LedgerView({ onOpen, detailOpen, refreshRevision }: { onOpen: (id: string) => void; detailOpen: boolean; refreshRevision: number }) {
  const [data, setData] = useState<LedgerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<LedgerPreviewState | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const closeTimer = useRef<number | null>(null)
  const compactInteraction = useCompactLedgerInteraction()
  useEffect(() => {
    let active = true
    setLoading(true)
    getLedgerSummary()
      .then((result) => { if (active) { setData(result); setError('') } })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : '账本加载失败'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [refreshRevision])
  const hasSelectedGroup = selectedGroupId !== null
  useEffect(() => {
    if (!hasSelectedGroup) return
    const previousOverflow = document.body.style.overflow
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      returnFocus?.focus()
    }
  }, [hasSelectedGroup])
  useEffect(() => {
    if (!selectedGroupId) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !detailOpen) setSelectedGroupId(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [selectedGroupId, detailOpen])

  const groups = useMemo(() => {
    if (!data) return new Map<string, LedgerDetailGroup>()
    const posted = data.ledger_entries.filter(isEffectiveLedger)
    const payments = posted.filter((record) => record.direction === 'expense')
    const refunds = posted.filter((record) => record.direction === 'refund')
    const incomes = posted.filter((record) => record.direction === 'income')
    const result = new Map<string, LedgerDetailGroup>()
    const add = (group: LedgerDetailGroup) => result.set(group.id, group)
    add({ id: 'card:expense', title: '付款总额', amountMinor: data.totals.expense_minor, records: payments, previewLimit: 5 })
    add({ id: 'card:refund', title: '退款总额', amountMinor: data.totals.refund_minor, records: refunds, previewLimit: 5 })
    add({ id: 'card:income', title: '收入总额', amountMinor: data.totals.income_minor, records: incomes, previewLimit: 5 })
    add({ id: 'card:net-expense', title: '净支出', amountMinor: data.totals.net_expense_minor, records: posted, previewLimit: 5 })
    const compositionTotal = data.analytics.payment_composition.reduce((sum, item) => sum + item.value, 0)
    data.analytics.payment_composition.forEach((item) => add({
      id: `composition:${item.key}`, title: item.label, amountMinor: item.value,
      percentage: compositionTotal === 0 ? null : item.value / compositionTotal * 100,
      records: item.key === 'refund' ? refunds : item.key === 'income' ? incomes : payments, previewLimit: 3,
    }))
    data.analytics.vendor_distribution.forEach((item) => add({
      id: `vendor:${item.key}`, title: item.label, amountMinor: item.value,
      percentage: data.totals.expense_minor === 0 ? null : item.value / data.totals.expense_minor * 100,
      records: posted.filter((record) => record.vendor?.name === item.key), previewLimit: 3,
    }))
    return result
  }, [data])
  // 明细只保留分组标识，编辑或删除后的内容始终来自最新账本数据。
  const selectedGroup = selectedGroupId ? groups.get(selectedGroupId) : undefined
  useEffect(() => {
    if (selectedGroupId && !loading && !groups.has(selectedGroupId)) setSelectedGroupId(null)
  }, [selectedGroupId, loading, groups])
  const monthlyNetExpense = useMemo(() => (data?.analytics.money_trend ?? []).map((item) => ({
    key: item.key,
    label: item.label,
    // 后端金额单位为分，折线图统一展示人民币元。
    value: (item.expense_minor - item.refund_minor - item.income_minor) / 100,
  })), [data])

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setPreview(null), 160)
  }
  const openGroup = (group: LedgerDetailGroup) => {
    cancelClose(); setPreview(null); setSelectedGroupId(group.id)
  }
  const showPreview = (group: LedgerDetailGroup, anchorRect: FloatingAnchorRect) => {
    if (compactInteraction) return
    cancelClose()
    setPreview({ group, anchorRect })
  }
  const cardHandlers = (group: LedgerDetailGroup) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      showPreview(group, rect)
    },
    onMouseLeave: scheduleClose,
    onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      showPreview(group, rect)
    },
    onBlur: scheduleClose,
    onClick: () => openGroup(group),
  })
  const chartHover = (prefix: 'composition' | 'vendor') => (event: { key: string; clientX: number; clientY: number; anchorRect: FloatingAnchorRect }) => {
    const group = groups.get(`${prefix}:${event.key}`)
    if (group) showPreview(group, event.anchorRect)
  }
  const chartClick = (prefix: 'composition' | 'vendor') => (key: string) => {
    const group = groups.get(`${prefix}:${key}`)
    if (group) openGroup(group)
  }

  return <section className="view-panel"><header><h2>装修账本</h2></header>
    <LoadState loading={loading} error={error} empty={data ? data.ledger_entries.length === 0 : false} />
    {data && <><div className="summary-grid summary-grid--money">{[
      ['card:expense', 'summary-card--info'],
      ['card:refund', 'summary-card--success'],
      ['card:income', 'summary-card--success'],
      ['card:net-expense', ''],
    ].map(([id, variant]) => { const group = groups.get(id)!; return <button className={`summary-card summary-card--interactive immersive-glass immersive-tilt ${variant}`} type="button" key={id} {...cardHandlers(group)}><span>{group.title}</span><strong>{formatMoney(group.amountMinor)}</strong></button> })}</div><details className="ledger-calculation-help"><summary>净支出怎么算？</summary><p>净支出 = 付款 − 退款 − 收入。</p></details></>}
    {data && (data.analytics.payment_composition.length > 0 || data.analytics.vendor_distribution.length > 0) && <div className="chart-grid"><AnalyticsChart title="资金构成" interactionHint="点击图形查看明细记录" description="" kind="donut" unit="元" rows={data.analytics.payment_composition.map((item) => ({ ...item, value: item.value / 100 }))} onHover={chartHover('composition')} onLeave={scheduleClose} onClick={chartClick('composition')} disableTooltip /><AnalyticsChart title="主要商家金额" interactionHint="点击图形查看明细记录" description="支出为正，退款与收入为负" kind="bar" unit="元" rows={data.analytics.vendor_distribution.map((item) => ({ ...item, value: item.value / 100 }))} onHover={chartHover('vendor')} onLeave={scheduleClose} onClick={chartClick('vendor')} disableTooltip verticalScrollAfter={8} /></div>}
    {monthlyNetExpense.length > 0 && <div className="chart-grid chart-grid--single"><AnalyticsChart title="每月净支出趋势" description="按月统计付款减退款与收入后的净支出" kind="line" unit="元" rows={monthlyNetExpense} /></div>}
    {preview && <LedgerDetailPreview state={preview} onEnter={cancelClose} onLeave={scheduleClose} onViewAll={() => openGroup(preview.group)} />}
    {selectedGroup && <LedgerDetailPanel group={selectedGroup} obscured={detailOpen} onClose={() => setSelectedGroupId(null)} onOpenRecord={onOpen} />}
  </section>
}

function IssuesView({ onOpen, refreshRevision }: { onOpen: (id: string) => void; refreshRevision: number }) {
  const [data, setData] = useState<IssueBoardResponse | null>(null)
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [spaceId, setSpaceId] = useState('')
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState({ space_id: '', status: '', severity: '' })
  const statusLabels: Record<string, string> = { pending: '待处理', in_progress: '处理中', done: '已完成' }
  const severityLabels: Record<string, string> = { low: '低', medium: '中', high: '高' }
  const applyChart = (field: 'status' | 'severity', value: string) => setApplied((current) => ({ ...current, [field]: value }))
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([getIssueBoard(applied), listSpaces()])
      .then(([result, rows]) => { if (active) { setData(result); setSpaces(rows); setError('') } })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : '问题看板加载失败'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [reload, applied, refreshRevision])
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
  return <section className="view-panel"><div className="issue-page-header"><header><h2>问题看板</h2></header>
    <div className="filter-grid issue-filter-bar"><label className="field-stack"><span>空间</span><Select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">全部空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label><button className="filter-button" type="button" onClick={() => { setApplied((current) => ({ ...current, space_id: spaceId })); setReload((value) => value + 1) }}>应用筛选</button></div></div>
    <LoadState loading={loading} error={error} empty={data?.total === 0} />
    {data && data.total > 0 && <div className="chart-grid"><AnalyticsChart title="问题状态分布" description="" kind="donut" rows={data.analytics.status_distribution} onClick={(key) => applyChart('status', key)} selectedKey={applied.status} /><AnalyticsChart title="问题严重程度" description="" kind="bar" rows={data.analytics.severity_distribution} onClick={(key) => applyChart('severity', key)} selectedKey={applied.severity} itemColors={{ high: chartPalette.risk }} /></div>}
    {applied.status && <button type="button" className="clear-filter" onClick={() => applyChart('status', '')}>状态：{statusLabels[applied.status] || applied.status}，点击取消</button>}
    {applied.severity && <button type="button" className="clear-filter" onClick={() => applyChart('severity', '')}>严重程度：{severityLabels[applied.severity] || applied.severity}，点击取消</button>}
    {(applied.status || applied.severity) && <button type="button" className="clear-filter" onClick={() => setApplied((current) => ({ ...current, status: '', severity: '' }))}>清除全部图表筛选</button>}
    <div className="issue-board">{data?.columns.filter((column) => !applied.status || column.status === applied.status).map((column) => <section className="issue-column" key={column.status}><h3>{column.label}<span>{column.items.length}</span></h3><div className="issue-column__body">{column.items.length === 0 && <p className="muted">暂无</p>}{column.items.map((record) => <article className="issue-card" key={record.id} data-severity={record.severity}><button type="button" className="title-button" onClick={() => onOpen(record.id)}><strong>{record.title}</strong></button><p>{record.phenomenon}</p>{record.spaces.length > 0 && <small>{record.spaces.map((item) => item.name).join(' · ')}</small>}<label className="field-stack"><span>处理状态</span><Select value={record.status} onChange={(event) => void changeStatus(record, event.target.value)}>{data.columns.map((item) => <option key={item.status} value={item.status}>{item.label}</option>)}</Select></label></article>)}</div></section>)}</div>
  </section>
}

function SpacesView({ onOpen, refreshRevision }: { onOpen: (id: string) => void; refreshRevision: number }) {
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
  }, [spaceId, refreshRevision])
  return <section className="view-panel"><header><h2>空间档案</h2></header>
    <label className="field-stack space-picker"><span>选择空间</span><Select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">请选择空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name} · {spaceKindLabels[item.kind] || '其他空间'}</option>)}</Select></label>
    <LoadState loading={loading} error={error} empty={!loading && spaces.length === 0} />
    {data && <><p className="breadcrumbs">{data.breadcrumbs.map((item) => item.name).join(' / ')}</p><div className="space-overview"><div><span className="record-type-tag">当前空间</span><h3>{data.space.name}</h3><p>含上级区域的公共记录、当前区域及下属区域记录</p></div><dl><div><dt>记录</dt><dd>{data.summary.record_count}</dd></div><div><dt>未关闭问题</dt><dd>{data.summary.unclosed_issue_count}</dd></div><div><dt>尺寸</dt><dd>{data.summary.measurement_count}</dd></div><div><dt>材料</dt><dd>{data.summary.material_count}</dd></div><div><dt>净支出</dt><dd>{formatMoney(data.analytics.net_expense_minor)}</dd></div></dl></div>{data.analytics.type_distribution.length > 0 && <div className="chart-grid"><AnalyticsChart title="空间记录类型" description="" kind="donut" rows={data.analytics.type_distribution} onClick={setTypeFilter} selectedKey={typeFilter} /><AnalyticsChart title="空间问题状态" description="查看该空间问题的处理进度" kind="bar" rows={data.analytics.issue_status_distribution} /></div>}{typeFilter && <button type="button" className="clear-filter" onClick={() => setTypeFilter('')}>当前按记录类型筛选，点击取消</button>}{Object.entries(data.records_by_type).filter(([type]) => !typeFilter || type === typeFilter).map(([type, records]) => <section className="projection-section" key={type}><h3>{recordTypeLabels[type] || '未知类型'}</h3><div className="card-grid">{records.map((record) => <RecordButton key={record.id} record={record} onOpen={onOpen} />)}</div></section>)}</>}
  </section>
}

function SearchView({ onOpen, refreshRevision }: { onOpen: (id: string) => void; refreshRevision: number }) {
  const [q, setQ] = useState('')
  const [recordType, setRecordType] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [data, setData] = useState<SearchResponse | null>(null)
  const submittedParams = useRef<Record<string, string> | null>(null)
  const searchRevision = useRef(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestSearch = async (params: Record<string, string>) => {
    // 手动搜索和编辑后刷新共用序号，只有最新请求能够更新结果和加载状态。
    const revision = ++searchRevision.current
    setLoading(true)
    try {
      const result = await searchRecords(params)
      if (revision !== searchRevision.current) return
      setData(result)
      setError('')
    } catch (reason: unknown) {
      if (revision === searchRevision.current) setError(reason instanceof Error ? reason.message : '搜索失败')
    } finally {
      if (revision === searchRevision.current) setLoading(false)
    }
  }
  const runSearch = () => {
    const params = { q, record_type: recordType, status, date_from: dateFrom, date_to: dateTo }
    submittedParams.current = params
    return requestSearch(params)
  }
  useEffect(() => () => { searchRevision.current += 1 }, [])
  useEffect(() => {
    if (!submittedParams.current || refreshRevision === 0) return
    void requestSearch(submittedParams.current)
  }, [refreshRevision])
  const total = useMemo(() => data ? Object.values(data.counts).reduce((sum, count) => sum + count, 0) : null, [data])
  return <section className="view-panel"><header><h2>搜索</h2></header>
    <div className="filter-grid"><label className="field-stack"><span>关键词</span><input value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch() }} placeholder="例如：花砖、主卧、门套" /></label><label className="field-stack"><span>记录类型</span><Select value={recordType} onChange={(event) => { setRecordType(event.target.value); setStatus('') }}><option value="">全部类型</option>{Object.entries(recordTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label><label className="field-stack"><span>状态</span><Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{statusesForRecordType(recordType).map((value) => <option key={value} value={value}>{recordStatusLabel(recordType, value)}</option>)}</Select></label><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={() => void runSearch()}>搜索</button></div>
    <LoadState loading={loading} error={error} empty={total === 0} />
    {data && <><p className="result-count">共找到 {total} 项</p>{data.groups.records.length > 0 && <section className="projection-section"><h3>正式记录 · {data.counts.records}</h3><div className="card-grid">{data.groups.records.map((record) => <RecordButton key={record.id} record={record} onOpen={onOpen} />)}</div></section>}{data.groups.sources.length > 0 && <section className="projection-section"><h3>原始来源 · {data.counts.sources}</h3>{data.groups.sources.map((source) => <article className="source-result" key={source.id}><p>{source.original_text || '仅附件来源'}</p><time>{formatBeijingDateTime(source.captured_at)}</time></article>)}</section>}{(['materials', 'vendors', 'spaces'] as const).map((group) => data.groups[group].length > 0 && <section className="projection-section" key={group}><h3>{{ materials: '材料', vendors: '商家', spaces: '空间' }[group]} · {data.counts[group]}</h3><div className="tag-list">{data.groups[group].map((item) => <span key={item.id}>{item.name}</span>)}</div></section>)}</>}
  </section>
}

function RecordDetail({ recordId, closing, onClose, onChanged, onExitComplete }: { recordId: string; closing: boolean; onClose: () => void; onChanged: () => void; onExitComplete: () => void }) {
  const [record, setRecord] = useState<ProjectionRecord | null>(null)
  const [sources, setSources] = useState<SourceDetail[]>([])
  const [relations, setRelations] = useState<RecordRelation[]>([])
  const [relatedRecords, setRelatedRecords] = useState<ProjectionRecord[]>([])
  const [allRecords, setAllRecords] = useState<DomainRecord[]>([])
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
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => returnFocus?.focus()
  }, [])
  useEffect(() => {
    let active = true
    Promise.all([
      getRecord(recordId), listRelations(recordId), listRecordAudit(recordId), listSpaces(), listRecords(undefined),
      listEntities('materials'), listEntities('vendors'), listEntities('participants'), listEntities('stages'),
    ])
      .then(async ([recordResult, relationRows, auditRows, spaceRows, recordRows, materials, vendors, participants, stages]) => {
        const sourceRows = await Promise.all(recordResult.source_refs.map((item) => getSource(item.source_id)))
        const relatedIds = Array.from(new Set(relationRows.flatMap((item) => [item.from_record_id, item.to_record_id]).filter((id) => id !== recordId)))
        const related = await Promise.all(relatedIds.map((id) => getRecord(id)))
        if (!active) return
        setRecord(recordResult); setSources(sourceRows); setRelations(relationRows); setRelatedRecords(related); setAudit(auditRows)
        setSpaces(spaceRows); setAllRecords(recordRows); setEditEntities({ materials, vendors, participants, stages })
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

  return <aside className={`detail-panel record-detail-panel immersive-glass immersive-glass--strong${closing ? ' is-closing' : ''}`} data-state={closing ? 'closing' : 'open'} aria-label="记录详情" onAnimationEnd={(event) => {
    // 只响应抽屉本身的退出，避免子元素动画冒泡提前结束过渡。
    if (closing && event.target === event.currentTarget) onExitComplete()
  }}>
    <div className="detail-panel__header"><div><h2>{editing ? '修改记录' : '记录详情'}</h2></div>{!editing && <button type="button" onClick={onClose} aria-label="关闭详情">关闭</button>}</div>
    {error && <p role="alert" className="view-state--error">{error}</p>}
    {!record && !error && <p role="status">正在加载详情…</p>}
    {record && editing ? <section className="detail-edit-section"><RecordEditFields recordType={record.record_type as RecordType} payload={editPayload} spaces={spaces} entities={editEntities} records={allRecords} currentRecordId={record.id} onChange={changeEditField} /><div className="record-actions"><button type="button" disabled={busy} onClick={() => void saveEdit()}>{busy ? '保存中…' : '保存修改'}</button><button type="button" disabled={busy} onClick={cancelEdit}>取消</button></div></section> : record && <>
      <div className="detail-record-actions"><button type="button" disabled={busy} onClick={beginEdit}>修改记录</button><button className="danger-button" type="button" disabled={busy} onClick={() => void removeRecord()}>删除记录</button></div>
      <span className="record-type-tag">{recordTypeLabels[record.record_type]}</span>
      <h3>{record.title}</h3>
      <p>{record.description || '暂无补充说明'}</p>
      <dl className="detail-list">
        <div><dt>状态</dt><dd>{recordStatusLabel(record.record_type, record.status, record.ledger_kind)}</dd></div>
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
      <section><h4>相关记录</h4>{relations.length === 0 && <p className="muted">暂无相关记录。</p>}{relations.map((relation) => { const related = relatedRecords.find((item) => item.id === (relation.from_record_id === recordId ? relation.to_record_id : relation.from_record_id)); return <p className="relation-summary" key={relation.id}>{related?.title || '相关记录'}</p> })}</section>
      <section><h4>操作记录</h4><p className="muted">这里记录数据如何变化：“隐藏记录”只是从常用视图隐藏，“重新显示”会让它再次出现；它们都不会删除历史。</p>{audit.map((item) => <p className="audit-row" key={item.id}>{formatBeijingDateTime(item.timestamp)} · {auditActionLabels[item.action] || '数据操作'}</p>)}</section>
    </>}
  </aside>
}

export function CoreViews({ children, onLogout }: { children: ReactNode; onLogout?: () => void }) {
  const [view, setView] = useState<ViewName>('overview')
  const [detailId, setDetailId] = useState('')
  const [detailClosing, setDetailClosing] = useState(false)
  const [viewRevision, setViewRevision] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  const detailCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentLabel = viewLabels.find((item) => item.key === view)?.label ?? '工作台'
  const finishDetailClose = () => {
    if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current)
    detailCloseTimer.current = null
    setDetailId('')
    setDetailClosing(false)
  }
  const closeDetail = () => {
    if (!detailId || detailClosing) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finishDetailClose()
      return
    }
    setDetailClosing(true)
    // CSS 动画结束会立即卸载；定时器只在 animationend 丢失时兜底。
    detailCloseTimer.current = setTimeout(finishDetailClose, 220)
  }
  const openDetail = (recordId: string) => {
    if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current)
    detailCloseTimer.current = null
    setDetailClosing(false)
    setDetailId(recordId)
  }
  useEffect(() => () => {
    if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current)
  }, [])
  const selectView = (next: ViewName) => { setView(next); finishDetailClose(); setNavOpen(false) }
  return <div className="workspace-shell">
    <aside className={`workspace-sidebar${navOpen ? ' is-open' : ''}`}>
      <div className="workspace-brand"><span className="workspace-brand__mark">H</span><div><strong>HomeBuild Log</strong><small>装修事实工作台</small></div></div>
      <nav className="workspace-nav" aria-label="核心功能">{viewGroups.map((group) => <section key={group.label}><h2>{group.label}</h2>{group.items.map((key) => { const item = viewLabels.find((entry) => entry.key === key)!; return <button key={key} type="button" className={view === key ? 'is-active' : ''} aria-current={view === key ? 'page' : undefined} onClick={() => selectView(key)}><span aria-hidden="true"><NavIcon view={key} /></span>{item.label}</button> })}</section>)}</nav>
      <footer className="workspace-sidebar__footer"><p><span className="service-dot" />本地服务运行正常</p>{onLogout && <button type="button" onClick={onLogout}>退出登录</button>}</footer>
    </aside>
    {navOpen && <button type="button" className="nav-backdrop" aria-label="关闭导航" onClick={() => setNavOpen(false)} />}
    <div className="workspace-main">
      <WorkspaceAtmosphere />
      <header className="workspace-topbar immersive-glass"><button type="button" className="menu-button" aria-label="打开导航" aria-expanded={navOpen} onClick={() => setNavOpen((value) => !value)}>☰</button><div><small>HomeBuild Log</small><strong>{currentLabel}</strong></div><span><span className="service-dot" />服务正常</span></header>
      <main className="workspace-content">{view === 'overview' && <OverviewView onOpen={openDetail} refreshRevision={viewRevision} />}{view === 'capture' && children}{view === 'timeline' && <TimelineView onOpen={openDetail} refreshRevision={viewRevision} />}{view === 'ledger' && <LedgerView onOpen={openDetail} detailOpen={Boolean(detailId)} refreshRevision={viewRevision} />}{view === 'issues' && <IssuesView onOpen={openDetail} refreshRevision={viewRevision} />}{view === 'pitfalls' && <PitfallsView />}{view === 'spaces' && <SpacesView onOpen={openDetail} refreshRevision={viewRevision} />}{view === 'records' && <RecordsAnalyticsView onOpen={openDetail} refreshRevision={viewRevision} />}{view === 'ai' && <AiAnalyticsView />}{view === 'search' && <SearchView onOpen={openDetail} refreshRevision={viewRevision} />}</main>
    </div>
    {/* 切换记录时重新建立详情状态，避免沿用上一条记录的编辑草稿。 */}
    {detailId && <RecordDetail key={detailId} recordId={detailId} closing={detailClosing} onClose={closeDetail} onExitComplete={finishDetailClose} onChanged={() => setViewRevision((value) => value + 1)} />}
  </div>
}
