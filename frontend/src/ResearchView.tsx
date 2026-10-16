import { HttpError } from './http'
import { listTopics, type Topic } from './topicsApi'
import { DropdownChevron } from './DropdownChevron'
import { VoiceField } from './VoiceField'
import { RecordConflict, conflictRecord } from './RecordConflict'
import type { ProjectionRecord } from './domainApi'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { appendResearchEntry, createResearch, getResearch, listResearch, updateResearchStatus, updateResearchTopics, type ResearchStatus, type ResearchTopic } from './researchApi'
import { beijingToday, formatBeijingDateTime, formatCalendarDate } from './time'
import { useTopicDraft } from './useTopicDraft'
import { RecordAssociations, useAssociationOptions } from './RecordAssociations'
import { useNavigationGuard } from './navigationGuard'
import { TopicSelect } from './TopicSelect'
import { Select } from './Select'
import './research.css'
import './BusinessEntryForm.css'

const statusLabels: Record<ResearchStatus, string> = { collecting: '待调研', comparing: '调研中', archived: '已归档' }
type Operation = 'status' | 'append' | 'topics'
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

// 背景字段草稿按父事项保存，切换事项和保存失败都不丢失。
function useAssociationDraft(key: string, initial: Record<string, unknown>, busy: boolean) {
  const serialized = JSON.stringify(initial)
  const [draft, setDraft] = useDraft(key, serialized)
  let payload: Record<string, unknown> = initial
  try { payload = JSON.parse(draft) as Record<string, unknown> } catch { /* 损坏的旧草稿回退为服务端值。 */ }
  useNavigationGuard(draft !== serialized || busy)
  return { payload, change: (field: string, value: unknown) => setDraft(JSON.stringify({ ...payload, [field]: value })), replace: (value: Record<string, unknown>) => setDraft(JSON.stringify(value)), clear: (value: Record<string, unknown> = {}) => { setDraft(JSON.stringify(value)); try { sessionStorage.removeItem(key) } catch { /* 存储不可用时仍清理本页。 */ } } }
}
const associationsOf = (topic: ResearchTopic): Record<string, unknown> => ({ space_ids: topic.space_ids ?? [], material_ids: topic.material_ids ?? [], participant_ids: topic.participant_ids ?? [], related_record_ids: topic.related_record_ids ?? [], stage_id: topic.stage_id ?? null })

function ResearchDetail({ topic, onSaved, busy, setBusy, feedback, setFeedback, initialMatchId }: {
  initialMatchId?: string; topic: ResearchTopic; onSaved: (topic: ResearchTopic) => void
  busy: Operation | null; setBusy: (operation: Operation | null) => void
  feedback: OperationFeedback; setFeedback: (update: (previous: OperationFeedback) => OperationFeedback) => void
}) {
  const prefix = `research:${topic.id}:`
  const [date, setDate] = useDraft(`${prefix}date`, beijingToday())
  const [content, setContent] = useDraft(`${prefix}content`, '')
  const [sources, setSources] = useDraft(`${prefix}sources`, '')
  const [uncertainties, setUncertainties] = useDraft(`${prefix}uncertainties`, '')
  const [contentOverflow, setContentOverflow] = useDraft(`${prefix}content-overflow`, '')
  const [sourcesOverflow, setSourcesOverflow] = useDraft(`${prefix}sources-overflow`, '')
  const [uncertaintiesOverflow, setUncertaintiesOverflow] = useDraft(`${prefix}uncertainties-overflow`, '')
  const hasOverflow = !!(contentOverflow || sourcesOverflow || uncertaintiesOverflow)
  useNavigationGuard(hasOverflow || !!content.trim() || !!sources.trim() || !!uncertainties.trim() || busy !== null)
  const { value: topicIds, change: setTopicIds, clear: clearTopics } = useTopicDraft(`${prefix}topics`, topic.topic_ids ?? [], busy !== null)
  const options = useAssociationOptions()
  const associations = useAssociationDraft(`${prefix}associations`, associationsOf(topic), busy === 'topics')
  const [allEntries, setAllEntries] = useState(false)
  const [appendOpen, setAppendOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [editingInfo, setEditingInfo] = useState(false)
  const [topicOptions, setTopicOptions] = useState<Topic[]>([])
  const [topicOptionsError, setTopicOptionsError] = useState('')
  const appendButton = useRef<HTMLButtonElement>(null)
  const contentField = useRef<HTMLTextAreaElement>(null)
  const infoButton = useRef<HTMLButtonElement>(null)
  const archived = topic.status === 'archived'
  const hasAppendDraft = hasOverflow || !!(content.trim() || sources.trim() || uncertainties.trim())
  useEffect(() => {
    let active = true
    listTopics().then(result => { if (active) setTopicOptions(result.items) }).catch(() => { if (active) setTopicOptionsError('主题名称读取失败。') })
    return () => { active = false }
  }, [])
  useEffect(() => { if (archived) setAppendOpen(false) }, [archived])
  useEffect(() => { if (feedback.topics?.error) { setInfoOpen(true); setEditingInfo(true) } }, [feedback.topics?.error])
  // 切回保存中的事项仍显示收起入口，但禁止重复操作；保存结束后同步关闭。
  const previousBusy = useRef(busy)
  useEffect(() => { if (previousBusy.current === 'append' && busy === null && feedback.append?.success) setAppendOpen(false); previousBusy.current = busy }, [busy, feedback.append?.success])
  useEffect(() => { if (appendOpen) contentField.current?.focus({ preventScroll: true }) }, [appendOpen])
  const [voiceBusy, setVoiceBusy] = useState(false)
  const focusedMatch = useRef('')
  useEffect(() => { if (!initialMatchId || focusedMatch.current === initialMatchId) return; setAllEntries(true); const frame = requestAnimationFrame(() => { const node = Array.from(document.querySelectorAll<HTMLElement>('[data-search-match]')).find(element => element.dataset.searchMatch === initialMatchId); if (node) focusedMatch.current = initialMatchId; node?.focus({ preventScroll: true }); node?.scrollIntoView?.({ block: 'center' }) }); return () => cancelAnimationFrame(frame) }, [initialMatchId, topic.entries])
  const versionKey = `${prefix}edit-version`
  const [baseVersion, setBaseVersion] = useState(() => {
    try { const stored = sessionStorage.getItem(versionKey); return stored ? Number(stored) : topic.version } catch { return topic.version }
  })
  const [statusVersion, setStatusVersion] = useState(topic.version)
  useEffect(() => { setStatusVersion(topic.version) }, [topic.version])
  const legacyDraft = useRef(false)
  const [statusDraft, setStatusDraft] = useState<ResearchStatus | null>(null)
  const [conflict, setConflict] = useState<{ latest: ProjectionRecord; kind: Operation } | null>(null)
  const associationDirty = JSON.stringify(topicIds) !== JSON.stringify(topic.topic_ids ?? []) || JSON.stringify(associations.payload) !== JSON.stringify(associationsOf(topic))
  useEffect(() => {
    // 恢复的旧草稿没有版本时必须先核对，不能拿最新版本替旧草稿背书。
    try { if (associationDirty && !sessionStorage.getItem(versionKey)) legacyDraft.current = true } catch { /* 存储不可用时仍保留当前页面基准。 */ }
  }, [])
  useEffect(() => {
    if (!associationDirty) { setBaseVersion(topic.version); try { sessionStorage.removeItem(versionKey) } catch { /* 保留页面状态。 */ } }
    else { try { sessionStorage.setItem(versionKey, String(baseVersion)) } catch { /* 保留页面状态。 */ } }
  }, [associationDirty, topic.version, baseVersion, versionKey])
  const setError = (kind: Operation, error: string) => setFeedback(previous => ({ ...previous, [kind]: { error } }))
  const run = async (kind: Operation, operation: () => Promise<ResearchTopic>, clear?: () => void) => {
    if (kind === 'topics' && legacyDraft.current) {
      setConflict({ latest: { ...topic, record_type: 'research' } as unknown as ProjectionRecord, kind })
      setError(kind, '恢复的草稿需要与最新记录核对后再保存。')
      return
    }
    if (voiceBusy) return; setBusy(kind); setFeedback(previous => ({ ...previous, [kind]: {} }))
    try {
      const saved = await operation(); clear?.(); if (kind === 'topics') { setEditingInfo(false); infoButton.current?.focus({ preventScroll: true }); clearTopics(saved.topic_ids ?? []); associations.clear(associationsOf(saved)); setBaseVersion(saved.version); legacyDraft.current = false } onSaved(saved)
      window.dispatchEvent(new Event('research-draft-saved'))
      setFeedback(previous => ({ ...previous, [kind]: { success: { status: '事项状态已保存。', append: '本次调研已保存。', topics: '事项信息已保存。' }[kind] } }))
    } catch (failure) {
      const latest = conflictRecord(failure)
      if (latest && kind !== 'append') setConflict({ latest, kind })
      if (kind === 'topics') { setInfoOpen(true); setEditingInfo(true) }
      // 旧页面追加遇到归档或并发状态变化时刷新详情；草稿不清空。
      if (kind === 'append' && failure instanceof HttpError && failure.status === 409) {
        try { onSaved(await getResearch(topic.id)) } catch { /* 读取失败仍保留原错误和草稿。 */ }
      }
      setError(kind, messageOf(failure))
    } finally { setBusy(null) }
  }
  const feedbackFor = (kind: Operation) => <div className="research-feedback" aria-live="polite" aria-atomic="true">{busy === kind && <p role="status">保存中…</p>}{feedback[kind]?.error && <p className="error-text" role="alert">{feedback[kind]?.error}</p>}{feedback[kind]?.success && <p role="status">{feedback[kind]?.success}</p>}</div>
  const append = (event: FormEvent) => {
    event.preventDefault()
    if (archived || busy !== null || voiceBusy || hasOverflow) return
    if (!content.trim()) { setError('append', '请填写本次调研内容。'); return }
    void run('append', () => appendResearchEntry(topic.id, { research_date: date, content: content.trim(), sources: sources.split('\n').map(value => value.trim()).filter(Boolean), uncertainties: uncertainties.trim() }), () => { setContent(''); setSources(''); setUncertainties(''); setDate(beijingToday()); setAppendOpen(false); appendButton.current?.focus({ preventScroll: true }); try { sessionStorage.removeItem(`${prefix}date`) } catch { /* 保留本页日期。 */ } })
  }
  // 接口按日期升序返回，近期优先展示；展开后仍能查看全部历史。
  const recentEntries = [...topic.entries].reverse()
  const visibleEntries = allEntries ? recentEntries : recentEntries.slice(0, 3)
  return <article className="research-detail" aria-label="调研事项详情">
    <header><h3>{topic.title}</h3><div className="research-status"><label className="research-status-row"><span>事项状态</span><Select aria-label="事项状态" value={statusDraft ?? (topic.status === 'concluded' ? 'comparing' : topic.status)} disabled={busy !== null || voiceBusy} onChange={event => { const status = event.target.value as ResearchStatus; setStatusDraft(status); void run('status', () => updateResearchStatus(topic.id, status, statusVersion), () => setStatusDraft(null)) }}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></label>{feedbackFor('status')}</div></header>
    {conflict && <RecordConflict latest={conflict.latest} draft={conflict.kind === 'topics' ? { ...associations.payload, topic_ids: topicIds } : { status: statusDraft ?? topic.status }} onResolve={(payload, version) => { legacyDraft.current = false; if (conflict.kind === 'topics') { setBaseVersion(version); setTopicIds(payload.topic_ids as string[]); associations.replace(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'topic_ids'))) } else { setStatusVersion(version); setStatusDraft(payload.status as ResearchStatus) }; setConflict(null) }} onCancel={() => setConflict(null)} />}{statusDraft && <button type="button" disabled={busy !== null || voiceBusy} onClick={() => void run('status', () => updateResearchStatus(topic.id, statusDraft, statusVersion), () => setStatusDraft(null))}>保存已核对状态</button>}
    <section aria-label="调研过程"><div className="research-process-heading"><h4>调研过程</h4>{archived ? <button className="research-secondary" type="button" disabled={busy !== null || voiceBusy} onClick={() => { setStatusDraft('comparing'); void run('status', () => updateResearchStatus(topic.id, 'comparing', statusVersion), () => setStatusDraft(null)) }}>恢复调研</button> : <button ref={appendButton} className="research-secondary" type="button" aria-expanded={appendOpen} aria-controls={`research-append-${topic.id}`} disabled={busy !== null} onClick={() => { setAppendOpen(value => !value); setVoiceBusy(false) }}>{appendOpen ? '收起追加' : hasAppendDraft ? '继续追加' : '追加调研'}</button>}</div>
      {appendOpen && !archived && <form id={`research-append-${topic.id}`} onSubmit={append}><fieldset className="research-form" disabled={busy !== null}><label>调研日期<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label><label>本次调研<VoiceField overflowDraft={{ text: contentOverflow, onChange: setContentOverflow }} active={busy === null} onBusyChange={setVoiceBusy}><textarea aria-label="本次调研" ref={contentField} rows={4} maxLength={10000} value={content} onChange={event => setContent(event.target.value)} placeholder="查到的资料、自己的判断、比较结果…" /></VoiceField></label><label>信息来源<VoiceField overflowDraft={{ text: sourcesOverflow, onChange: setSourcesOverflow }} active={busy === null} onBusyChange={setVoiceBusy}><textarea aria-label="信息来源" rows={2} maxLength={10000} value={sources} onChange={event => setSources(event.target.value)} placeholder="链接或资料名称，每行一条" /></VoiceField></label><label>尚未确认<VoiceField overflowDraft={{ text: uncertaintiesOverflow, onChange: setUncertaintiesOverflow }} active={busy === null} onBusyChange={setVoiceBusy}><textarea aria-label="尚未确认" rows={2} maxLength={10000} value={uncertainties} onChange={event => setUncertainties(event.target.value)} /></VoiceField></label><div className="research-actions"><button disabled={busy !== null || voiceBusy || hasOverflow} type="submit">{busy === 'append' ? '保存调研中…' : '保存调研'}</button></div></fieldset>{feedbackFor('append')}</form>}
      {!appendOpen && feedbackFor('append')}{!topic.entries.length && <p className="muted">还没有调研记录。</p>}<ol className="research-history">{visibleEntries.map(entry => <li key={entry.id} data-search-match={entry.id} tabIndex={-1}><time dateTime={entry.research_date}>{formatCalendarDate(entry.research_date)}</time><p>{entry.content}</p>{entry.sources.length > 0 && <p className="research-source">来源：<ResearchSources sources={entry.sources} /></p>}{entry.uncertainties && <p>待确认：{entry.uncertainties}</p>}</li>)}</ol>{topic.entries.length > 3 && <button className="research-secondary" type="button" aria-expanded={allEntries} onClick={() => setAllEntries(value => !value)}>{allEntries ? '只看最近 3 次' : `查看全部 ${topic.entries.length} 次调研`}</button>}</section>
    <section className="research-info">
      <button ref={infoButton} type="button" className="research-info-toggle" aria-expanded={infoOpen} aria-controls={`research-info-${topic.id}`} disabled={busy === 'topics'} onClick={() => setInfoOpen(value => !value)}><span>事项信息</span><DropdownChevron open={infoOpen} /></button>
      {infoOpen && <div id={`research-info-${topic.id}`} className="research-info-body">
        {topic.description && <p>{topic.description}</p>}
        {topic.question && topic.question !== topic.title && <p>调研问题：{topic.question}</p>}
        {editingInfo ? <><TopicSelect value={topicIds} onChange={setTopicIds} disabled={busy !== null || voiceBusy} /><RecordAssociations inline payload={{ ...associations.payload, topic_ids: topicIds }} onChange={associations.change} entities={options.entities} records={options.records} currentRecordId={topic.id} disabled={busy !== null || voiceBusy} loading={options.loading} optionsError={options.error} onRetry={options.retry} error={/空间|材料|阶段|人员|关联|space|material|participant|stage|related/i.test(feedback.topics?.error ?? '') ? feedback.topics?.error : undefined} /><div className="research-info-actions"><button className="research-primary" type="button" disabled={busy !== null || voiceBusy} onClick={() => void run('topics', () => updateResearchTopics(topic.id, topicIds, associations.payload, baseVersion))}>保存修改</button><button className="research-secondary" type="button" disabled={busy !== null || voiceBusy} onClick={() => { setEditingInfo(false); infoButton.current?.focus({ preventScroll: true }) }}>取消编辑</button></div>{feedbackFor('topics')}</> : <>
          <dl className="research-info-values">
            {!!topic.topic_ids?.length && <><dt>所属主题</dt><dd>{topic.topic_ids.map(id => topicOptions.find(item => item.id === id)?.name ?? '已关联主题（名称待读取）').join('、')}</dd></>}
            {([['空间', topic.space_ids, options.entities.spaces], ['材料', topic.material_ids, options.entities.materials], ['相关人员', topic.participant_ids, options.entities.participants], ['关联记录', topic.related_record_ids, options.records.map(item => ({ id: item.id, name: item.title }))]] as const).map(([label, ids, choices]) => !!ids?.length && <div key={label}><dt>{label}</dt><dd>{ids.map(id => choices.find(item => item.id === id)?.name ?? '信息待读取').join('、')}</dd></div>)}
            {topic.stage_id && <><dt>装修阶段</dt><dd>{options.entities.stages.find(item => item.id === topic.stage_id)?.name ?? '信息待读取'}</dd></>}
          </dl>
          {topicOptionsError && !!topic.topic_ids?.length && <p role="alert">{topicOptionsError}</p>}
          {options.error && <p role="alert">{options.error}<button type="button" onClick={options.retry}>重试</button></p>}
          <button type="button" className="research-secondary" disabled={busy !== null || voiceBusy} onClick={() => setEditingInfo(true)}>{associationDirty ? '继续编辑信息' : '编辑信息'}</button>
          {feedbackFor('topics')}
        </>}
      </div>}
    </section>
  </article>
}
export function ResearchView({ initialResearchId, initialTopicId, initialMatchId }: { initialResearchId?: string; initialTopicId?: string; initialMatchId?: string } = {}) {
  const [captureOpen, setCaptureOpen] = useState(!!initialTopicId)
  const [title, setTitle] = useDraft('research:new-title', '')
  const [items, setItems] = useState<ResearchTopic[]>([])
  const [selected, setSelected] = useState<ResearchTopic | null>(null)
  const [filter, setFilter] = useState<ResearchStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { value: topicIds, change: setTopicIds, clear: clearTopics } = useTopicDraft(`research:new:${initialTopicId ?? 'none'}:topics`, initialTopicId ? [initialTopicId] : [], saving)
  const options = useAssociationOptions()
  const associations = useAssociationDraft(`research:new:${initialTopicId ?? 'none'}:associations`, {}, saving)
  useNavigationGuard(!!title.trim() || saving)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [revision, setRevision] = useState(0)
  // 写操作与反馈按主题保存在父层，切走再返回不会绕过等待状态。
  const [pending, setPending] = useState<Record<string, Operation | null>>({})
  const [operationFeedback, setOperationFeedback] = useState<Record<string, OperationFeedback>>({})
  const [detailMode, setDetailMode] = useState(false)
  const [openRevision, setOpenRevision] = useState(0)
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
    try { const topic = await createResearch(title.trim(), topicIds, associations.payload); setCaptureOpen(false); associations.clear(); clearTopics(); saved(topic); setSelected(topic); focusDetail.current = true; setDetailMode(true); detailRequest.current += 1; setDetailError(''); setTitle('') } catch (failure) { setError(messageOf(failure)) } finally { setSaving(false) }
  }
  const open = (topic: ResearchTopic) => {
    setOpenRevision(value => value + 1)
    focusDetail.current = true; setDetailMode(true)
    setSelected(topic); setDetailError('')
    const requestId = ++detailRequest.current
    // 先展示列表快照，再获取最新详情；失败时保留主题和草稿。
    void getResearch(topic.id).then(fresh => { if (detailRequest.current === requestId) setSelected(current => current?.id === topic.id ? fresh : current) }).catch(failure => { if (detailRequest.current === requestId) setDetailError(messageOf(failure)) })
  }
  useEffect(() => {
    if (!initialResearchId || loading || openedInitialTopic.current === initialResearchId) return
    openedInitialTopic.current = initialResearchId
    // 从记录详情直达同一主题，不要求用户再次搜索。
    const topic = items.find(item => item.id === initialResearchId)
    if (topic) open(topic)
    else void getResearch(initialResearchId).then(open).catch(failure => setDetailError(messageOf(failure)))
  }, [initialResearchId, loading, items])
  const visible = items.filter(topic => (filter === 'all' || (topic.status === 'concluded' ? 'comparing' : topic.status) === filter) && `${topic.title} ${topic.question} ${topic.description ?? ''} ${topic.entries.map(entry => `${entry.content} ${entry.sources.join(' ')} ${entry.uncertainties ?? ''}`).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <section className={`view-panel research-page${detailMode ? ' research-show-detail' : ''}`}><header className="business-page-header"><h2>调研笔记</h2><button className="business-entry-toggle research-capture-toggle" type="button" aria-expanded={captureOpen} aria-controls="research-capture" disabled={saving} onClick={() => setCaptureOpen(value => !value)}>{captureOpen ? '收起' : '新增调研'}</button></header>
    {captureOpen && <form id="research-capture" className="research-capture" onSubmit={create}><label>随手记一个问题<input disabled={saving || loading} value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="想到什么先记下来，之后再调研" /></label><TopicSelect value={topicIds} onChange={setTopicIds} disabled={saving} /><RecordAssociations payload={{ ...associations.payload, topic_ids: topicIds }} onChange={associations.change} entities={options.entities} records={options.records} disabled={saving} loading={options.loading} optionsError={options.error} onRetry={options.retry} error={/空间|材料|阶段|人员|关联|space|material|participant|stage|related/i.test(error) ? error : undefined} /><button type="submit" disabled={saving || loading}>{saving ? '保存中…' : '记下问题'}</button></form>}
    {error && <div role="alert" className="error-text">{error}<button className="text-button" type="button" onClick={() => setRevision(value => value + 1)}>重新加载</button></div>}
    <div className="research-toolbar"><label>搜索调研<input ref={searchInput} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索事项和调研内容" /></label><label><span>筛选状态</span><Select aria-label="筛选状态" value={filter} onChange={event => setFilter(event.target.value as ResearchStatus | 'all')}><option value="all">全部</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label></div>
    {loading && <p role="status">正在读取调研事项…</p>}
    {!loading && !error && !visible.length && <div className="empty-state research-empty"><p>{items.length ? '当前筛选下没有调研事项。' : '还没有调研事项，从上方记下第一个问题。'}</p>{items.length > 0 && <button className="research-secondary" type="button" onClick={() => { setSearch(''); setFilter('all') }}>清除筛选</button>}</div>}
    <div className="research-workspace"><div ref={listPane} className="research-list" aria-label="调研事项">{visible.map(topic => <button className="research-topic" key={topic.id} type="button" aria-pressed={selected?.id === topic.id} onClick={() => open(topic)}><strong>{topic.title}</strong><span>{statusLabels[topic.status === 'concluded' ? 'comparing' : topic.status]}</span><small>{topic.entries.length} 次调研 · {formatBeijingDateTime(topic.updated_at)}</small></button>)}</div><div ref={detailPane} className="research-detail-pane" tabIndex={-1} aria-label={selected ? `调研详情：${selected.title}` : '调研详情'}><button className="research-secondary research-back" type="button" onClick={() => { focusList.current = true; setDetailMode(false) }}>返回事项列表</button>{detailError && <p className="error-text" role="alert">{detailError}</p>}{selected && <ResearchDetail key={`${selected.id}:${openRevision}`} initialMatchId={initialMatchId} topic={selected} onSaved={saved} busy={pending[selected.id] ?? null} setBusy={operation => { const id = selected.id; setPending(previous => ({ ...previous, [id]: operation })) }} feedback={operationFeedback[selected.id] ?? {}} setFeedback={update => { const id = selected.id; setOperationFeedback(previous => ({ ...previous, [id]: update(previous[id] ?? {}) })) }} />}</div></div>
  </section>
}




