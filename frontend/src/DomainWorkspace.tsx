import { useEffect, useMemo, useState } from 'react'

import {
  createEntity,
  confirmSuggestions,
  createRecord,
  createRelation,
  createSpace,
  listEntities,
  listRecords,
  listRelations,
  listSources,
  listSpaces,
  getSuggestions,
  removeRelation,
  setRecordArchived,
  updateRecord,
  type DomainRecord,
  type EntityType,
  type NamedEntity,
  type LocalSuggestion,
  type RecordRelation,
  type SourceEntry,
  type SpaceEntry,
} from './domainApi'

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
const relationTypes = ['relates_to', 'implements', 'resolves', 'pays_for', 'tracks_delivery', 'supersedes', 'blocks', 'produces']
const statusLabels: Record<string, string> = {
  planned: '计划中', occurred: '已发生', completed: '已完成', cancelled: '已取消',
  posted: '已入账', voided: '已作废', open: '待处理', in_progress: '处理中', waiting: '等待中',
  resolved: '已解决', closed: '已关闭', active: '当前有效', superseded: '已替代', pending: '待确认',
  confirmed: '已确认', ordered: '已下单', partially_paid: '部分付款', paid: '已付款',
  delivery_pending: '待送货', delivered: '已送达', returned: '已退货', collecting: '收集中',
  comparing: '比较中', concluded: '已有结论', archived: '已归档', done: '已完成',
}
const entityLabels: Record<EntityType, string> = {
  materials: '材料',
  vendors: '商家',
  participants: '参与者',
  stages: '装修阶段',
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
  const [relationType, setRelationType] = useState('relates_to')
  const [manageType, setManageType] = useState<EntityType>('materials')
  const [manageName, setManageName] = useState('')
  const [spaceName, setSpaceName] = useState('')
  const [spaceKind, setSpaceKind] = useState('room')
  const [spaceParent, setSpaceParent] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [message, setMessage] = useState('')
  const [suggestions, setSuggestions] = useState<LocalSuggestion[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)

  const loadSuggestions = async (selectedSource: string) => {
    if (!selectedSource) {
      setSuggestions([])
      setSelectedKeys(new Set())
      return
    }
    const bundle = await getSuggestions(selectedSource)
    setSuggestions(bundle.suggestions)
    setSelectedKeys(new Set(bundle.suggestions
      .filter((item) => item.selected_by_default && !item.confirmed_record_id)
      .map((item) => item.key)))
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

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === sourceId),
    [sources, sourceId],
  )

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
      await confirmSuggestions(sourceId, selections)
      setMessage('所选建议已一次确认，正式记录和关系均已保存。')
      await Promise.all([refreshRecords(), loadSuggestions(sourceId)])
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
      ...common, topic: detailA, options: detailB.split(',').map((item) => item.trim()).filter(Boolean),
      selected_option: detailC || null,
    }
    if (recordType === 'procurement') return {
      ...common, item_name: detailA, quantity: numberOrUndefined(detailB), quantity_unit: '件',
      order_total_minor: detailC ? Math.round(Number(detailC) * 100) : null, vendor_id: vendorId || null,
    }
    if (recordType === 'research') return {
      ...common, question: detailA, options: detailB.split(',').map((item) => item.trim()).filter(Boolean),
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
    if (!manageName.trim()) return
    await createEntity(manageType, { name: manageName.trim() })
    setManageName('')
    await refreshReferences()
  }

  const addSpace = async () => {
    if (!spaceName.trim()) return
    await createSpace({ name: spaceName.trim(), kind: spaceKind, parent_id: spaceParent || null })
    setSpaceName('')
    await refreshReferences()
  }

  const addRelation = async () => {
    if (!relationFrom || !relationTo) return
    await createRelation({ from_record_id: relationFrom, to_record_id: relationTo, relation_type: relationType })
    await refreshRecords()
  }

  return (
    <section className="domain-workspace" aria-labelledby="domain-title">
      <div className="section-heading">
        <p className="eyebrow">阶段 2A</p>
        <h2 id="domain-title">把原始记录拆成装修事实</h2>
      </div>

      <label className="field-stack">
        <span>选择原始来源</span>
        <select value={sourceId} onChange={(event) => {
          setSourceId(event.target.value)
          void Promise.all([refreshRecords(event.target.value), loadSuggestions(event.target.value)])
        }}>
          <option value="">请选择</option>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.original_text || '仅附件来源'}</option>)}
        </select>
      </label>

      <div className="suggestion-panel">
        <h3>系统建议</h3>
        {sourceId && suggestions.length === 0 && <p className="muted">暂未识别，可稍后处理；原始文字已经保留。</p>}
        {suggestions.map((suggestion) => {
          const confirmed = Boolean(suggestion.confirmed_record_id)
          const payload = suggestion.payload
          return <article className="record-card suggestion-card" key={suggestion.key}>
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
            {!confirmed && suggestion.certainty !== 'explicit' && <p className="muted">信息不够明确，默认未勾选，请确认后再选择。</p>}
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
        {suggestions.length > 0 && <button className="source-save" type="button" disabled={confirming} onClick={() => void confirmSelected()}>{confirming ? '正在确认…' : '确认所选记录'}</button>}
      </div>

      {message && <p className="workspace-message" role="status">{message}</p>}

      <details className="manage-panel"><summary>高级手工录入</summary>

      <div className="record-form-grid">
        <label className="field-stack"><span>记录类型</span><select value={recordType} onChange={(event) => setRecordType(event.target.value as RecordType)}>{Object.entries(recordConfig).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></label>
        <label className="field-stack"><span>状态</span><select value={statusValue} onChange={(event) => setStatusValue(event.target.value)}>{recordConfig[recordType].statuses.map((item) => <option key={item} value={item}>{statusLabels[item] || item}</option>)}</select></label>
        <label className="field-stack record-form-grid__wide"><span>标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：主卧门口地砖破裂" /></label>
        <label className="field-stack"><span>{recordType === 'ledger' ? '款项性质' : recordType === 'measurement' ? '测量对象' : recordType === 'procurement' ? '商品名称' : recordType === 'todo' ? '待办动作' : recordType === 'research' ? '调研问题' : recordType === 'decision' ? '决策主题' : recordType === 'issue' ? '问题现象' : '事件类型'}</span><input value={detailA} onChange={(event) => setDetailA(event.target.value)} /></label>
        <label className="field-stack"><span>{recordType === 'ledger' ? '金额（元）' : recordType === 'measurement' ? '宽度（cm）' : recordType === 'procurement' ? '数量' : recordType === 'decision' || recordType === 'research' ? '选项（逗号分隔）' : '补充内容'}</span><input value={detailB} onChange={(event) => setDetailB(event.target.value)} /></label>
        {(recordType === 'measurement' || recordType === 'decision' || recordType === 'procurement') && <label className="field-stack"><span>{recordType === 'measurement' ? '高度（cm，可选）' : recordType === 'decision' ? '最终选择' : '订单总额（元）'}</span><input value={detailC} onChange={(event) => setDetailC(event.target.value)} /></label>}
        <label className="field-stack"><span>空间</span><select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">未指定</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field-stack"><span>材料</span><select value={materialId} onChange={(event) => setMaterialId(event.target.value)}><option value="">未指定</option>{entities.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field-stack"><span>参与者</span><select value={participantId} onChange={(event) => setParticipantId(event.target.value)}><option value="">未指定</option>{entities.participants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field-stack"><span>装修阶段</span><select value={stageId} onChange={(event) => setStageId(event.target.value)}><option value="">未指定</option>{entities.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {(recordType === 'ledger' || recordType === 'procurement') && <label className="field-stack"><span>商家</span><select value={vendorId} onChange={(event) => setVendorId(event.target.value)}><option value="">未指定</option>{entities.vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      </div>
      <button className="source-save" type="button" onClick={submitRecord}>创建正式记录</button>
      </details>

      <div className="record-list">
        <h3>该来源的正式记录</h3>
        {records.length === 0 && <p className="muted">还没有拆分记录。</p>}
        {records.map((record) => <article className="record-card" key={record.id}>
          {editingId === record.id ? <div className="record-edit"><input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /><select value={editStatus} onChange={(event) => setEditStatus(event.target.value)}>{recordConfig[record.record_type as RecordType].statuses.map((item) => <option key={item} value={item}>{statusLabels[item] || item}</option>)}</select><button onClick={() => void saveEdit(record)}>保存</button></div> : <><strong>{recordConfig[record.record_type as RecordType]?.label} · {record.title}</strong><p>{statusLabels[record.status] || '未知状态'}{record.archived_at ? ' · 已归档' : ''}</p><div className="record-actions"><button onClick={() => { setEditingId(record.id); setEditTitle(record.title); setEditStatus(record.status) }}>编辑</button><button onClick={() => void setRecordArchived(record.id, !record.archived_at).then(() => refreshRecords())}>{record.archived_at ? '恢复' : '归档'}</button></div></>}
        </article>)}
      </div>

      <details className="manage-panel"><summary>空间与共享档案</summary><div className="manage-grid"><div><h3>新增空间</h3><input value={spaceName} onChange={(event) => setSpaceName(event.target.value)} placeholder="空间名称" /><select value={spaceKind} onChange={(event) => setSpaceKind(event.target.value)}><option value="house">房屋</option><option value="room">房间</option><option value="component">局部构件</option><option value="surface">表面</option></select><select value={spaceParent} onChange={(event) => setSpaceParent(event.target.value)}><option value="">无父级</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={() => void addSpace()}>新增空间</button></div><div><h3>新增共享档案</h3><select value={manageType} onChange={(event) => setManageType(event.target.value as EntityType)}>{Object.entries(entityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><input value={manageName} onChange={(event) => setManageName(event.target.value)} placeholder="名称" /><button onClick={() => void addManagedEntity()}>新增{entityLabels[manageType]}</button></div></div></details>

      <details className="manage-panel"><summary>记录关系</summary><div className="relation-form"><select value={relationFrom} onChange={(event) => setRelationFrom(event.target.value)}><option value="">起点记录</option>{allRecords.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select value={relationType} onChange={(event) => setRelationType(event.target.value)}>{relationTypes.map((item) => <option key={item}>{item}</option>)}</select><select value={relationTo} onChange={(event) => setRelationTo(event.target.value)}><option value="">目标记录</option>{allRecords.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button onClick={() => void addRelation()}>建立关系</button></div>{relations.map((relation) => <p className="relation-row" key={relation.id}>{allRecords.find((item) => item.id === relation.from_record_id)?.title || relation.from_record_id} → {relation.relation_type} → {allRecords.find((item) => item.id === relation.to_record_id)?.title || relation.to_record_id}<button onClick={() => void removeRelation(relation.id).then(() => refreshRecords())}>移除</button></p>)}</details>
    </section>
  )
}
