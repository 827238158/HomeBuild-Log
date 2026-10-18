import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { defaultPayload, payloadForSave, RecordEditFields, type RecordType } from './DomainWorkspace'
import { listIssueActivities, appendIssueActivity, type IssueActivity, getRecord, getSource, listRelations, listRecordAudit, listSpaces, listRecords, listEntities, createRecord, updateRecord, deleteRecord, reviewRecordSource, type ProjectionRecord, type SourceDetail, type AuditEntry, type DomainRecord, type SpaceEntry, type NamedEntity } from './domainApi'
import { recordStatusLabel, recordTypeLabels } from './recordLabels'
import { beijingToday, formatCalendarDate, formatBeijingDateTime } from './time'
import { RecordFacts } from './RecordFacts'
import { AttachmentViewer } from './AttachmentViewer'
import { useModalFocus } from './useModalFocus'
import { confirmNavigation, useNavigationGuard } from './navigationGuard'
import { RecordConflict, conflictRecord } from './RecordConflict'
import { VoiceField } from './VoiceField'

const auditLabels: Record<string, string> = { create: '创建记录', update: '修改内容', delete: '删除记录', archive: '隐藏记录', restore: '重新显示', review: '复核来源', confirm: '确认候选' }
const message = (failure: unknown) => failure instanceof Error ? failure.message : '读取失败，请重试。'

export function RecordDetail({ recordId, closing, onClose, onChanged, onExitComplete, onOpen, onOpenSource, onOpenResearch, initialMatchId }: {
  recordId: string; closing: boolean; onClose: () => void; onChanged: () => void; onExitComplete: () => void
  onOpen: (id: string) => void; onOpenSource: (id: string) => void; onOpenResearch: (id: string) => void
  initialMatchId?: string
}) {
  const panel = useRef<HTMLElement>(null)
  const [record, setRecord] = useState<ProjectionRecord | null>(null)
  const [sources, setSources] = useState<SourceDetail[]>([])
  const [related, setRelated] = useState<ProjectionRecord[]>([])
  const [activities, setActivities] = useState<IssueActivity[]>([])
  const [note, setNote] = useState(() => { try { return sessionStorage.getItem(`issue:${recordId}:note`) ?? '' } catch { return '' } })
  const [noteBusy, setNoteBusy] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [noteSuccess, setNoteSuccess] = useState('')
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [error, setError] = useState('')
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({})
  const [sectionsLoading, setSectionsLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState(false)
  const [remeasuring, setRemeasuring] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editPayload, setEditPayload] = useState<Record<string, unknown>>({})
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [allRecords, setAllRecords] = useState<DomainRecord[]>([])
  const [entities, setEntities] = useState({ materials: [] as NamedEntity[], vendors: [] as NamedEntity[], participants: [] as NamedEntity[], stages: [] as NamedEntity[] })
  const [resourcesReady, setResourcesReady] = useState(false)
  const [resourcesLoading, setResourcesLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [noteVoiceBusy, setNoteVoiceBusy] = useState(false)
  const [conflict, setConflict] = useState<ProjectionRecord | null>(null)
  const [editVersion, setEditVersion] = useState<number | undefined>()
  const focusReadMode = useRef(false)
  useEffect(() => {
    if (editing && resourcesReady) panel.current?.querySelector<HTMLInputElement>('.detail-edit-section input')?.focus()
    else if (!editing && focusReadMode.current) { focusReadMode.current = false; panel.current?.querySelector<HTMLButtonElement>('[data-edit-record]')?.focus() }
  }, [editing, resourcesReady])
  useNavigationGuard((editing && (dirty || busy)) || !!note.trim() || noteBusy, busy ? '记录正在保存，暂时离开可能无法确认保存结果，确定离开吗？' : undefined)
  useModalFocus(panel, true, () => { if (confirmNavigation()) onClose() })

  useEffect(() => {
    try { setNote(sessionStorage.getItem(`issue:${recordId}:note`) ?? '') } catch { setNote('') }
    setNoteError(''); setNoteSuccess(''); setActivities([])
  }, [recordId])

  useEffect(() => {
    let active = true
    setError('')
    getRecord(recordId).then(value => { if (active) setRecord(value) }).catch(failure => { if (active) setError(message(failure)) })
    return () => { active = false }
  }, [recordId, reload])

  useEffect(() => {
    if (!record) return
    let active = true
    setSectionErrors({}); setSectionsLoading(true)
    // 主体不依赖来源、审计和关联成功；各区域可以独立失败和恢复。
    const load = async (key: string, operation: () => Promise<unknown>) => {
      try { await operation() } catch (failure) { if (active) setSectionErrors(previous => ({ ...previous, [key]: message(failure) })) }
    }
    void Promise.all([
      load('sources', async () => { const values = await Promise.all(record.source_refs.map(item => getSource(item.source_id))); if (active) setSources(values) }),
      load('relations', async () => { const rows = await listRelations(recordId); const ids = [...new Set(rows.flatMap(item => [item.from_record_id, item.to_record_id]).filter(id => id !== recordId))]; const values = await Promise.all(ids.map(getRecord)); if (active) setRelated(values) }),
      ...(record.record_type === 'issue' ? [load('activities', async () => { const result = await listIssueActivities(recordId); if (active) setActivities(result.items) })] : []),
      load('audit', async () => { const values = await listRecordAudit(recordId); if (active) setAudit(values) }),
    ]).finally(() => { if (active) setSectionsLoading(false) })
    return () => { active = false }
  }, [record, recordId, reload])

  const loadEditResources = async () => {
    setResourcesLoading(true); setError('')
    try {
      const [spaceRows, recordRows, materials, vendors, participants, stages] = await Promise.all([listSpaces(), listRecords(undefined), listEntities('materials'), listEntities('vendors'), listEntities('participants'), listEntities('stages')])
      setSpaces(spaceRows); setAllRecords(recordRows); setEntities({ materials, vendors, participants, stages }); setResourcesReady(true)
    } catch (failure) { setError(`编辑选项加载失败：${message(failure)}`) }
    finally { setResourcesLoading(false) }
  }
  const beginEdit = () => {
    if (!record) return
    setConflict(null); setEditVersion(record.version)
    setRemeasuring(false); setEditPayload({ ...defaultPayload(record.record_type as RecordType, record), topic_ids: record.topic_ids ?? [] }); setDirty(false); setEditing(true)
    if (!resourcesReady) void loadEditResources()
  }
  const beginRemeasure = () => {
    if (!record || record.record_type !== 'measurement') return
    // 复测只复用对象与关联信息；旧数值、来源和说明不能成为新的现场事实。
    const values = Array.isArray(record.values) ? record.values.filter(item => item && typeof item === 'object').map(item => ({ ...(item as Record<string, unknown>), value: null })) : []
    setEditPayload(defaultPayload('measurement', {
      title: record.title, object_name: record.object_name, measurement_role: 'site_measurement',
      space_ids: record.space_ids, material_ids: record.material_ids, participant_ids: record.participant_ids,
      stage_id: record.stage_id, topic_ids: record.topic_ids ?? [], related_record_ids: [record.id], values, status: 'active',
      occurred_date: beijingToday(), measured_at: null, source_refs: [],
    }))
    setRemeasuring(true); setDirty(true); setEditing(true); setError('')
    if (!resourcesReady) void loadEditResources()
  }
  const change = (field: string, value: unknown) => {
    setDirty(true)
    setEditPayload(current => {
      const next = { ...current, [field]: value }
      if (record?.record_type === 'issue' && field === 'status') {
        if (value === 'done' && !current.completed_at) next.completed_at = beijingToday()
        if (value !== 'done') next.completed_at = null
      }
      return next
    })
  }
  const save = async () => {
    if (!record || busy || voiceBusy || conflict) return
    setBusy(true)
    try {
      const payload = payloadForSave(record.record_type, { ...editPayload, record_type: record.record_type })
      if (remeasuring && (!Array.isArray(payload.values) || !payload.values.length)) throw new Error('请至少填写一项本次测量的数值。')
      if (remeasuring) {
        // 单次提交创建与关联，避免分步操作半成功后重试造成重复测量。
        payload.related_record_ids = [...new Set([record.id, ...(Array.isArray(payload.related_record_ids) ? payload.related_record_ids : [])])]
        const created = await createRecord(payload)
        setEditing(false); setDirty(false); setError(''); onChanged(); onOpen(created.id)
        return
      }
      delete payload.source_refs
      await updateRecord(record.id, { ...payload, expected_version: editVersion })
      focusReadMode.current = true
      setEditing(false); setDirty(false); setError(''); setReload(value => value + 1); onChanged()
    } catch (failure) { setConflict(conflictRecord(failure)); setError(message(failure)) } finally { setBusy(false) }
  }
  const cancel = () => {
    if (dirty && !window.confirm('取消会放弃本次未保存的修改，确定取消吗？')) return
    setConflict(null); setEditing(false); setDirty(false); setError('')
    requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('[data-edit-record]')?.focus())
  }
  const remove = async () => {
    if (!record || !window.confirm(`确认永久删除“${record.title}”吗？\n\n记录及关联关系会被删除，原始来源和审计历史会保留。`)) return
    setBusy(true)
    try { await deleteRecord(record.id, record.version); onChanged(); onClose() } catch (failure) { setError(message(failure)); setBusy(false) }
  }
  const acknowledge = async (sourceId: string) => {
    setBusy(true)
    try { await reviewRecordSource(recordId, sourceId); setReload(value => value + 1) } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }
  const appendNote = async () => {
    if (noteBusy || noteVoiceBusy || !note.trim()) return
    setNoteBusy(true); setNoteError(''); setNoteSuccess('')
    try {
      // 只有服务端保存成功后清空草稿；失败时可继续修改并重试。
      const result = await appendIssueActivity(recordId, note.trim())
      setActivities(result.items); setNote(''); try { sessionStorage.removeItem(`issue:${recordId}:note`) } catch { /* 成功后仍清空本页草稿。 */ }; setNoteSuccess('进展已保存'); setReload(value => value + 1); onChanged()
    } catch (failure) { setNoteError(message(failure)) } finally { setNoteBusy(false) }
  }
  useEffect(() => {
    if (!initialMatchId || sectionsLoading) return
    const frame = requestAnimationFrame(() => {
      const target = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-search-match]') ?? []).find(element => element.dataset.searchMatch === initialMatchId)
      target?.scrollIntoView({ block: 'center' }); target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [initialMatchId, sectionsLoading])
  const sectionState = (key: string) => sectionErrors[key] ? <p role="alert" className="detail-section-state">{sectionErrors[key]} <button type="button" onClick={() => setReload(value => value + 1)}>重试读取</button></p> : sectionsLoading ? <p role="status">正在读取…</p> : null
  return createPortal(<>
    <button type="button" data-modal-backdrop tabIndex={-1} className="record-detail-backdrop" aria-label="关闭记录详情" onClick={() => { if (confirmNavigation()) onClose() }} />
    <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby="record-detail-title" tabIndex={-1} className={`detail-panel record-detail-panel immersive-glass immersive-glass--strong${closing ? ' is-closing' : ''}`} data-state={closing ? 'closing' : 'open'} onAnimationEnd={event => { if (closing && event.target === event.currentTarget) onExitComplete() }}>
      <div className="detail-panel__header"><h2 id="record-detail-title">{editing ? (remeasuring ? '再次测量' : '修改记录') : '记录详情'}</h2><button type="button" onClick={() => { if (confirmNavigation()) onClose() }} aria-label="关闭详情">关闭</button></div>
      {error && <p role="alert" className="view-state--error">{error} {!record && <button type="button" onClick={() => setReload(value => value + 1)}>重试读取详情</button>}</p>}
      {!record && !error && <p role="status">正在加载详情…</p>}
      {record && editing ? <section className="detail-edit-section">
        {remeasuring && <p className="muted">填写本次测量值与日期，保存为新的关联记录。原记录保留。</p>}
        {resourcesLoading && <p role="status">正在加载编辑选项…</p>}
        {!resourcesReady && !resourcesLoading && <button className="secondary-button" type="button" onClick={() => void loadEditResources()}>重试加载编辑选项</button>}
        {conflict && <RecordConflict key={conflict.version} latest={conflict} draft={payloadForSave(record.record_type, editPayload)} onCancel={() => setConflict(null)} onResolve={(payload, version) => { setEditPayload(payload); setEditVersion(version); setRecord(conflict); setConflict(null); setError(''); setDirty(true) }} />}
        {resourcesReady && <RecordEditFields active={!closing && !conflict && !busy} onVoiceBusyChange={setVoiceBusy} recordType={record.record_type as RecordType} payload={editPayload} spaces={spaces} entities={entities} records={allRecords} currentRecordId={record.id} onChange={change} error={error} />}
        <div className="record-actions"><button className="primary-button" type="button" disabled={busy || voiceBusy || !!conflict || !resourcesReady} onClick={() => void save()}>{busy ? '保存中…' : remeasuring ? '保存本次测量' : '保存修改'}</button><button type="button" disabled={busy} onClick={cancel}>取消</button></div>
      </section> : record && <>
        <span className="record-type-tag">{recordTypeLabels[record.record_type]}</span><h3>{record.title}</h3><p>{record.description || '暂无补充说明'}</p>
        <RecordFacts record={record} />
        {record.record_type === 'research' && <section className="evidence-card"><button className="secondary-button" type="button" onClick={() => onOpenResearch(record.id)}>继续调研</button></section>}
        <dl className="detail-list"><div><dt>状态</dt><dd>{recordStatusLabel(record.record_type, record.status, record.ledger_kind)}</dd></div><div><dt>事情发生日期</dt><dd>{formatCalendarDate(record.occurred_date)}</dd></div><div><dt>正式记录创建时间</dt><dd>{formatBeijingDateTime(record.created_at)}</dd></div><div><dt>空间</dt><dd>{record.spaces?.map(item => item.name).join('、') || '未指定'}</dd></div><div><dt>{record.record_type === 'issue' ? '处理人' : '参与者'}</dt><dd>{record.participants?.map(item => item.name).join('、') || '未指定'}</dd></div>
        {record.record_type === 'issue' && <><div><dt>严重程度</dt><dd>{({ low: '低', medium: '中', high: '高' } as Record<string, string>)[String(record.severity)] || '未评估'}</dd></div><div><dt>实际完成日期</dt><dd>{formatCalendarDate(record.completed_at)}</dd></div><div><dt>实际处理结果</dt><dd>{record.actual_result || '待补充'}</dd></div></>}
        </dl>
        <div className="detail-record-actions">{record.record_type === 'measurement' && <button type="button" disabled={busy} onClick={beginRemeasure}>再次测量</button>}<button type="button" data-edit-record disabled={busy} onClick={beginEdit}>修改记录</button><button className="danger-button" type="button" disabled={busy} onClick={() => void remove()}>删除记录</button></div>
        {record.record_type === 'issue' && <section><h4>事项进展与状态历史</h4><details className="muted"><summary>历史记录说明</summary><p>较早的进展可能仅保存在下方操作记录中。</p></details>{sectionState('activities')}<ol className="research-history">{activities.map(activity => <li key={activity.id} data-search-match={activity.id} tabIndex={-1}><time>{formatBeijingDateTime(activity.created_at)}</time>{activity.kind === 'status' && <p>{activity.previous_status ? recordStatusLabel('issue', activity.previous_status) : '新增事项'} → {recordStatusLabel('issue', activity.next_status ?? '')}</p>}{activity.content && <p>{activity.content}</p>}</li>)}</ol><label className="field-stack"><span>追加进展备注</span><VoiceField active={!closing && !editing} onBusyChange={setNoteVoiceBusy}><textarea rows={3} maxLength={10000} disabled={noteBusy} value={note} onChange={event => { setNote(event.target.value); try { sessionStorage.setItem(`issue:${recordId}:note`, event.target.value) } catch { /* 保留本页草稿。 */ }; setNoteSuccess('') }} /></VoiceField></label><div className="detail-record-actions"><button className="primary-button" type="button" disabled={noteBusy || noteVoiceBusy || !note.trim()} onClick={() => void appendNote()}>{noteBusy ? '保存进展中…' : '保存进展'}</button></div>{noteError && <p role="alert">{noteError}</p>}{noteSuccess && <p role="status">{noteSuccess}</p>}</section>}
        <section><h4>原始来源与附件</h4>{sectionState('sources')}{sources.map(source => <article className="evidence-card" key={source.id}>
          {record.source_refs.find(item => item.source_id === source.id)?.needs_review && <div className="source-review-warning"><span>原始数据已修改，这条正式记录待复核。</span><button type="button" disabled={busy} onClick={() => void acknowledge(source.id)}>已核对，无需修改</button></div>}
          <p>{source.original_text || '仅附件来源'}</p><small>录入时间：{formatBeijingDateTime(source.captured_at)} · 来源版本 {source.revision}</small><button className="secondary-button" type="button" onClick={() => onOpenSource(source.id)}>打开原始来源</button>
          {source.attachments.map(attachment => <AttachmentViewer key={attachment.id} attachment={attachment} />)}
        </article>)}</section>
        <section><h4>相关记录</h4>{sectionState('relations')}{!sectionsLoading && !sectionErrors.relations && related.length === 0 && <p className="muted">暂无相关记录。</p>}{related.map(item => <p key={item.id}><button type="button" onClick={() => onOpen(item.id)}>{item.title}</button></p>)}</section>
        <section><h4>操作记录</h4>{sectionState('audit')}{audit.map(item => <p className="audit-row" key={item.id}>{formatBeijingDateTime(item.timestamp)} · {auditLabels[item.action] || '数据操作'}</p>)}</section>
      </>}
    </aside>
  </>, document.body)
}
