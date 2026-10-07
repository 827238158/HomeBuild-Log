import { useEffect, useRef, useState, type FormEvent } from 'react'
import { appendResearchEntry, createResearch, getResearch, listResearch, updateResearchStatus, type ResearchStatus, type ResearchTopic } from './researchApi'
import { beijingToday, formatBeijingDateTime, formatCalendarDate } from './time'
import { Select } from './Select'
import './research.css'

const statusLabels: Record<ResearchStatus, string> = { collecting: '待调研', comparing: '调研中', archived: '已归档' }
type Operation = 'status' | 'append'
type OperationFeedback = Partial<Record<Operation, { error?: string; success?: string }>>
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

function ResearchSources({ sources }: { sources: string[] }) {
  return <>{sources.map((source, index) => <span key={`${index}-${source}`}>{index > 0 && <br />}{/^https?:\/\//i.test(source) ? <a href={source} target="_blank" rel="noopener noreferrer">{source}</a> : source}</span>)}</>
}

function useDraft(key: string, initial: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => {
    try { return sessionStorage.getItem(key) ?? initial } catch { return initial }
  })
  useEffect(() => {
    try { if (sessionStorage.getItem(key) === null) setValue(initial) } catch { /* 保留本页草稿。 */ }
  }, [initial, key])
  useEffect(() => {
    const restore = () => { try { setValue(sessionStorage.getItem(key) ?? initial) } catch { /* 存储不可用时保留本页草稿。 */ } }
    window.addEventListener('research-draft-saved', restore)
    return () => window.removeEventListener('research-draft-saved', restore)
  }, [initial, key])
  return [value, (next) => {
    setValue(next)
    // 草稿按主题保存，切换主题或页面后仍可继续输入。
    try { sessionStorage.setItem(key, next) } catch { /* 存储不可用时保留本页输入。 */ }
  }]
}

function ResearchDetail({ topic, onSaved, busy, setBusy, feedback, setFeedback }: {
  topic: ResearchTopic; onSaved: (topic: ResearchTopic) => void
  busy: Operation | null; setBusy: (operation: Operation | null) => void
  feedback: OperationFeedback; setFeedback: (update: (previous: OperationFeedback) => OperationFeedback) => void
}) {
  const prefix = `research:${topic.id}:`
  const [date, setDate] = useDraft(`${prefix}date`, beijingToday())
  const [content, setContent] = useDraft(`${prefix}content`, '')
  const [sources, setSources] = useDraft(`${prefix}sources`, '')
  const [uncertainties, setUncertainties] = useDraft(`${prefix}uncertainties`, '')
  const [allEntries, setAllEntries] = useState(false)
  const setError = (kind: Operation, error: string) => setFeedback(previous => ({ ...previous, [kind]: { error } }))
  const run = async (kind: Operation, operation: () => Promise<ResearchTopic>, clear?: () => void) => {
    setBusy(kind); setFeedback(previous => ({ ...previous, [kind]: {} }))
    try {
      const saved = await operation(); clear?.(); onSaved(saved)
      window.dispatchEvent(new Event('research-draft-saved'))
      setFeedback(previous => ({ ...previous, [kind]: { success: { status: '主题状态已保存。', append: '本次调研已保存。' }[kind] } }))
    } catch (failure) { setError(kind, messageOf(failure)) } finally { setBusy(null) }
  }
  const feedbackFor = (kind: Operation) => <div className="research-feedback" aria-live="polite" aria-atomic="true">{busy === kind && <p role="status">保存中…</p>}{feedback[kind]?.error && <p className="error-text" role="alert">{feedback[kind]?.error}</p>}{feedback[kind]?.success && <p role="status">{feedback[kind]?.success}</p>}</div>
  const append = (event: FormEvent) => {
    event.preventDefault()
    if (!content.trim()) { setError('append', '请填写本次调研内容。'); return }
    void run('append', () => appendResearchEntry(topic.id, { research_date: date, content: content.trim(), sources: sources.split('\n').map(value => value.trim()).filter(Boolean), uncertainties: uncertainties.trim() }), () => { setContent(''); setSources(''); setUncertainties(''); setDate(beijingToday()); try { sessionStorage.removeItem(`${prefix}date`) } catch { /* 保留本页日期。 */ } })
  }
  // 接口按日期升序返回，近期优先展示；展开后仍能查看全部历史。
  const recentEntries = [...topic.entries].reverse()
  const visibleEntries = allEntries ? recentEntries : recentEntries.slice(0, 3)
  return <article className="research-detail" aria-label="调研主题详情">
    <header><h3>{topic.title}</h3><div className="research-status"><label className="research-status-row"><span>主题状态</span><Select aria-label="主题状态" value={topic.status === 'concluded' ? 'comparing' : topic.status} disabled={busy !== null} onChange={event => void run('status', () => updateResearchStatus(topic.id, event.target.value as ResearchStatus))}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></label>{feedbackFor('status')}</div></header>
    {topic.description && <p>{topic.description}</p>}
    {topic.question && topic.question !== topic.title && <p>调研问题：{topic.question}</p>}
    <section><h4>追加调研</h4><form onSubmit={append}><fieldset className="research-form" disabled={busy !== null}><label>调研日期<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label><label>本次调研<textarea rows={4} maxLength={10000} value={content} onChange={event => setContent(event.target.value)} placeholder="查到的资料、自己的判断、比较结果…" /></label><label>信息来源<textarea rows={2} maxLength={10000} value={sources} onChange={event => setSources(event.target.value)} placeholder="链接或资料名称，每行一条" /></label><label>尚未确认<textarea rows={2} maxLength={10000} value={uncertainties} onChange={event => setUncertainties(event.target.value)} /></label><div className="research-actions"><button disabled={busy !== null} type="submit">{busy === 'append' ? '保存调研中…' : '追加调研'}</button></div></fieldset>{feedbackFor('append')}</form></section>
    <section><h4>调研过程</h4>{!topic.entries.length && <p className="muted">还没有调研记录。</p>}<ol className="research-history">{visibleEntries.map(entry => <li key={entry.id}><time dateTime={entry.research_date}>{formatCalendarDate(entry.research_date)}</time><p>{entry.content}</p>{entry.sources.length > 0 && <p className="research-source">来源：<ResearchSources sources={entry.sources} /></p>}{entry.uncertainties && <p>待确认：{entry.uncertainties}</p>}</li>)}</ol>{topic.entries.length > 3 && <button className="research-secondary" type="button" aria-expanded={allEntries} onClick={() => setAllEntries(value => !value)}>{allEntries ? '只看最近 3 次' : `查看全部 ${topic.entries.length} 次调研`}</button>}</section>
  </article>
}
export function ResearchView({ initialTopicId }: { initialTopicId?: string } = {}) {
  const [title, setTitle] = useDraft('research:new-title', '')
  const [items, setItems] = useState<ResearchTopic[]>([])
  const [selected, setSelected] = useState<ResearchTopic | null>(null)
  const [filter, setFilter] = useState<ResearchStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [revision, setRevision] = useState(0)
  // 写操作与反馈按主题保存在父层，切走再返回不会绕过等待状态。
  const [pending, setPending] = useState<Record<string, Operation | null>>({})
  const [operationFeedback, setOperationFeedback] = useState<Record<string, OperationFeedback>>({})
  const [detailMode, setDetailMode] = useState(false)
  const detailPane = useRef<HTMLDivElement>(null)
  const listPane = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const focusDetail = useRef(false)
  const focusList = useRef(false)
  const openedInitialTopic = useRef('')
  useEffect(() => {
    if (focusDetail.current) {
      // 桌面详情与列表并排，只转移键盘焦点；避免长卡片获焦时把页面拉到底部。
      detailPane.current?.focus({ preventScroll: true })
      if (window.matchMedia?.('(max-width: 760px)').matches) detailPane.current?.scrollIntoView?.({ block: 'start' })
      focusDetail.current = false
    }
    if (focusList.current) {
      const target = listPane.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? searchInput.current
      target?.focus({ preventScroll: true }); target?.scrollIntoView?.({ block: 'nearest' }); focusList.current = false
    }
  }, [detailMode, selected?.id])
  const detailRequest = useRef(0)
  const mutationVersion = useRef(0)
  const selectedId = useRef<string | null>(null)
  selectedId.current = selected?.id ?? null
  useEffect(() => {
    let active = true
    const version = mutationVersion.current
    setLoading(true); setError('')
    listResearch().then(data => { if (active && version === mutationVersion.current) setItems(data.items) }).catch(failure => { if (active && version === mutationVersion.current) setError(messageOf(failure)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])
  const saved = (topic: ResearchTopic) => {
    mutationVersion.current += 1
    if (selectedId.current === topic.id) { detailRequest.current += 1; setSelected(topic) }
    setItems(previous => [topic, ...previous.filter(item => item.id !== topic.id)])
  }
  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) { setError('请先写下想调研的问题。'); return }
    setSaving(true); setError('')
    try { const topic = await createResearch(title.trim()); saved(topic); setSelected(topic); focusDetail.current = true; setDetailMode(true); detailRequest.current += 1; setDetailError(''); setTitle('') } catch (failure) { setError(messageOf(failure)) } finally { setSaving(false) }
  }
  const open = (topic: ResearchTopic) => {
    focusDetail.current = true; setDetailMode(true)
    setSelected(topic); setDetailError('')
    const requestId = ++detailRequest.current
    // 先展示列表快照，再获取最新详情；失败时保留主题和草稿。
    void getResearch(topic.id).then(fresh => { if (detailRequest.current === requestId) setSelected(current => current?.id === topic.id ? fresh : current) }).catch(failure => { if (detailRequest.current === requestId) setDetailError(messageOf(failure)) })
  }
  useEffect(() => {
    if (!initialTopicId || loading || openedInitialTopic.current === initialTopicId) return
    openedInitialTopic.current = initialTopicId
    // 从记录详情直达同一主题，不要求用户再次搜索。
    const topic = items.find(item => item.id === initialTopicId)
    if (topic) open(topic)
    else void getResearch(initialTopicId).then(open).catch(failure => setDetailError(messageOf(failure)))
  }, [initialTopicId, loading, items])
  const visible = items.filter(topic => (filter === 'all' || (topic.status === 'concluded' ? 'comparing' : topic.status) === filter) && `${topic.title} ${topic.question} ${topic.description ?? ''} ${topic.entries.map(entry => `${entry.content} ${entry.sources.join(' ')} ${entry.uncertainties ?? ''}`).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <section className={`view-panel research-page${detailMode ? ' research-show-detail' : ''}`}><header><h2>调研笔记</h2></header>
    <form className="research-capture" onSubmit={create}><label>随手记一个问题<input disabled={saving || loading} value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="想到什么先记下来，之后再调研" /></label><button type="submit" disabled={saving || loading}>{saving ? '保存中…' : '记下问题'}</button></form>
    {error && <div role="alert" className="error-text">{error}<button className="text-button" type="button" onClick={() => setRevision(value => value + 1)}>重新加载</button></div>}
    <div className="research-toolbar"><label>搜索调研<input ref={searchInput} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索主题和调研内容" /></label><label><span>筛选状态</span><Select aria-label="筛选状态" value={filter} onChange={event => setFilter(event.target.value as ResearchStatus | 'all')}><option value="all">全部</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label></div>
    {loading && <p role="status">正在读取调研主题…</p>}
    {!loading && !error && !visible.length && <div className="empty-state research-empty"><p>{items.length ? '当前筛选下没有调研主题。' : '还没有调研主题，从上方记下第一个问题。'}</p>{items.length > 0 && <button className="research-secondary" type="button" onClick={() => { setSearch(''); setFilter('all') }}>清除筛选</button>}</div>}
    <div className="research-workspace"><div ref={listPane} className="research-list" aria-label="调研主题">{visible.map(topic => <button className="research-topic" key={topic.id} type="button" aria-pressed={selected?.id === topic.id} onClick={() => open(topic)}><strong>{topic.title}</strong><span>{statusLabels[topic.status === 'concluded' ? 'comparing' : topic.status]}</span><small>{topic.entries.length} 次调研 · {formatBeijingDateTime(topic.updated_at)}</small></button>)}</div><div ref={detailPane} className="research-detail-pane" tabIndex={-1} aria-label={selected ? `调研详情：${selected.title}` : '调研详情'}><button className="research-secondary research-back" type="button" onClick={() => { focusList.current = true; setDetailMode(false) }}>返回主题列表</button>{detailError && <p className="error-text" role="alert">{detailError}</p>}{selected && <ResearchDetail key={selected.id} topic={selected} onSaved={saved} busy={pending[selected.id] ?? null} setBusy={operation => { const id = selected.id; setPending(previous => ({ ...previous, [id]: operation })) }} feedback={operationFeedback[selected.id] ?? {}} setFeedback={update => { const id = selected.id; setOperationFeedback(previous => ({ ...previous, [id]: update(previous[id] ?? {}) })) }} />}</div></div>
  </section>
}




