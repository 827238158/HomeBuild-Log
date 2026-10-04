import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Select } from './Select'
import { RecordDetail } from './RecordDetail'
import { useModalFocus } from './useModalFocus'
import { confirmNavigation, useNavigationGuard } from './navigationGuard'
import './ui-hardening.css'
import { monthDateRange } from './time'

import { AiAnalyticsView, OverviewView, RecordsAnalyticsView } from './AnalyticsViews'
import { LazyEChart as EChart } from './LazyEChart'
import { PitfallsView } from './PitfallsView'
import { ResearchView } from './ResearchView'
import { WorkspaceAtmosphere } from './WorkspaceAtmosphere'
import { chartPalette, chartSummary, donutOption, horizontalBarOption, lineOption } from './chartConfig'
import {
  getIssueBoard,
  getLedgerSummary,
  getSpaceArchive,
  getTimeline,
  listEntities,
  listSpaces,
  searchRecords,
  updateRecord,
  type IssueBoardResponse,
  type LedgerResponse,
  type NamedEntity,
  type ProjectionRecord,
  type SearchResponse,
  type SpaceArchiveResponse,
  type SpaceEntry,
  type TimelineResponse,
  type DistributionItem,
} from './domainApi'
import { formatMoney } from './currency'
import { recordStatusLabel, recordTypeLabels } from './recordLabels'
import { recordConfig, statusesForRecordType } from './recordConfig'
import { formatBeijingDateTime } from './time'

type ViewName = 'overview' | 'capture' | 'timeline' | 'ledger' | 'issues' | 'pitfalls' | 'research' | 'spaces' | 'records' | 'ai' | 'search'

const viewLabels: Array<{ key: ViewName; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'capture', label: '录入' },
  { key: 'timeline', label: '时间线' },
  { key: 'ledger', label: '账本' },
  { key: 'issues', label: '待办与问题' },
  { key: 'pitfalls', label: '踩坑记录' },
  { key: 'research', label: '调研笔记' },
  { key: 'spaces', label: '空间' },
  { key: 'records', label: '记录分析' },
  { key: 'ai', label: 'AI 运行记录' },
  { key: 'search', label: '搜索' },
]

const viewGroups: Array<{ label: string; items: ViewName[] }> = [
  { label: '工作台', items: ['overview', 'capture'] },
  { label: '业务管理', items: ['timeline', 'ledger', 'issues', 'research', 'pitfalls', 'spaces'] },
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
    {view === 'research' && <><path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h4" /></>}
    {view === 'spaces' && <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>}
    {view === 'records' && <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>}
    {view === 'ai' && <><path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z" /><path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7L18 14Z" /></>}
    {view === 'search' && <><circle cx="11" cy="11" r="7" /><path d="m16.2 16.2 4 4" /></>}
  </svg>
}


const spaceKindLabels: Record<string, string> = { house: '房屋', room: '房间', component: '构件', surface: '表面' }

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
  return <EChart title={title} description={description} kind={kind} option={option} summary={chartSummary(title, rows, unit)} onDataClick={onClick} accessibleItems={rows.map(item => ({ key: item.key, label: item.label }))} onDataHover={onHover} onDataLeave={onLeave} selectedKey={selectedKey} interactionHint={interactionHint} scrollableContentHeight={scrollable ? Math.max(290, rows.length * 42) : undefined} scrollableMaxHeight={scrollable ? 360 : undefined} />
}

function LoadState({ loading, error, empty, onRetry }: { loading: boolean; error: string; empty?: boolean; onRetry?: () => void }) {
  if (loading) return <p className="view-state" role="status">正在加载…</p>
  if (error) return <p className="view-state view-state--error" role="alert">{error} {onRetry && <button type="button" onClick={onRetry}>重试加载</button>}</p>
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
  const clearFilters = () => {
    setQ(''); setRecordType(''); setSpaceId(''); setStageId(''); setDateFrom(''); setDateTo(''); setSelectedMonth('')
    setApplied({ q: '', record_type: '', space_id: '', stage_id: '', date_from: '', date_to: '' }); setVisibleCount(timelineBatchSize)
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
    <div className="filter-grid"><label className="field-stack"><span>关键词</span><input value={q} onChange={(event) => setQ(event.target.value)} /></label><label className="field-stack"><span>记录类型</span><Select value={recordType} onChange={(event) => setRecordType(event.target.value)}><option value="">全部类型</option>{Object.entries(recordTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label><ReferenceFilters spaces={spaces} stages={stages} spaceId={spaceId} stageId={stageId} onSpace={setSpaceId} onStage={setStageId} /><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={applyForm}>应用筛选</button><button type="button" className="filter-button" onClick={clearFilters}>清除筛选</button></div>
    <LoadState loading={loading} error={error} empty={data?.total === 0} onRetry={() => setReload(value => value + 1)} />
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
  const panel = useRef<HTMLElement>(null)
  useModalFocus(panel, true, onClose)
  // 挂载到 body，避免看板祖先的 transform/overflow 改变 fixed 定位参照。
  return createPortal(<>
    {!obscured && <button type="button" data-modal-backdrop tabIndex={-1} className="ledger-detail-backdrop" aria-label="点击遮罩关闭明细" onClick={onClose} />}
    <aside ref={panel} tabIndex={-1} className={`detail-panel ledger-detail-panel immersive-glass immersive-glass--strong${obscured ? ' is-obscured' : ''}`} role="dialog" aria-modal={!obscured} aria-hidden={obscured} aria-labelledby="ledger-detail-title">
      <header className="detail-panel__header ledger-detail-panel__header"><div><p className="eyebrow">完整明细</p><h2 id="ledger-detail-title">{group.title}</h2></div><button type="button" onClick={onClose} aria-label="关闭明细">关闭</button></header>
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
  const [reload, setReload] = useState(0)
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
  }, [refreshRevision, reload])

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
    <LoadState loading={loading} error={error} empty={data ? data.ledger_entries.length === 0 : false} onRetry={() => setReload(value => value + 1)} />
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
  const [completion, setCompletion] = useState<ProjectionRecord | null>(null)
  const [completionResult, setCompletionResult] = useState('')
  const [completionError, setCompletionError] = useState('')
  const [pendingId, setPendingId] = useState('')
  useNavigationGuard(Boolean(completion && completionResult.trim()) || Boolean(pendingId))
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
    if (pendingId) return
    if (status === 'done') { setCompletion(record); setCompletionResult(String(record.actual_result ?? '')); setCompletionError(''); return }
    setPendingId(record.id)
    try {
      const payload: Record<string, unknown> = { record_type: 'issue', status }
      await updateRecord(record.id, payload)
      setReload((value) => value + 1)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '状态更新失败')
    } finally { setPendingId('') }
  }
  const finishIssue = async () => {
    if (!completion || pendingId) return
    if (!completionResult.trim()) { setCompletionError('请填写实际处理结果，再登记为已完成。'); return }
    setPendingId(completion.id); setCompletionError('')
    try {
      await updateRecord(completion.id, { record_type: 'issue', status: 'done', actual_result: completionResult.trim() })
      setCompletion(null); setCompletionResult(''); setReload(value => value + 1)
    } catch (failure) { setCompletionError(failure instanceof Error ? failure.message : '保存失败，请重试。') }
    finally { setPendingId('') }
  }
  return <section className="view-panel"><div className="issue-page-header"><header><h2>待办与问题</h2></header>
    <div className="filter-grid issue-filter-bar"><label className="field-stack"><span>空间</span><Select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">全部空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label><button className="filter-button" type="button" onClick={() => { setApplied((current) => ({ ...current, space_id: spaceId })); setReload((value) => value + 1) }}>应用筛选</button></div></div>
    <div className="filter-grid issue-keyboard-filters"><label className="field-stack"><span>问题状态</span><Select value={applied.status} onChange={event => applyChart('status', event.target.value)}><option value="">全部状态</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label><label className="field-stack"><span>严重程度</span><Select value={applied.severity} onChange={event => applyChart('severity', event.target.value)}><option value="">全部程度</option>{Object.entries(severityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label></div>
    <LoadState loading={loading} error={error} empty={data?.total === 0} onRetry={() => setReload(value => value + 1)} />
    {data && data.total > 0 && <div className="chart-grid"><AnalyticsChart title="问题状态分布" description="" kind="donut" rows={data.analytics.status_distribution} onClick={(key) => applyChart('status', key)} selectedKey={applied.status} /><AnalyticsChart title="问题严重程度" description="" kind="bar" rows={data.analytics.severity_distribution} onClick={(key) => applyChart('severity', key)} selectedKey={applied.severity} itemColors={{ high: chartPalette.risk }} /></div>}
    {applied.status && <button type="button" className="clear-filter" onClick={() => applyChart('status', '')}>状态：{statusLabels[applied.status] || applied.status}，点击取消</button>}
    {applied.severity && <button type="button" className="clear-filter" onClick={() => applyChart('severity', '')}>严重程度：{severityLabels[applied.severity] || applied.severity}，点击取消</button>}
    {(applied.status || applied.severity) && <button type="button" className="clear-filter" onClick={() => setApplied((current) => ({ ...current, status: '', severity: '' }))}>清除全部图表筛选</button>}
    <div className="issue-board">{data?.columns.filter((column) => !applied.status || column.status === applied.status).map((column) => <section className="issue-column" key={column.status}><h3>{column.label}<span>{column.items.length}</span></h3><div className="issue-column__body">{column.items.length === 0 && <p className="muted">暂无</p>}{column.items.map((record) => <article className="issue-card" key={record.id} data-severity={record.severity}><button type="button" className="title-button" onClick={() => onOpen(record.id)}><strong>{record.title}</strong></button><p>{record.phenomenon}</p>{record.spaces.length > 0 && <small>{record.spaces.map((item) => item.name).join(' · ')}</small>}<label className="field-stack"><span>处理状态</span><Select disabled={Boolean(pendingId)} value={record.status} onChange={(event) => void changeStatus(record, event.target.value)}>{data.columns.map((item) => <option key={item.status} value={item.status}>{item.label}</option>)}</Select></label>{completion?.id === record.id && <form className="issue-completion-form" onSubmit={event => { event.preventDefault(); void finishIssue() }}><label className="field-stack"><span>实际处理结果</span><textarea autoFocus rows={3} value={completionResult} onChange={event => setCompletionResult(event.target.value)} /></label>{completionError && <p role="alert">{completionError}</p>}<div className="record-actions"><button type="submit" disabled={Boolean(pendingId)}>{pendingId ? '保存中…' : '登记完成'}</button><button type="button" disabled={Boolean(pendingId)} onClick={() => { if (!completionResult.trim() || window.confirm('取消会放弃本次未保存的处理结果，确定取消吗？')) { setCompletion(null); setCompletionResult('') } }}>取消</button></div></form>}</article>)}</div></section>)}</div>
  </section>
}

function SpacesView({ onOpen, refreshRevision, onManage }: { onOpen: (id: string) => void; refreshRevision: number; onManage: () => void }) {
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [spaceId, setSpaceId] = useState('')
  const [data, setData] = useState<SpaceArchiveResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    listSpaces().then((rows) => {
      if (!active) return
      setSpaces(rows)
      if (!spaceId && rows[0]) setSpaceId(rows[0].id)
      if (!rows[0]) setLoading(false)
    }).catch((reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : '空间加载失败'); setLoading(false) } })
    return () => { active = false }
  }, [reload])
  useEffect(() => {
    if (!spaceId) { setData(null); setLoading(false); return }
    let active = true
    setLoading(true)
    getSpaceArchive(spaceId).then((result) => { if (active) { setData(result); setError('') } })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : '空间档案加载失败'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [spaceId, refreshRevision, reload])
  return <section className="view-panel"><header><h2>空间档案</h2><button type="button" onClick={onManage}>管理空间</button></header>
    <label className="field-stack space-picker"><span>选择空间</span><Select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">请选择空间</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name} · {spaceKindLabels[item.kind] || '其他空间'}</option>)}</Select></label>
    <LoadState loading={loading} error={error} onRetry={() => setReload(value => value + 1)} />
    {!loading && !error && spaces.length === 0 && <div className="empty-guidance"><strong>还没有空间档案</strong><p>先建立房间或区域，再为记录标记发生位置。</p><button type="button" onClick={onManage}>建立第一个空间</button></div>}
    {data && <><label className="field-stack space-picker"><span>记录类型</span><Select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="">全部类型</option>{Object.keys(data.records_by_type).map(type => <option key={type} value={type}>{recordTypeLabels[type] || type}</option>)}</Select></label><p className="breadcrumbs">{data.breadcrumbs.map((item) => item.name).join(' / ')}</p><div className="space-overview"><div><span className="record-type-tag">当前空间</span><h3>{data.space.name}</h3><p>含上级区域的公共记录、当前区域及下属区域记录</p></div><dl><div><dt>记录</dt><dd>{data.summary.record_count}</dd></div><div><dt>未关闭问题</dt><dd>{data.summary.unclosed_issue_count}</dd></div><div><dt>尺寸</dt><dd>{data.summary.measurement_count}</dd></div><div><dt>材料</dt><dd>{data.summary.material_count}</dd></div><div><dt>净支出</dt><dd>{formatMoney(data.analytics.net_expense_minor)}</dd></div></dl></div>{data.analytics.type_distribution.length > 0 && <div className="chart-grid"><AnalyticsChart title="空间记录类型" description="" kind="donut" rows={data.analytics.type_distribution} onClick={setTypeFilter} selectedKey={typeFilter} /><AnalyticsChart title="空间问题状态" description="查看该空间问题的处理进度" kind="bar" rows={data.analytics.issue_status_distribution} /></div>}{typeFilter && <button type="button" className="clear-filter" onClick={() => setTypeFilter('')}>当前按记录类型筛选，点击取消</button>}{Object.entries(data.records_by_type).filter(([type]) => !typeFilter || type === typeFilter).map(([type, records]) => <section className="projection-section" key={type}><h3>{recordTypeLabels[type] || '未知类型'}</h3><div className="card-grid">{records.map((record) => <RecordButton key={record.id} record={record} onOpen={onOpen} />)}</div></section>)}</>}
  </section>
}

function SearchView({ onOpen, refreshRevision, onOpenSource }: { onOpen: (id: string) => void; refreshRevision: number; onOpenSource: (id: string) => void }) {
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
  const clear = () => {
    searchRevision.current += 1; submittedParams.current = null
    setQ(''); setRecordType(''); setStatus(''); setDateFrom(''); setDateTo(''); setData(null); setError(''); setLoading(false)
  }
  const statusLabel = (value: string) => recordType ? recordStatusLabel(recordType, value)
    : Object.entries(recordConfig).filter(([, config]) => (config.statuses as readonly string[]).includes(value)).map(([type, config]) => `${config.label}：${recordStatusLabel(type, value)}`).join(' / ')
  return <section className="view-panel"><header><h2>搜索</h2></header>
    <div className="filter-grid"><label className="field-stack"><span>关键词</span><input value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch() }} placeholder="例如：花砖、主卧、门套" /></label><label className="field-stack"><span>记录类型</span><Select value={recordType} onChange={(event) => { setRecordType(event.target.value); setStatus('') }}><option value="">全部类型</option>{Object.entries(recordTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label><label className="field-stack"><span>状态</span><Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{statusesForRecordType(recordType).map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</Select></label><label className="field-stack"><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-stack"><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="filter-button" type="button" onClick={() => void runSearch()}>搜索</button><button type="button" className="filter-button" onClick={clear}>清除筛选</button></div>
    <LoadState loading={loading} error={error} empty={total === 0} onRetry={() => { if (submittedParams.current) void requestSearch(submittedParams.current) }} />
    {total === 0 && <button type="button" onClick={clear}>清除条件，重新搜索</button>}
    {data && <><p className="result-count">共找到 {total} 项</p>{data.groups.records.length > 0 && <section className="projection-section"><h3>正式记录 · {data.counts.records}</h3><div className="card-grid">{data.groups.records.map((record) => <RecordButton key={record.id} record={record} onOpen={onOpen} />)}</div></section>}{data.groups.sources.length > 0 && <section className="projection-section"><h3>原始来源 · {data.counts.sources}</h3>{data.groups.sources.map((source) => <article className="source-result" key={source.id}><p>{source.original_text || '仅附件来源'}</p><time>{formatBeijingDateTime(source.captured_at)}</time><button type="button" onClick={() => onOpenSource(source.id)}>打开原始来源</button></article>)}</section>}{(['materials', 'vendors', 'spaces'] as const).map((group) => data.groups[group].length > 0 && <section className="projection-section" key={group}><h3>{{ materials: '材料', vendors: '商家', spaces: '空间' }[group]} · {data.counts[group]}</h3><div className="tag-list">{data.groups[group].map((item) => <span key={item.id}>{item.name}</span>)}</div></section>)}</>}
  </section>
}

export function CoreViews({ children, onLogout, onOpenSource, onManageSpaces }: { children: ReactNode; onLogout?: () => void; onOpenSource?: (id: string) => void; onManageSpaces?: () => void }) {
  const [view, setView] = useState<ViewName>('overview')
  const [detailId, setDetailId] = useState('')
  const [detailClosing, setDetailClosing] = useState(false)
  const [viewRevision, setViewRevision] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  const [compactNav, setCompactNav] = useState(() => window.matchMedia?.('(max-width: 900px)').matches ?? false)
  const [researchId, setResearchId] = useState('')
  const sidebar = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  useModalFocus(sidebar, compactNav && navOpen, () => setNavOpen(false))
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 900px)')
    if (!media) return
    const update = () => { setCompactNav(media.matches); if (!media.matches) setNavOpen(false) }
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
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
    if (!confirmNavigation()) return
    if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current)
    detailCloseTimer.current = null
    setDetailClosing(false)
    setDetailId(recordId)
  }
  useEffect(() => () => {
    if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current)
  }, [])
  const selectView = (next: ViewName) => {
    if ((next !== view || detailId) && !confirmNavigation()) return false
    setView(next); finishDetailClose(); setNavOpen(false)
    if (compactNav) requestAnimationFrame(() => menuButton.current?.focus())
    return true
  }
  const openSource = (id: string) => { if (selectView('capture')) onOpenSource?.(id) }
  const manageSpaces = () => { if (selectView('capture')) onManageSpaces?.() }
  const openResearch = (id: string) => { if (selectView('research')) setResearchId(id) }
  return <div className="workspace-shell">
    <aside ref={sidebar} inert={compactNav && !navOpen} aria-hidden={compactNav && !navOpen ? true : undefined} role={compactNav && navOpen ? 'dialog' : undefined} aria-modal={compactNav && navOpen ? true : undefined} aria-label={compactNav && navOpen ? '核心功能导航' : undefined} tabIndex={-1} className={`workspace-sidebar${navOpen ? ' is-open' : ''}`}>
      <div className="workspace-brand"><span className="workspace-brand__mark">H</span><div><strong>HomeBuild Log</strong><small>装修事实工作台</small></div></div>
      <nav className="workspace-nav" aria-label="核心功能">{viewGroups.map((group) => <section key={group.label}><h2>{group.label}</h2>{group.items.map((key) => { const item = viewLabels.find((entry) => entry.key === key)!; return <button key={key} type="button" className={view === key ? 'is-active' : ''} aria-current={view === key ? 'page' : undefined} onClick={() => selectView(key)}><span aria-hidden="true"><NavIcon view={key} /></span>{item.label}</button> })}</section>)}</nav>
      <footer className="workspace-sidebar__footer"><p>本地装修工作台</p>{onLogout && <button type="button" onClick={() => { if (confirmNavigation()) onLogout() }}>退出登录</button>}</footer>
    </aside>
    {navOpen && <button type="button" data-modal-backdrop tabIndex={-1} className="nav-backdrop" aria-label="关闭导航" onClick={() => setNavOpen(false)} />}
    <div className="workspace-main">
      <WorkspaceAtmosphere />
      <header className="workspace-topbar immersive-glass"><button ref={menuButton} type="button" className="menu-button" aria-label="打开导航" aria-expanded={navOpen} onClick={() => setNavOpen((value) => !value)}>☰</button><div><small>HomeBuild Log</small><strong>{currentLabel}</strong></div><span>已登录</span></header>
      <main className="workspace-content">{view === 'overview' && <OverviewView onOpen={openDetail} refreshRevision={viewRevision} />}{view === 'capture' && children}{view === 'timeline' && <TimelineView onOpen={openDetail} refreshRevision={viewRevision} />}{view === 'ledger' && <LedgerView onOpen={openDetail} detailOpen={Boolean(detailId)} refreshRevision={viewRevision} />}{view === 'issues' && <IssuesView onOpen={openDetail} refreshRevision={viewRevision} />}{view === 'pitfalls' && <PitfallsView />}{view === 'research' && <ResearchView initialTopicId={researchId} />}{view === 'spaces' && <SpacesView onOpen={openDetail} refreshRevision={viewRevision} onManage={manageSpaces} />}{view === 'records' && <RecordsAnalyticsView onOpen={openDetail} refreshRevision={viewRevision} />}{view === 'ai' && <AiAnalyticsView />}{view === 'search' && <SearchView onOpen={openDetail} refreshRevision={viewRevision} onOpenSource={openSource} />}</main>
    </div>
    {/* 切换记录时重新建立详情状态，避免沿用上一条记录的编辑草稿。 */}
    {detailId && <RecordDetail key={detailId} recordId={detailId} closing={detailClosing} onClose={closeDetail} onExitComplete={finishDetailClose} onChanged={() => setViewRevision((value) => value + 1)} onOpen={openDetail} onOpenSource={openSource} onOpenResearch={openResearch} />}
  </div>
}
