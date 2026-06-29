import { useEffect, useMemo, useState } from 'react'

import {
  createEntity,
  confirmCandidateBundle,
  createRecord,
  createRelation,
  createExtraction,
  deleteEntity,
  deleteSpace,
  getLatestCandidateBundle,
  createSpace,
  listEntities,
  listRecords,
  listRelations,
  listSources,
  listSpaces,
  removeRelation,
  setRecordArchived,
  updateRecord,
  type DomainRecord,
  type EntityType,
  type NamedEntity,
  type CandidateBundle,
  type CandidateSuggestion,
  type RecordRelation,
  type SourceEntry,
  type SpaceEntry,
} from './domainApi'
import { recordStatusDescription, recordStatusLabel } from './recordLabels'
import { relationConfig, relationLabel, type RelationType } from './relationLabels'

interface Props {
  refreshKey: number
}

const recordConfig = {
  event: { label: '事件', statuses: ['planned', 'occurred', 'completed', 'cancelled'] },
  ledger: { label: '账目', statuses: ['planned', 'posted', 'voided'] },
  issue: { label: '施工问题', statuses: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] },
  measurement: { label: '尺寸', statuses: ['active', 'superseded', 'cancelled'] },
  decision: { label: '决策', statuses: ['pending', 'confirmed', 'superseded', 'cancelled'] },
  procurement: {
    label: '采购',
    statuses: ['planned', 'ordered', 'partially_paid', 'paid', 'delivery_pending', 'delivered', 'returned', 'completed', 'cancelled'],
  },
  research: { label: '调研', statuses: ['collecting', 'comparing', 'concluded', 'archived'] },
  todo: { label: '待办', statuses: ['pending', 'in_progress', 'waiting', 'done', 'cancelled'] },
} as const

type RecordType = keyof typeof recordConfig
const entityLabels: Record<EntityType, string> = {
  materials: '材料',
  vendors: '商家',
  participants: '参与者',
  stages: '装修阶段',
}
const entityPlaceholders: Record<EntityType, string> = {
  materials: '例如：卫生间花砖',
  vendors: '例如：光彩瓷砖店',
  participants: '例如：张师傅',
  stages: '例如：水电阶段',
}
const spaceKindLabels: Record<string, string> = {
  house: '房屋', room: '房间', component: '局部构件', surface: '表面',
}
const manualPlaceholders: Record<RecordType, {
  title: string
  detailA: string
  detailB: string
  detailC?: string
}> = {
  event: {
    title: '例如：主卧地砖铺贴完成',
    detailA: '例如：现场查看、施工完成或验收',
    detailB: '例如：已完成铺贴并现场验收',
  },
  ledger: {
    title: '例如：支付花砖预付款',
    detailA: '例如：预付款、尾款或退款',
    detailB: '例如：500',
  },
  issue: {
    title: '例如：主卧门口地砖破裂',
    detailA: '例如：门口地砖边角有一处破裂',
    detailB: '例如：安装门套后复核遮挡效果',
  },
  measurement: {
    title: '例如：厨房门洞尺寸',
    detailA: '例如：厨房门洞',
    detailB: '例如：90',
    detailC: '例如：210',
  },
  decision: {
    title: '例如：确定卫生间花砖方案',
    detailA: '例如：卫生间花砖铺贴方案',
    detailB: '例如：横贴，竖贴',
    detailC: '例如：竖贴',
  },
  procurement: {
    title: '例如：采购卫生间花砖',
    detailA: '例如：60×120cm 花砖',
    detailB: '例如：18',
    detailC: '例如：1100',
  },
  research: {
    title: '例如：比较卫生间墙砖方案',
    detailA: '例如：卫生间墙砖选哪种？',
    detailB: '例如：柔光砖，亮面砖',
  },
  todo: {
    title: '例如：门套安装后复核',
    detailA: '例如：检查门套能否遮住破损位置',
    detailB: '例如：门套安装完成后',
  },
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

export function DomainWorkspace({ refreshKey }: Props) {
  const [sources, setSources] = useState<SourceEntry[]>([])
  const [sourceId, setSourceId] = useState('')
  const [records, setRecords] = useState<DomainRecord[]>([])
  const [allRecords, setAllRecords] = useState<DomainRecord[]>([])
  const [recordType, setRecordType] = useState<RecordType>('event')
  const [title, setTitle] = useState('')
  const [statusValue, setStatusValue] = useState<string>('occurred')
  const [detailA, setDetailA] = useState('')
  const [detailB, setDetailB] = useState('')
  const [detailC, setDetailC] = useState('')
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [spaceId, setSpaceId] = useState('')
  const [entities, setEntities] = useState<Record<EntityType, NamedEntity[]>>({
    materials: [], vendors: [], participants: [], stages: [],
  })
  const [materialId, setMaterialId] = useState('')
  const [participantId, setParticipantId] = useState('')
  const [stageId, setStageId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [relations, setRelations] = useState<RecordRelation[]>([])
  const [relationFrom, setRelationFrom] = useState('')
  const [relationTo, setRelationTo] = useState('')
  const [relationType, setRelationType] = useState<RelationType>('relates_to')
  const [manageType, setManageType] = useState<EntityType>('materials')
  const [manageName, setManageName] = useState('')
  const [manageBrand, setManageBrand] = useState('')
  const [spaceName, setSpaceName] = useState('')
  const [spaceKind, setSpaceKind] = useState('room')
  const [spaceParent, setSpaceParent] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [message, setMessage] = useState('')
  const [bundle, setBundle] = useState<CandidateBundle | null>(null)
  const [suggestions, setSuggestions] = useState<CandidateSuggestion[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [engineMode, setEngineMode] = useState<'auto' | 'ai' | 'local'>('auto')

  const applyBundle = (nextBundle: CandidateBundle | null) => {
    setBundle(nextBundle)
    const nextSuggestions = nextBundle?.suggestions ?? []
    setSuggestions(nextSuggestions)
    setSelectedKeys(new Set(nextSuggestions
      .filter((item) => !item.confirmed_record_id)
      .map((item) => item.key)))
  }

  const loadSuggestions = async (selectedSource: string, force = false) => {
    if (!selectedSource) {
      applyBundle(null)
      return
    }
    setAnalyzing(true)
    try {
      const latest = force ? null : await getLatestCandidateBundle(selectedSource)
      applyBundle(latest ?? await createExtraction(selectedSource, engineMode))
    } finally {
      setAnalyzing(false)
    }
  }

  const refreshReferences = async () => {
    const [spaceRows, materialRows, vendorRows, participantRows, stageRows] = await Promise.all([
      listSpaces(), listEntities('materials'), listEntities('vendors'),
      listEntities('participants'), listEntities('stages'),
    ])
    setSpaces(spaceRows)
    setEntities({ materials: materialRows, vendors: vendorRows, participants: participantRows, stages: stageRows })
  }

  const refreshRecords = async (selectedSource = sourceId) => {
    const [sourceRecords, everyRecord, relationRows] = await Promise.all([
      selectedSource ? listRecords(selectedSource) : Promise.resolve([]),
      listRecords(undefined),
      listRelations(),
    ])
    setRecords(sourceRecords)
    setAllRecords(everyRecord)
    setRelations(relationRows)
  }

  useEffect(() => {
    Promise.all([listSources(), refreshReferences()])
      .then(([rows]) => {
        setSources(rows)
        const selected = sourceId || rows[0]?.id || ''
        setSourceId(selected)
        return Promise.all([refreshRecords(selected), loadSuggestions(selected)])
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : '加载失败'))
  }, [refreshKey])

  useEffect(() => {
    setStatusValue(recordConfig[recordType].statuses[0])
    setDetailA('')
    setDetailB('')
    setDetailC('')
  }, [recordType])

  useEffect(() => {
    if (spaceKind === 'house') {
      if (spaceParent) setSpaceParent('')
      return
    }
    if (!spaceParent) {
      const root = spaces.find((item) => item.kind === 'house' && item.parent_id === null)
      if (root) setSpaceParent(root.id)
    }
  }, [spaceKind, spaceParent, spaces])

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === sourceId),
    [sources, sourceId],
  )
  const manualPlaceholder = manualPlaceholders[recordType]
  const relationFromRecord = allRecords.find((item) => item.id === relationFrom)
  const relationToRecord = allRecords.find((item) => item.id === relationTo)
  const rootHouseCount = spaces.filter(
    (item) => item.kind === 'house' && item.parent_id === null,
  ).length

  const recordOptionLabel = (record: DomainRecord) => {
    const typeLabel = recordConfig[record.record_type as RecordType]?.label || '记录'
    return `${typeLabel} · ${record.title}`
  }

  const updateSuggestion = (key: string, field: string, value: string | number) => {
    setSuggestions((current) => current.map((item) => item.key === key
      ? { ...item, payload: { ...item.payload, [field]: value } }
      : item))
  }

  const updateMeasurementValue = (key: string, index: number, value: number) => {
    setSuggestions((current) => current.map((item) => {
      if (item.key !== key) return item
      const values = Array.isArray(item.payload.values)
        ? item.payload.values.map((entry) => ({ ...(entry as Record<string, unknown>) }))
        : []
      if (values[index]) values[index].value = value
      return { ...item, payload: { ...item.payload, values } }
    }))
  }

  const confirmSelected = async () => {
    const selections = suggestions
      .filter((item) => selectedKeys.has(item.key) && !item.confirmed_record_id)
      .map((item) => ({ key: item.key, payload: item.payload }))
    if (!selections.length) {
      setMessage('请先勾选至少一条尚未确认的建议。')
      return
    }
    setConfirming(true)
    try {
      if (!bundle) throw new Error('候选包尚未加载。')
      const result = await confirmCandidateBundle(bundle.id, bundle.version, selections)
      applyBundle(result.bundle)
      setMessage('所选建议已一次确认，正式记录和关系均已保存。')
      await refreshRecords()
    } catch (error: unknown) {
      // 失败时不重置本地编辑，方便用户修正后重试。
      setMessage(error instanceof Error ? error.message : '确认失败，已保留当前编辑内容。')
    } finally {
      setConfirming(false)
    }
  }

  const buildPayload = (): Record<string, unknown> => {
    const common: Record<string, unknown> = {
      record_type: recordType,
      title,
      status: statusValue,
      source_refs: [{ source_id: sourceId, evidence_excerpt: selectedSource?.original_text || null }],
      space_ids: spaceId ? [spaceId] : [],
      material_ids: materialId ? [materialId] : [],
      participant_ids: participantId ? [participantId] : [],
      stage_id: stageId || null,
    }
    if (recordType === 'event') return { ...common, event_kind: detailA || 'other', result: detailB || null }
    if (recordType === 'ledger') return {
      ...common, direction: 'expense', payment_kind: detailA || 'other',
      amount_minor: Math.round((numberOrUndefined(detailB) || 0) * 100), vendor_id: vendorId || null,
    }
    if (recordType === 'issue') return { ...common, phenomenon: detailA, handling_plan: detailB || null }
    if (recordType === 'measurement') return {
      ...common, object_name: detailA, measurement_role: 'material_spec',
      values: [
        { axis: 'width', value: numberOrUndefined(detailB), unit: 'cm' },
        ...(detailC ? [{ axis: 'height', value: numberOrUndefined(detailC), unit: 'cm' }] : []),
      ],
    }
    if (recordType === 'decision') return {
      ...common, topic: detailA, options: detailB.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      selected_option: detailC || null,
    }
    if (recordType === 'procurement') return {
      ...common, item_name: detailA, quantity: numberOrUndefined(detailB), quantity_unit: '件',
      order_total_minor: detailC ? Math.round(Number(detailC) * 100) : null, vendor_id: vendorId || null,
    }
    if (recordType === 'research') return {
      ...common, question: detailA, options: detailB.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    }
    return { ...common, action: detailA, trigger_condition: detailB || null }
  }

  const submitRecord = async () => {
    if (!sourceId || !title.trim() || !detailA.trim()) {
      setMessage('请选择来源，并填写标题和类型必填内容。')
      return
    }
    if (recordType === 'ledger' && (!numberOrUndefined(detailB) || Number(detailB) <= 0)) {
      setMessage('账目金额必须大于 0。')
      return
    }
    if (recordType === 'measurement' && (!numberOrUndefined(detailB) || Number(detailB) <= 0)) {
      setMessage('尺寸数值必须大于 0。')
      return
    }
    try {
      await createRecord(buildPayload())
      setTitle('')
      setDetailA('')
      setDetailB('')
      setDetailC('')
      setMessage('正式记录已创建，并保留来源追溯。')
      await refreshRecords()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '创建失败')
    }
  }

  const saveEdit = async (record: DomainRecord) => {
    await updateRecord(record.id, { record_type: record.record_type, title: editTitle, status: editStatus })
    setEditingId('')
    await refreshRecords()
  }

  const addManagedEntity = async () => {
    if (!manageName.trim()) {
      setMessage(`请填写${entityLabels[manageType]}名称。`)
      return
    }
    try {
      await createEntity(manageType, {
        name: manageName.trim(),
        ...(manageType === 'materials' ? { brand: manageBrand.trim() || null } : {}),
      })
      setManageName('')
      setManageBrand('')
      setMessage(`${entityLabels[manageType]}已新增。`)
      await refreshReferences()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '新增共享档案失败')
    }
  }

  const addSpace = async () => {
    if (!spaceName.trim()) {
      setMessage('请填写空间名称。')
      return
    }
    if (spaceKind !== 'house' && !spaceParent) {
      setMessage('请选择上级空间。房间和局部区域需要归入整套房屋。')
      return
    }
    try {
      await createSpace({ name: spaceName.trim(), kind: spaceKind, parent_id: spaceParent || null })
      setSpaceName('')
      setMessage('空间已新增。')
      await refreshReferences()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '新增空间失败')
    }
  }

  const deleteSpaceItem = async (space: SpaceEntry) => {
    if (!window.confirm(`确认永久删除空间“${space.name}”吗？此操作无法恢复。`)) return
    try {
      await deleteSpace(space.id)
      if (spaceId === space.id) setSpaceId('')
      if (spaceParent === space.id) setSpaceParent('')
      setMessage(`空间“${space.name}”已删除。`)
      await refreshReferences()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '删除空间失败')
    }
  }

  const deleteManagedEntity = async (entity: NamedEntity) => {
    const label = entityLabels[manageType]
    if (!window.confirm(`确认永久删除${label}“${entity.name}”吗？此操作无法恢复。`)) return
    try {
      await deleteEntity(manageType, entity.id)
      if (manageType === 'materials' && materialId === entity.id) setMaterialId('')
      if (manageType === 'vendors' && vendorId === entity.id) setVendorId('')
      if (manageType === 'participants' && participantId === entity.id) setParticipantId('')
      if (manageType === 'stages' && stageId === entity.id) setStageId('')
      setMessage(`${label}“${entity.name}”已删除。`)
      await refreshReferences()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : `删除${label}失败`)
    }
  }

  const addRelation = async () => {
    if (!relationFrom || !relationTo) {
      setMessage('请选择关系两端的记录。')
      return
    }
    try {
      await createRelation({ from_record_id: relationFrom, to_record_id: relationTo, relation_type: relationType })
      setMessage('记录关联已建立。')
      await refreshRecords()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '建立记录关联失败')
    }
  }

  const deleteRelationItem = async (relation: RecordRelation) => {
    const confirmed = window.confirm('确认移除这条关联吗？这可能影响账本待付、时间线关联或问题下一步展示。')
    if (!confirmed) return
    try {
      await removeRelation(relation.id)
      setMessage('记录关联已移除。')
      await refreshRecords()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '移除记录关联失败')
    }
  }

  return (
    <section className="domain-workspace" aria-labelledby="domain-title">
      <div className="section-heading">
        <p className="eyebrow">阶段 3A · 人在回路</p>
        <h2 id="domain-title">让 AI 帮你拆分装修事实</h2>
      </div>

      <label className="field-stack">
        <span>原始数据来源</span>
        <select value={sourceId} onChange={(event) => {
          setSourceId(event.target.value)
          void Promise.all([refreshRecords(event.target.value), loadSuggestions(event.target.value)])
        }}>
          <option value="">请选择</option>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.original_text || '仅附件来源'}</option>)}
        </select>
      </label>

      <div className="suggestion-panel">
        <div className="suggestion-toolbar">
          <div><h3>AI 录入</h3>{bundle && <p className="muted">实际引擎：{bundle.engine}</p>}</div>
          <label className="field-stack"><span>分析方式</span><select value={engineMode} onChange={(event) => setEngineMode(event.target.value as 'auto' | 'ai' | 'local')}><option value="auto">自动主备并本地兜底</option><option value="ai">仅 AI（失败可见）</option><option value="local">仅本地规则</option></select></label>
          <button className="secondary-button" type="button" disabled={!sourceId || analyzing} onClick={() => void loadSuggestions(sourceId, true).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '分析失败'))}>{analyzing ? 'AI 正在分析…' : '重新分析'}</button>
        </div>
        {analyzing && <p className="analysis-state" role="status">AI 正在分析…主备引擎共享 30 秒预算，失败后会提供本地规则建议。</p>}
        {bundle?.fallback_reason && <p className="fallback-notice">AI 暂不可用，本地规则已提供建议。原因：{bundle.fallback_reason}</p>}
        {!analyzing && sourceId && suggestions.length === 0 && <p className="muted">暂未识别，原始文字已经保留。</p>}
        {suggestions.map((suggestion) => {
          const confirmed = Boolean(suggestion.confirmed_record_id)
          const payload = suggestion.payload
          const highRisk = ['ledger', 'issue', 'decision'].includes(suggestion.record_type)
          return <article className={`record-card suggestion-card${highRisk ? ' suggestion-card--risk' : ''}`} key={suggestion.key}>
            <label>
              <input
                type="checkbox"
                checked={confirmed || selectedKeys.has(suggestion.key)}
                disabled={confirmed}
                onChange={(event) => setSelectedKeys((current) => {
                  const next = new Set(current)
                  if (event.target.checked) next.add(suggestion.key); else next.delete(suggestion.key)
                  return next
                })}
              />
              <strong>{suggestion.type_label}：{suggestion.summary}</strong>
            </label>
            <p>原文依据：{suggestion.evidence}</p>
            <p>{confirmed ? '已确认并生成正式记录' : `可信程度：${suggestion.certainty_label}`}</p>
            {highRisk && !confirmed && <p className="risk-notice">请重点核对：此项涉及金额、施工问题或关键决策，AI 不会代替你确认。</p>}
            {!confirmed && <div className="record-form-grid">
              <label className="field-stack"><span>标题</span><input value={String(payload.title || '')} onChange={(event) => updateSuggestion(suggestion.key, 'title', event.target.value)} /></label>
              {suggestion.record_type === 'ledger' && <label className="field-stack"><span>实际金额（元）</span><input type="number" value={Number(payload.amount_minor || 0) / 100} onChange={(event) => updateSuggestion(suggestion.key, 'amount_minor', Math.round(Number(event.target.value) * 100))} /></label>}
              {suggestion.record_type === 'procurement' && <><label className="field-stack"><span>数量</span><input type="number" value={String(payload.quantity || '')} onChange={(event) => updateSuggestion(suggestion.key, 'quantity', Number(event.target.value))} /></label><label className="field-stack"><span>订单总额（元）</span><input type="number" value={Number(payload.order_total_minor || 0) / 100} onChange={(event) => updateSuggestion(suggestion.key, 'order_total_minor', Math.round(Number(event.target.value) * 100))} /></label></>}
              {suggestion.record_type === 'measurement' && Array.isArray(payload.values) && payload.values.map((entry, index) => {
                const item = entry as Record<string, unknown>
                return <label className="field-stack" key={`${suggestion.key}-${index}`}><span>{String(item.axis || `尺寸 ${index + 1}`)}（{String(item.unit || 'cm')}）</span><input type="number" value={String(item.value || '')} onChange={(event) => updateMeasurementValue(suggestion.key, index, Number(event.target.value))} /></label>
              })}
              {suggestion.record_type === 'todo' && <label className="field-stack"><span>待办动作</span><input value={String(payload.action || '')} onChange={(event) => updateSuggestion(suggestion.key, 'action', event.target.value)} /></label>}
              {suggestion.record_type === 'decision' && <label className="field-stack"><span>决定内容</span><input value={String(payload.selected_option || '')} onChange={(event) => updateSuggestion(suggestion.key, 'selected_option', event.target.value)} /></label>}
              {suggestion.record_type === 'issue' && <label className="field-stack"><span>问题现象</span><input value={String(payload.phenomenon || '')} onChange={(event) => updateSuggestion(suggestion.key, 'phenomenon', event.target.value)} /></label>}
            </div>}
            {suggestion.missing_fields.length > 0 && <p className="muted">还可补充：{suggestion.missing_fields.join('、')}</p>}
            {!confirmed && <details><summary>补充更多信息</summary><p className="muted">空间、材料、参与者和装修阶段可在下方高级区域维护。</p></details>}
          </article>
        })}
        {suggestions.length > 0 && <div className="suggestion-actions"><button className="source-save" type="button" disabled={confirming} onClick={() => void confirmSelected()}>{confirming ? '正在确认…' : '确认所选'}</button></div>}
      </div>

      {message && <p className="workspace-message" role="status">{message}</p>}

      <details className="manage-panel"><summary>手工录入</summary>

      <div className="record-form-grid">
        <label className="field-stack"><span>记录类型</span><select value={recordType} onChange={(event) => setRecordType(event.target.value as RecordType)}>{Object.entries(recordConfig).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></label>
        <label className="field-stack"><span>状态</span><select value={statusValue} onChange={(event) => setStatusValue(event.target.value)}>{recordConfig[recordType].statuses.map((item) => <option key={item} value={item}>{recordStatusLabel(recordType, item)}</option>)}</select></label>
        <label className="field-stack record-form-grid__wide"><span>标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={manualPlaceholder.title} /></label>
        <label className="field-stack"><span>{recordType === 'ledger' ? '款项性质' : recordType === 'measurement' ? '测量对象' : recordType === 'procurement' ? '商品名称' : recordType === 'todo' ? '待办动作' : recordType === 'research' ? '调研问题' : recordType === 'decision' ? '决策主题' : recordType === 'issue' ? '问题现象' : '事件类型'}</span><input value={detailA} onChange={(event) => setDetailA(event.target.value)} placeholder={manualPlaceholder.detailA} /></label>
        <label className="field-stack"><span>{recordType === 'ledger' ? '金额（元）' : recordType === 'measurement' ? '宽度（cm）' : recordType === 'procurement' ? '数量' : recordType === 'decision' || recordType === 'research' ? '选项（逗号分隔）' : '补充内容'}</span><input type={recordType === 'ledger' || recordType === 'measurement' || recordType === 'procurement' ? 'number' : 'text'} min={recordType === 'ledger' || recordType === 'measurement' || recordType === 'procurement' ? '0' : undefined} step="any" value={detailB} onChange={(event) => setDetailB(event.target.value)} placeholder={manualPlaceholder.detailB} /></label>
        {(recordType === 'measurement' || recordType === 'decision' || recordType === 'procurement') && <label className="field-stack"><span>{recordType === 'measurement' ? '高度（cm，可选）' : recordType === 'decision' ? '最终选择' : '订单总额（元）'}</span><input type={recordType === 'decision' ? 'text' : 'number'} min={recordType === 'decision' ? undefined : '0'} step="any" value={detailC} onChange={(event) => setDetailC(event.target.value)} placeholder={manualPlaceholder.detailC} /></label>}
        <label className="field-stack"><span>空间</span><select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">未指定</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field-stack"><span>材料</span><select value={materialId} onChange={(event) => setMaterialId(event.target.value)}><option value="">未指定</option>{entities.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field-stack"><span>参与者</span><select value={participantId} onChange={(event) => setParticipantId(event.target.value)}><option value="">未指定</option>{entities.participants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field-stack"><span>装修阶段</span><select value={stageId} onChange={(event) => setStageId(event.target.value)}><option value="">未指定</option>{entities.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {(recordType === 'ledger' || recordType === 'procurement') && <label className="field-stack"><span>商家</span><select value={vendorId} onChange={(event) => setVendorId(event.target.value)}><option value="">未指定</option>{entities.vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      </div>
      <button className="source-save" type="button" onClick={submitRecord}>创建正式记录</button>
      </details>

      <div className="record-list">
        <h3>这条来源已保存的记录</h3>
        <p className="record-list__guide">这里的记录已经正式保存，会出现在时间线、账本、问题或空间等页面中。状态表示事情目前进展到哪一步。</p>
        {records.length === 0 && <p className="muted">这条来源还没有生成记录。</p>}
        {records.map((record) => <article className="record-card" key={record.id}>
          {editingId === record.id ? <div className="record-edit-form"><label className="field-stack"><span>记录标题</span><input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label className="field-stack"><span>当前状态</span><select value={editStatus} onChange={(event) => setEditStatus(event.target.value)}>{recordConfig[record.record_type as RecordType].statuses.map((item) => <option key={item} value={item}>{recordStatusLabel(record.record_type, item)}</option>)}</select></label><div className="record-actions"><button type="button" onClick={() => void saveEdit(record)}>保存修改</button><button type="button" onClick={() => setEditingId('')}>取消</button></div></div> : <><strong>{recordConfig[record.record_type as RecordType]?.label} · {record.title}</strong><p><strong>状态：</strong>{recordStatusLabel(record.record_type, record.status)}{record.archived_at ? ' · 已归档隐藏' : ''}</p>{recordStatusDescription(record.record_type, record.status) && <p className="record-status-help">{recordStatusDescription(record.record_type, record.status)}</p>}<div className="record-actions"><button type="button" onClick={() => { setEditingId(record.id); setEditTitle(record.title); setEditStatus(record.status) }}>修改标题/状态</button><button type="button" onClick={() => void setRecordArchived(record.id, !record.archived_at).then(() => refreshRecords())}>{record.archived_at ? '恢复显示' : '归档并隐藏'}</button></div><small className="record-action-help">修改只会调整标题和当前进展；归档不会删除记录，只会从常用视图隐藏，之后可以恢复。</small></>}
        </article>)}
      </div>

      <details className="manage-panel">
        <summary>空间与共享档案</summary>
        <p className="panel-guide">空间用于标记事情发生的位置；共享档案可在多条记录中重复使用。只能删除尚未被正式记录使用的项目。</p>
        <div className="manage-grid">
          <section>
            <h3>新增空间</h3>
            <label className="field-stack"><span>空间名称</span><input value={spaceName} onChange={(event) => setSpaceName(event.target.value)} placeholder="例如：主卧、淋浴区或门洞" /></label>
            <label className="field-stack"><span>空间类型</span><select value={spaceKind} onChange={(event) => setSpaceKind(event.target.value)}>{Object.entries(spaceKindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="field-stack"><span>上级空间</span><select value={spaceParent} disabled={spaceKind === 'house'} onChange={(event) => setSpaceParent(event.target.value)}><option value="" disabled={spaceKind !== 'house'}>{spaceKind === 'house' ? '房屋是根空间，无需上级' : '请选择上级空间'}</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>系统会自动提供“整套房屋”。用于建立“房屋 → 房间 → 局部构件/表面”层级，例如“主卧”的上级就是“整套房屋”。</small></label>
            <button type="button" onClick={() => void addSpace()}>新增空间</button>
            <div className="manage-list" aria-label="已有空间">
              <h4>已有空间</h4>
              {spaces.length === 0 && <p className="muted">还没有空间。</p>}
              {spaces.map((item) => { const isOnlyRoot = item.kind === 'house' && item.parent_id === null && rootHouseCount === 1; return <div className="manage-list__item" key={item.id}><span><strong>{item.name}</strong><small>{spaceKindLabels[item.kind] || item.kind}{isOnlyRoot ? ' · 系统根空间' : item.parent_id ? ` · 上级：${spaces.find((space) => space.id === item.parent_id)?.name || '未知'}` : ' · 无上级'}</small></span>{isOnlyRoot ? <small className="protected-item">系统根空间不可删除</small> : <button type="button" onClick={() => void deleteSpaceItem(item)}>删除</button>}</div> })}
            </div>
          </section>
          <section>
            <h3>新增共享档案</h3>
            <label className="field-stack"><span>档案类型</span><select value={manageType} onChange={(event) => { setManageType(event.target.value as EntityType); setManageBrand('') }}>{Object.entries(entityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="field-stack"><span>{entityLabels[manageType]}名称</span><input value={manageName} onChange={(event) => setManageName(event.target.value)} placeholder={entityPlaceholders[manageType]} /></label>
            {manageType === 'materials' && <label className="field-stack"><span>材料品牌（可选）</span><input value={manageBrand} onChange={(event) => setManageBrand(event.target.value)} placeholder="例如：马可波罗" /></label>}
            <button type="button" onClick={() => void addManagedEntity()}>新增{entityLabels[manageType]}</button>
            <div className="manage-list" aria-label={`已有${entityLabels[manageType]}`}>
              <h4>已有{entityLabels[manageType]}</h4>
              {entities[manageType].length === 0 && <p className="muted">还没有{entityLabels[manageType]}。</p>}
              {entities[manageType].map((item) => <div className="manage-list__item" key={item.id}><strong>{manageType === 'materials' && item.brand ? `${String(item.brand)} · ${item.name}` : item.name}</strong><button type="button" onClick={() => void deleteManagedEntity(item)}>删除</button></div>)}
            </div>
          </section>
        </div>
      </details>

      <details className="manage-panel">
        <summary>记录之间的关联（一般无需手动设置）</summary>
        <div className="relation-guide">
          <p>关联会帮助时间线串联事实、账本计算采购待付，以及问题看板展示下一步。系统通常会自动建立；只有自动关联不准确时才需要手工调整。</p>
          <p><strong>方向：</strong>第一条记录 → 关系 → 第二条记录。{relationConfig[relationType].example}</p>
        </div>
        <div className="relation-form">
          <label className="field-stack"><span>第一条记录</span><select value={relationFrom} onChange={(event) => setRelationFrom(event.target.value)}><option value="">请选择</option>{allRecords.map((item) => <option key={item.id} value={item.id}>{recordOptionLabel(item)}</option>)}</select></label>
          <label className="field-stack"><span>它与第二条记录的关系</span><select value={relationType} onChange={(event) => setRelationType(event.target.value as RelationType)}>{Object.entries(relationConfig).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></label>
          <label className="field-stack"><span>第二条记录</span><select value={relationTo} onChange={(event) => setRelationTo(event.target.value)}><option value="">请选择</option>{allRecords.map((item) => <option key={item.id} value={item.id}>{recordOptionLabel(item)}</option>)}</select></label>
          <button type="button" onClick={() => void addRelation()}>建立关联</button>
        </div>
        {relationFromRecord && relationToRecord && <p className="relation-preview"><strong>关系预览：</strong>{recordOptionLabel(relationFromRecord)} → {relationLabel(relationType)} → {recordOptionLabel(relationToRecord)}</p>}
        <div className="relation-list">
          <h4>已有记录关联</h4>
          {relations.length === 0 && <p className="muted">还没有记录关联。</p>}
          {relations.map((relation) => <p className="relation-row" key={relation.id}><span>{allRecords.find((item) => item.id === relation.from_record_id)?.title || relation.from_record_id} → {relationLabel(relation.relation_type)} → {allRecords.find((item) => item.id === relation.to_record_id)?.title || relation.to_record_id}</span><button type="button" onClick={() => void deleteRelationItem(relation)}>移除</button></p>)}
        </div>
      </details>
    </section>
  )
}
