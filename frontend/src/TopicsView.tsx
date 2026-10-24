import { VoiceField } from './VoiceField'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { listRecords, listPitfalls, type DomainRecord, type PitfallEntry } from './domainApi'
import { Select } from './Select'
import { recordStatusLabel, recordTypeLabels } from './recordLabels'
import { formatBeijingDateTime, formatCalendarDate } from './time'
import { confirmNavigation, useNavigationGuard } from './navigationGuard'
import {
  createTopic, getTopic, getTopicActivities, getTopicOverview, listTopics, updateTopic,
  linkTopicRecord, unlinkTopicRecord, linkTopicPitfall, unlinkTopicPitfall,
  type Topic, type TopicActivity, type TopicActivities, type TopicDetail, type TopicInput, type TopicOverview, type TopicStatus,
} from './topicsApi'
import './TopicsView.css'

export type TopicCreateKind = 'ledger' | 'issue' | 'research' | 'pitfall'
interface TopicActions {
  onReview?: (id: string) => void
  onOpenRecord: (id: string) => void
  onOpenResearch: (id: string) => void
  onOpenPitfall: (id: string) => void
  onCreate: (kind: TopicCreateKind, topicId: string) => void
}
const message = (failure: unknown) => failure instanceof Error ? failure.message : '操作失败，请重试。'
const typeLabels: Record<string, string> = { ...recordTypeLabels, pitfall: '踩坑' }
const statusLabel = (status: TopicStatus) => status === 'active' ? '进行中' : '已归档'
const emptyInput = { name: '', goal: '', current_situation: '' }

// 草稿按主题隔离；保存失败或返回业务入口时仍保留已输入的内容。
function useTopicDraft(id: string, initial: TopicInput) {
  const storageKey = `homebuild:topic:${id}:draft`
  const [draft, setDraft] = useState<TopicInput>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
      if (value && typeof value.name === 'string') return { name: value.name, goal: typeof value.goal === 'string' ? value.goal : '', current_situation: typeof value.current_situation === 'string' ? value.current_situation : '' }
    } catch { /* 存储不可用时保留本页草稿。 */ }
    return initial
  })
  const change = (next: TopicInput) => {
    setDraft(next)
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* 本页仍可正常编辑。 */ }
  }
  const clear = () => {
    setDraft(initial)
    try { sessionStorage.removeItem(storageKey) } catch { /* 保存结果不依赖浏览器存储。 */ }
  }
  return { draft, change, clear }
}

function TopicForm({ topic, busy, active, onSubmit, onCancel }: {
  topic?: Topic; busy: boolean; active: boolean; onSubmit: (payload: TopicInput) => Promise<boolean>; onCancel: () => void
}) {
  const initial = topic ? { name: topic.name, goal: topic.goal ?? '', current_situation: topic.current_situation ?? '' } : emptyInput
  const { draft, change, clear } = useTopicDraft(topic?.id ?? 'new', initial)
  const [error, setError] = useState('')
  const [voiceBusy, setVoiceBusy] = useState(false)
  const dirty = draft.name !== initial.name || draft.goal !== initial.goal || draft.current_situation !== initial.current_situation
  useNavigationGuard(dirty || busy, undefined, active)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (voiceBusy) return
    if (!draft.name.trim()) { setError('请填写主题名称。'); return }
    setError('')
    const saved = await onSubmit({ name: draft.name.trim(), goal: draft.goal?.trim() ?? '', current_situation: draft.current_situation?.trim() ?? '' })
    if (saved) clear()
  }
  return <form className="topic-form" onSubmit={submit}>
    <fieldset disabled={busy}>
      <legend>{topic ? '编辑主题' : '新建主题'}</legend>
      <label><span>主题名称</span><VoiceField onBusyChange={setVoiceBusy} active={active && !busy}><input aria-label="主题名称" value={draft.name} maxLength={200} required onChange={event => change({ ...draft, name: event.target.value })} placeholder="例如：全屋智能开关规划" /></VoiceField></label>
      <label><span>目标（可选）</span><VoiceField active={active && !busy}><textarea value={draft.goal ?? ''} rows={2} maxLength={10000} onChange={event => change({ ...draft, goal: event.target.value })} placeholder="这件事最终要完成什么？" /></VoiceField></label>
      <label><span>当前情况（可选）</span><VoiceField active={active && !busy}><textarea value={draft.current_situation ?? ''} rows={3} maxLength={10000} onChange={event => change({ ...draft, current_situation: event.target.value })} placeholder="进展与待留意事项" /></VoiceField></label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="topic-actions"><button type="submit" disabled={busy || voiceBusy}>{busy ? '保存中…' : topic ? '保存主题' : '创建主题'}</button><button className="topic-secondary" type="button" onClick={() => { if (confirmNavigation()) { clear(); onCancel() } }}>取消</button></div>
    </fieldset>
  </form>
}

function ActivityList({ items, onOpen }: { items: TopicActivity[]; onOpen: (activity: TopicActivity) => void }) {
  return <ol className="topic-activities">{items.map(activity => <li key={`${activity.object_kind}:${activity.id}`}>
    <div className="topic-activity-meta"><time dateTime={activity.date_missing ? undefined : activity.occurred_at}>{activity.date_missing ? '日期待补充' : /^\d{4}-\d{2}-\d{2}$/.test(activity.occurred_at) ? formatCalendarDate(activity.occurred_at) : formatBeijingDateTime(activity.occurred_at)}</time><span>{typeLabels[activity.record_type] ?? '记录'}</span>{activity.object_kind === 'research_entry' && <span>调研过程</span>}{activity.object_kind === 'pitfall_resolution' && <span>处理过程</span>}{activity.object_kind === 'issue_activity' && <span>{activity.next_status ? '状态变化' : '进展备注'}</span>}</div>
    <button type="button" className="topic-content-link" onClick={() => onOpen(activity)}>{activity.title}</button>
    {activity.next_status && <p>{activity.previous_status ? `${recordStatusLabel('issue', activity.previous_status)} → ` : ''}{recordStatusLabel('issue', activity.next_status)}</p>}
    {activity.content && <p>{activity.content}</p>}
  </li>)}</ol>
}

function ExistingContent({ topic, busy, onLink }: { topic: TopicDetail; busy: boolean; onLink: (kind: 'record' | 'pitfall', id: string, version?: number) => void }) {
  const [records, setRecords] = useState<DomainRecord[]>([])
  const [pitfalls, setPitfalls] = useState<PitfallEntry[]>([])
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    Promise.all([listRecords(), listPitfalls()]).then(([records, pitfalls]) => { if (active) { setRecords(records); setPitfalls(pitfalls.items) } })
      .catch(reason => { if (active) setError(message(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [retry])
  const query = search.trim().toLocaleLowerCase()
  const candidates = [
    ...records.map(record => ({ id: record.id, kind: 'record' as const, version: record.version, type: record.record_type, title: record.title, text: record.description ?? '', linked: topic.records.some(item => item.id === record.id) })),
    ...pitfalls.map(pitfall => ({ id: pitfall.id, kind: 'pitfall' as const, version: undefined, type: 'pitfall', title: pitfall.description, text: '', linked: topic.pitfalls.some(item => item.id === pitfall.id) })),
  ].filter(item => (!type || item.type === type) && (!query || `${item.title} ${item.text}`.toLocaleLowerCase().includes(query)))
  return <div className="topic-linker">
    <div className="topic-toolbar"><label><span>搜索已有内容</span><input type="search" value={search} placeholder="搜索标题或内容" onChange={event => setSearch(event.target.value)} /></label><label><span>内容类型</span><Select aria-label="内容类型" value={type} onChange={event => setType(event.target.value)}><option value="">全部类型</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label></div>
    {loading && <p role="status">正在读取已有内容…</p>}
    {error && <div><p role="alert" className="error-text">{error}</p><button type="button" className="topic-secondary" onClick={() => setRetry(value => value + 1)}>重试读取内容</button></div>}
    {!loading && !error && candidates.length === 0 && <p className="muted">没有匹配的内容，请调整搜索或筛选。</p>}
    {!loading && !error && <ul className="topic-link-results">{candidates.map(item => <li key={`${item.kind}:${item.id}`}><div><span className="muted">{typeLabels[item.type]}</span><p>{item.title}</p></div><button className="topic-secondary" type="button" disabled={busy || item.linked || topic.status === 'archived'} onClick={() => onLink(item.kind, item.id, item.version)} aria-label={`${item.linked ? '已关联' : '关联'}：${item.title}`}>{item.linked ? '已关联' : '关联'}</button></li>)}</ul>}
  </div>
}

function TopicPane({ id, revision, busy, active, run, onChanged, ...actions }: TopicActions & {
  id: string; revision: number; busy: boolean; active: boolean
  run: (id: string, operation: () => Promise<void>) => Promise<boolean>
  onChanged: () => void
}) {
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [overview, setOverview] = useState<TopicOverview | null>(null)
  const [activities, setActivities] = useState<TopicActivities | null>(null)
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [filter, setFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [timelineLoading, setTimelineLoading] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    let active = true
    setLoading(true); setErrors(previous => ({ ...previous, topic: '', overview: '' }))
    // 主题主体与概览独立读取，一处失败仍可查看其余区域。
    const detail = getTopic(id).then(value => { if (active) setTopic(value) }).catch(reason => { if (active) setErrors(previous => ({ ...previous, topic: message(reason) })) })
    const overview = getTopicOverview(id).then(value => { if (active) setOverview(value) }).catch(reason => { if (active) setErrors(previous => ({ ...previous, overview: message(reason) })) })
    Promise.all([detail, overview]).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, revision, reload])
  useEffect(() => {
    let active = true
    setTimelineLoading(true); setErrors(previous => ({ ...previous, timeline: '' }))
    getTopicActivities(id, filter, offset, 30).then(value => {
      if (!active) return
      if (offset > 0 && offset >= value.total) setOffset(Math.max(0, Math.floor((value.total - 1) / 30) * 30))
      else setActivities(value)
    })
      .catch(reason => { if (active) setErrors(previous => ({ ...previous, timeline: message(reason) })) })
      .finally(() => { if (active) setTimelineLoading(false) })
    return () => { active = false }
  }, [id, filter, offset, revision, reload])
  const refresh = () => { setReload(value => value + 1); onChanged() }
  const mutate = async (operation: () => Promise<unknown>) => run(id, async () => { await operation(); refresh() })
  const openRecord = (record: DomainRecord) => { if (confirmNavigation()) (record.record_type === 'research' ? actions.onOpenResearch : actions.onOpenRecord)(record.id) }
  const openActivity = (activity: TopicActivity) => {
    if (!confirmNavigation()) return
    const id = activity.parent_id ?? activity.object_id
    if (activity.record_type === 'pitfall') actions.onOpenPitfall(id)
    else if (activity.record_type === 'research') actions.onOpenResearch(id)
    else actions.onOpenRecord(id)
  }
  if (loading && !topic) return <p role="status">正在读取主题详情…</p>
  if (!topic) return <div><p role="alert" className="error-text">{errors.topic || '无法读取主题。'}</p><button type="button" className="topic-secondary" onClick={() => setReload(value => value + 1)}>重试读取主题</button></div>
  const archived = topic.status === 'archived'
  return <article className="topic-detail">
    <header><div><h3>{topic.name}</h3>{actions.onReview && <button type="button" className="topic-secondary" onClick={() => actions.onReview?.(id)}>近期回顾</button>}<span className="muted">{statusLabel(topic.status)}</span></div><div className="topic-actions"><button type="button" className="topic-secondary" disabled={busy} onClick={() => { if (!editing || confirmNavigation()) setEditing(value => !value) }}>编辑主题</button><button className="topic-secondary" type="button" disabled={busy} onClick={() => { void mutate(() => updateTopic(id, { status: archived ? 'active' : 'archived' })) }}>{archived ? '恢复主题' : '归档主题'}</button></div></header>
    {errors.topic && <p role="alert" className="error-text">{errors.topic}</p>}
    {editing ? <TopicForm topic={topic} busy={busy} active={active} onCancel={() => setEditing(false)} onSubmit={async payload => { const saved = await mutate(() => updateTopic(id, payload)); if (saved) setEditing(false); return saved }} /> : <>
      <section className="topic-section"><h4>目标</h4><p>{topic.goal || '尚未填写目标。'}</p></section>
      <section className="topic-section"><h4>当前情况</h4><p>{topic.current_situation || '尚未填写当前情况。'}</p></section>
    </>}
    {archived && <p className="muted">已归档，恢复后可新增或关联内容。</p>}
    <div className="topic-actions" aria-label="在主题下新建内容">{([['ledger', '记一笔账'], ['issue', '新增待办'], ['research', '新增调研'], ['pitfall', '记下踩坑']] as const).map(([kind, label]) => <button type="button" className="topic-secondary" key={kind} disabled={archived || busy} onClick={() => { if (confirmNavigation()) actions.onCreate(kind, id) }}>{label}</button>)}<button type="button" className="topic-secondary" disabled={archived || busy} onClick={() => setLinking(value => !value)}>{linking ? '收起关联选择' : '关联已有内容'}</button></div>
    {linking && <ExistingContent topic={topic} busy={busy || archived} onLink={(kind, objectId, version) => { void mutate(() => kind === 'record' ? linkTopicRecord(id, objectId, version!) : linkTopicPitfall(id, objectId)) }} />}
    {errors.overview ? <div><p className="error-text" role="alert">{errors.overview}</p><button className="topic-secondary" type="button" onClick={() => setReload(value => value + 1)}>重试读取概览</button></div> : overview && <>
      <section className="topic-section"><h4>未完成待办 <span className="muted">{overview.pending_issues.length}</span></h4>{overview.pending_issues.length ? <ul className="topic-pending">{overview.pending_issues.map(record => <li key={record.id}><button className="topic-content-link" type="button" onClick={() => openRecord(record)}>{record.title}</button><span className="muted">{recordStatusLabel('issue', record.status)}</span>{record.due_date && <span className="muted">截止：{record.due_date}</span>}</li>)}</ul> : <p className="muted">暂无未完成待办。</p>}</section>
      <section className="topic-section"><h4>最近进展</h4>{overview.recent_activities.length ? <ActivityList items={overview.recent_activities.slice(0, 10)} onOpen={openActivity} /> : <p className="muted">暂无进展，先新增或关联一条内容。</p>}</section>
    </>}
    <section className="topic-section"><div className="topic-section-heading"><h4>完整时间线</h4><label><span className="visually-hidden">时间线类型</span><Select aria-label="时间线类型" value={filter} onChange={event => { setFilter(event.target.value); setOffset(0) }}><option value="">全部类型</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label></div>
      {timelineLoading ? <p role="status">正在读取时间线…</p> : errors.timeline ? <div><p className="error-text" role="alert">{errors.timeline}</p><button type="button" className="topic-secondary" onClick={() => setReload(value => value + 1)}>重试读取时间线</button></div> : activities && <>
        {activities.items.length ? <ActivityList items={activities.items} onOpen={openActivity} /> : <p className="muted">当前范围暂无活动。</p>}
        <div className="topic-pagination"><button type="button" className="topic-secondary" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 30))}>上一页</button><span>{activities.total === 0 ? '共 0 条' : `${offset + 1}–${Math.min(offset + 30, activities.total)} / ${activities.total} 条`}</span><button type="button" className="topic-secondary" disabled={offset + 30 >= activities.total} onClick={() => setOffset(value => value + 30)}>下一页</button></div>
      </>}
    </section>
    <section className="topic-section"><details><summary>已关联内容（{topic.records.length + topic.pitfalls.length}）</summary><ul className="topic-members">{topic.records.map(record => <li key={record.id}><button type="button" className="topic-content-link" onClick={() => openRecord(record)}>{recordTypeLabels[record.record_type]} · {record.title}</button><button type="button" className="topic-secondary" disabled={busy} aria-label={`解除关联：${record.title}`} onClick={() => { void mutate(() => unlinkTopicRecord(id, record.id, record.version)) }}>解除关联</button></li>)}{topic.pitfalls.map(pitfall => <li key={pitfall.id}><button type="button" className="topic-content-link" onClick={() => { if (confirmNavigation()) actions.onOpenPitfall(pitfall.id) }}>踩坑 · {pitfall.description}</button><button type="button" className="topic-secondary" disabled={busy} aria-label={`解除关联：${pitfall.description}`} onClick={() => { void mutate(() => unlinkTopicPitfall(id, pitfall.id)) }}>解除关联</button></li>)}</ul>{!topic.records.length && !topic.pitfalls.length && <p className="muted">尚未关联内容。</p>}</details></section>
  </article>
}

export function TopicsView({ revision = 0, initialTopicId, active = true, ...actions }: TopicActions & { revision?: number; initialTopicId?: string; active?: boolean }) {
  const [items, setItems] = useState<Topic[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<TopicStatus | 'all'>('active')
  const [selectedId, setSelectedId] = useState(initialTopicId ?? '')
  const [showDetail, setShowDetail] = useState(Boolean(initialTopicId))
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [operationErrors, setOperationErrors] = useState<Record<string, string>>({})
  const [reload, setReload] = useState(0)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const operations = useRef(new Set<string>())
  const listPane = useRef<HTMLDivElement>(null)
  const detailPane = useRef<HTMLDivElement>(null)
  const focusDetail = useRef(false)
  const focusList = useRef(false)
  useEffect(() => {
    let active = true
    setLoading(true); setLoadError('')
    listTopics(search, filter).then(value => { if (active) setItems(value.items) })
      .catch(reason => { if (active) setLoadError(message(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [search, filter, reload, revision])
  useEffect(() => { if (initialTopicId) { setSelectedId(initialTopicId); setShowDetail(true) } }, [initialTopicId])
  useEffect(() => {
    if (!active) window.dispatchEvent(new CustomEvent('homebuild-dropdown-open', { detail: 'topics-hidden' }))
  }, [active])
  useLayoutEffect(() => {
    // 焦点恢复不触发浏览器隐式滚动，窄屏只在主动打开详情时定位。
    if (focusDetail.current) {
      focusDetail.current = false
      detailPane.current?.focus({ preventScroll: true })
      if (window.matchMedia?.('(max-width: 760px)').matches) detailPane.current?.scrollIntoView({ block: 'start' })
    }
    if (focusList.current) { focusList.current = false; listPane.current?.querySelector<HTMLButtonElement>(`[aria-pressed="true"]`)?.focus({ preventScroll: true }) }
  }, [selectedId, showDetail])
  const run = async (id: string, operation: () => Promise<void>) => {
    // 同一主题切走再返回时仍禁止重复提交，晚返回不会改变当前选中的主题。
    if (operations.current.has(id)) return false
    operations.current.add(id); setPending(previous => ({ ...previous, [id]: true })); setOperationErrors(previous => ({ ...previous, [id]: '' }))
    try { await operation(); return true }
    catch (reason) { setOperationErrors(previous => ({ ...previous, [id]: message(reason) })); return false }
    finally { operations.current.delete(id); setPending(previous => ({ ...previous, [id]: false })) }
  }
  return <section className={`topics-page${showDetail ? ' topics-show-detail' : ''}`}>
    <header className="topics-page-heading"><h2>主题</h2><button type="button" onClick={() => { if (confirmNavigation()) setCreating(true) }}>新建主题</button></header>
    {creating && <TopicForm busy={pending.new ?? false} active={active} onCancel={() => setCreating(false)} onSubmit={payload => run('new', async () => { const topic = await createTopic(payload); setCreating(false); setSelectedId(topic.id); setShowDetail(true); setFilter('active'); setSearch(''); setReload(value => value + 1) })} />}
    <div className="topic-toolbar topics-list-toolbar"><label><span>搜索主题</span><input type="search" value={search} placeholder="搜索主题名称或目标" onChange={event => setSearch(event.target.value)} /></label><label><span>主题状态</span><Select aria-label="主题状态" value={filter} onChange={event => setFilter(event.target.value as TopicStatus | 'all')}><option value="active">进行中</option><option value="archived">已归档</option><option value="all">全部</option></Select></label></div>
    {((creating && operationErrors.new) || operationErrors[selectedId]) && <p className="error-text" role="alert">{creating && operationErrors.new || operationErrors[selectedId]}</p>}
    {loadError && <div><p className="error-text" role="alert">{loadError}</p><button type="button" className="topic-secondary" onClick={() => setReload(value => value + 1)}>重试读取列表</button></div>}
    <div className="topics-workspace"><div ref={listPane} className="topics-list" aria-label="主题列表">
      {loading && <p role="status">正在读取主题…</p>}
      {!loading && !loadError && items.length === 0 && <p className="muted">{search || filter !== 'active' ? '当前筛选下没有主题。' : '还没有进行中的主题。'}</p>}
      {!loading && !loadError && items.map(topic => <button className="topic-list-item" key={topic.id} type="button" aria-pressed={selectedId === topic.id} onClick={() => { if (!confirmNavigation()) return; focusDetail.current = true; setSelectedId(topic.id); setShowDetail(true) }}><strong>{topic.name}</strong><span>{statusLabel(topic.status)}</span>{topic.goal && <p>{topic.goal}</p>}<small>{formatBeijingDateTime(topic.updated_at)}</small></button>)}
    </div><div ref={detailPane} tabIndex={-1} className="topics-detail-pane" aria-label="主题详情"><button type="button" className="topic-secondary topics-back" onClick={() => { if (confirmNavigation()) { focusList.current = true; setShowDetail(false) } }}>返回主题列表</button>{selectedId ? <TopicPane key={selectedId} id={selectedId} revision={revision} active={active} busy={pending[selectedId] ?? false} run={run} onChanged={() => setReload(value => value + 1)} {...actions} /> : <div className="topics-select-hint"><p>选择一个主题查看详情。</p></div>}</div></div>
  </section>
}
