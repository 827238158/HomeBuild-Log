import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { defaultPayload, payloadForSave, RecordEditFields, type RecordType } from './DomainWorkspace'
import { getRecord, getSource, listRelations, listRecordAudit, listSpaces, listRecords, listEntities, createRecord, updateRecord, deleteRecord, reviewRecordSource, type ProjectionRecord, type SourceDetail, type AuditEntry, type DomainRecord, type SpaceEntry, type NamedEntity } from './domainApi'
import { recordStatusLabel, recordTypeLabels } from './recordLabels'
import { beijingToday, formatCalendarDate, formatBeijingDateTime } from './time'
import { RecordFacts } from './RecordFacts'
import { AttachmentViewer } from './AttachmentViewer'
import { useModalFocus } from './useModalFocus'
import { confirmNavigation, useNavigationGuard } from './navigationGuard'

const auditLabels: Record<string, string> = { create: '创建记录', update: '修改内容', delete: '删除记录', archive: '隐藏记录', restore: '重新显示', review: '复核来源', confirm: '确认候选' }
const message = (failure: unknown) => failure instanceof Error ? failure.message : '读取失败，请重试。'

export function RecordDetail({ recordId, closing, onClose, onChanged, onExitComplete, onOpen, onOpenSource, onOpenResearch }: {
  recordId: string; closing: boolean; onClose: () => void; onChanged: () => void; onExitComplete: () => void
  onOpen: (id: string) => void; onOpenSource: (id: string) => void; onOpenResearch: (id: string) => void
}) {
  const panel = useRef<HTMLElement>(null)
  const [record, setRecord] = useState<ProjectionRecord | null>(null)
  const [sources, setSources] = useState<SourceDetail[]>([])
  const [related, setRelated] = useState<ProjectionRecord[]>([])
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
  const focusReadMode = useRef(false)
  useEffect(() => {
    if (editing && resourcesReady) panel.current?.querySelector<HTMLInputElement>('.detail-edit-section input')?.focus()
    else if (!editing && focusReadMode.current) { focusReadMode.current = false; panel.current?.querySelector<HTMLButtonElement>('[data-edit-record]')?.focus() }
  }, [editing, resourcesReady])
  useNavigationGuard(editing && (dirty || busy), busy ? '记录正在保存，暂时离开可能无法确认保存结果，确定离开吗？' : undefined)
  useModalFocus(panel, true, () => { if (confirmNavigation()) onClose() })

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
    setRemeasuring(false); setEditPayload(defaultPayload(record.record_type as RecordType, record)); setDirty(false); setEditing(true)
    if (!resourcesReady) void loadEditResources()
  }
  const beginRemeasure = () => {
    if (!record || record.record_type !== 'measurement') return
    // 复测只复用对象与关联信息；旧数值、来源和说明不能成为新的现场事实。
    const values = Array.isArray(record.values) ? record.values.filter(item => item && typeof item === 'object').map(item => ({ ...(item as Record<string, unknown>), value: null })) : []
    setEditPayload(defaultPayload('measurement', {
      title: record.title, object_name: record.object_name, measurement_role: 'site_measurement',
      space_ids: record.space_ids, material_ids: record.material_ids, participant_ids: record.participant_ids,
      stage_id: record.stage_id, related_record_ids: [record.id], values, status: 'active',
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
    if (!record || busy) return
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
      await updateRecord(record.id, payload)
      focusReadMode.current = true
      setEditing(false); setDirty(false); setError(''); setReload(value => value + 1); onChanged()
    } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }
  const cancel = () => {
    if (dirty && !window.confirm('取消会放弃本次未保存的修改，确定取消吗？')) return
    setEditing(false); setDirty(false); setError('')
    requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('[data-edit-record]')?.focus())
  }
  const remove = async () => {
    if (!record || !window.confirm(`确认永久删除“${record.title}”吗？\n\n记录及关联关系会被删除，原始来源和审计历史会保留。`)) return
    setBusy(true)
    try { await deleteRecord(record.id); onChanged(); onClose() } catch (failure) { setError(message(failure)); setBusy(false) }
  }
  const acknowledge = async (sourceId: string) => {
    setBusy(true)
    try { await reviewRecordSource(recordId, sourceId); setReload(value => value + 1) } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }
  const sectionState = (key: string) => sectionErrors[key] ? <p role="alert" className="detail-section-state">{sectionErrors[key]} <button type="button" onClick={() => setReload(value => value + 1)}>重试读取</button></p> : sectionsLoading ? <p role="status">正在读取…</p> : null
  return createPortal(<>
    <button type="button" data-modal-backdrop tabIndex={-1} className="record-detail-backdrop" aria-label="关闭记录详情" onClick={() => { if (confirmNavigation()) onClose() }} />
    <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby="record-detail-title" tabIndex={-1} className={`detail-panel record-detail-panel immersive-glass immersive-glass--strong${closing ? ' is-closing' : ''}`} data-state={closing ? 'closing' : 'open'} onAnimationEnd={event => { if (closing && event.target === event.currentTarget) onExitComplete() }}>
      <div className="detail-panel__header"><h2 id="record-detail-title">{editing ? (remeasuring ? '再次测量' : '修改记录') : '记录详情'}</h2><button type="button" onClick={() => { if (confirmNavigation()) onClose() }} aria-label="关闭详情">关闭</button></div>
      {error && <p role="alert" className="view-state--error">{error} {!record && <button type="button" onClick={() => setReload(value => value + 1)}>重试读取详情</button>}</p>}
      {!record && !error && <p role="status">正在加载详情…</p>}
      {record && editing ? <section className="detail-edit-section">
        {remeasuring && <p className="muted">请填写本次测量值并确认测量日期。保存后新增关联记录，原测量及其来源保留；不会自动替代原记录。</p>}
        {resourcesLoading && <p role="status">正在加载编辑选项…</p>}
        {!resourcesReady && !resourcesLoading && <button type="button" onClick={() => void loadEditResources()}>重试加载编辑选项</button>}
        {resourcesReady && <RecordEditFields recordType={record.record_type as RecordType} payload={editPayload} spaces={spaces} entities={entities} records={allRecords} currentRecordId={record.id} onChange={change} />}
        <div className="record-actions"><button type="button" disabled={busy || !resourcesReady} onClick={() => void save()}>{busy ? '保存中…' : remeasuring ? '保存本次测量' : '保存修改'}</button><button type="button" disabled={busy} onClick={cancel}>取消</button></div>
      </section> : record && <>
        <span className="record-type-tag">{recordTypeLabels[record.record_type]}</span><h3>{record.title}</h3><p>{record.description || '暂无补充说明'}</p>
        <RecordFacts record={record} />
        {record.record_type === 'research' && <section className="evidence-card"><button type="button" onClick={() => onOpenResearch(record.id)}>继续调研</button></section>}
        <dl className="detail-list"><div><dt>状态</dt><dd>{recordStatusLabel(record.record_type, record.status, record.ledger_kind)}</dd></div><div><dt>事情发生日期</dt><dd>{formatCalendarDate(record.occurred_date)}</dd></div><div><dt>正式记录创建时间</dt><dd>{formatBeijingDateTime(record.created_at)}</dd></div><div><dt>空间</dt><dd>{record.spaces?.map(item => item.name).join('、') || '未指定'}</dd></div><div><dt>{record.record_type === 'issue' ? '处理人' : '参与者'}</dt><dd>{record.participants?.map(item => item.name).join('、') || '未指定'}</dd></div>
        {record.record_type === 'issue' && <><div><dt>严重程度</dt><dd>{({ low: '低', medium: '中', high: '高' } as Record<string, string>)[String(record.severity)] || '未评估'}</dd></div><div><dt>实际完成日期</dt><dd>{formatCalendarDate(record.completed_at)}</dd></div><div><dt>实际处理结果</dt><dd>{record.actual_result || '待补充'}</dd></div></>}
        </dl>
        <div className="detail-record-actions">{record.record_type === 'measurement' && <button type="button" disabled={busy} onClick={beginRemeasure}>再次测量</button>}<button type="button" data-edit-record disabled={busy} onClick={beginEdit}>修改记录</button><button className="danger-button" type="button" disabled={busy} onClick={() => void remove()}>删除记录</button></div>
        <section><h4>原始来源与附件</h4>{sectionState('sources')}{sources.map(source => <article className="evidence-card" key={source.id}>
          {record.source_refs.find(item => item.source_id === source.id)?.needs_review && <div className="source-review-warning"><span>原始数据已修改，这条正式记录待复核。</span><button type="button" disabled={busy} onClick={() => void acknowledge(source.id)}>已核对，无需修改</button></div>}
          <p>{source.original_text || '仅附件来源'}</p><small>录入时间：{formatBeijingDateTime(source.captured_at)} · 来源版本 {source.revision}</small><button type="button" onClick={() => onOpenSource(source.id)}>打开原始来源</button>
          {source.attachments.map(attachment => <AttachmentViewer key={attachment.id} attachment={attachment} />)}
        </article>)}</section>
        <section><h4>相关记录</h4>{sectionState('relations')}{!sectionsLoading && !sectionErrors.relations && related.length === 0 && <p className="muted">暂无相关记录。</p>}{related.map(item => <p key={item.id}><button type="button" onClick={() => onOpen(item.id)}>{item.title}</button></p>)}</section>
        <section><h4>操作记录</h4>{sectionState('audit')}{audit.map(item => <p className="audit-row" key={item.id}>{formatBeijingDateTime(item.timestamp)} · {auditLabels[item.action] || '数据操作'}</p>)}</section>
      </>}
    </aside>
  </>, document.body)
}
