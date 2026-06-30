import { useEffect, useMemo, useState } from 'react'

import {
  createEntity,
  confirmCandidateBundle,
  createRecord,
  createRelation,
  createExtraction,
  deleteRecord,
  deleteSource,
  deleteEntity,
  deleteSpace,
  getLatestCandidateBundle,
  getSourceDeletionImpact,
  createSpace,
  listEntities,
  listRecords,
  listRelations,
  listSources,
  listSpaces,
  removeRelation,
  reviewRecordSource,
  setRecordArchived,
  updateRecord,
  updateSource,
  type DomainRecord,
  type EntityType,
  type NamedEntity,
  type CandidateBundle,
  type CandidateSuggestion,
  type RecordRelation,
  type SourceEntry,
  type SpaceEntry,
} from './domainApi'
import { recordStatusDescription, recordStatusLabel, eventKindLabel, paymentKindLabel } from './recordLabels'
import { relationConfig, relationLabel, type RelationType } from './relationLabels'
import { formatBeijingDateTime } from './time'

interface Props {
  refreshKey: number
  onSourcesChanged?: () => void
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

interface TypeFieldConfig {
  detailALabel: string
  detailAPlaceholder: string
  detailBLabel: string
  detailBPlaceholder: string
  detailCLabel?: string
  detailCPlaceholder?: string
  detailBType?: 'number' | 'text'
  detailCType?: 'number' | 'text'
  showVendor?: boolean
}

const typeFieldConfig: Record<RecordType, TypeFieldConfig> = {
  event: {
    detailALabel: '事件类型',
    detailAPlaceholder: '例如：现场查看、施工完成或验收',
    detailBLabel: '补充内容',
    detailBPlaceholder: '例如：已完成铺贴并现场验收',
  },
  ledger: {
    detailALabel: '款项性质',
    detailAPlaceholder: '例如：预付款、尾款或退款',
    detailBLabel: '金额（元）',
    detailBPlaceholder: '例如：500',
    detailBType: 'number',
    showVendor: true,
  },
  issue: {
    detailALabel: '问题现象',
    detailAPlaceholder: '例如：门口地砖边角有一处破裂',
    detailBLabel: '处理计划',
    detailBPlaceholder: '例如：安装门套后复核遮挡效果',
  },
  measurement: {
    detailALabel: '测量对象',
    detailAPlaceholder: '例如：厨房门洞',
    detailBLabel: '宽度（cm）',
    detailBPlaceholder: '例如：90',
    detailCLabel: '高度（cm，可选）',
    detailCPlaceholder: '例如：210',
    detailBType: 'number',
    detailCType: 'number',
  },
  decision: {
    detailALabel: '决策主题',
    detailAPlaceholder: '例如：卫生间花砖铺贴方案',
    detailBLabel: '选项（逗号分隔）',
    detailBPlaceholder: '例如：横贴，竖贴',
    detailCLabel: '最终选择',
    detailCPlaceholder: '例如：竖贴',
  },
  procurement: {
    detailALabel: '商品名称',
    detailAPlaceholder: '例如：60×120cm 花砖',
    detailBLabel: '数量',
    detailBPlaceholder: '例如：18',
    detailCLabel: '订单总额（元）',
    detailCPlaceholder: '例如：1100',
    detailBType: 'number',
    detailCType: 'number',
    showVendor: true,
  },
  research: {
    detailALabel: '调研问题',
    detailAPlaceholder: '例如：卫生间墙砖选哪种？',
    detailBLabel: '选项（逗号分隔）',
    detailBPlaceholder: '例如：柔光砖，亮面砖',
  },
  todo: {
    detailALabel: '待办动作',
    detailAPlaceholder: '例如：检查门套能否遮住破损位置',
    detailBLabel: '触发条件',
    detailBPlaceholder: '例如：门套安装完成后',
  },
}

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
const titlePlaceholder: Record<RecordType, string> = {
  event: '例如：主卧地砖铺贴完成',
  ledger: '例如：支付花砖预付款',
  issue: '例如：主卧门口地砖破裂',
  measurement: '例如：厨房门洞尺寸',
  decision: '例如：确定卫生间花砖方案',
  procurement: '例如：采购卫生间花砖',
  research: '例如：比较卫生间墙砖方案',
  todo: '例如：门套安装后复核',
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

function firstArrayValue(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? String(value[0]) : ''
}

function normalizeOptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
  return []
}

function normalizeMeasurementValues(values: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(values)) return []
  return values.map((entry) => (typeof entry === 'object' && entry !== null ? { ...(entry as Record<string, unknown>) } : {}))
}

function defaultPayload(recordType: RecordType, base: Record<string, unknown> = {}): Record<string, unknown> {
  const common: Record<string, unknown> = {
    record_type: recordType,
    title: base.title ?? '',
    status: base.status ?? recordConfig[recordType].statuses[0],
    occurred_date: base.occurred_date ?? null,
    original_time_text: base.original_time_text ?? null,
    timezone: base.timezone ?? 'Asia/Shanghai',
    source_refs: base.source_refs ?? [],
    space_ids: base.space_ids ?? [],
    material_ids: base.material_ids ?? [],
    participant_ids: base.participant_ids ?? [],
    stage_id: base.stage_id ?? null,
  }
  const cfg = typeFieldConfig[recordType]
  if (recordType === 'event') {
    return { ...common, event_kind: base.event_kind ?? '', result: base.result ?? null }
  }
  if (recordType === 'ledger') {
    return {
      ...common,
      direction: base.direction ?? 'expense',
      payment_kind: base.payment_kind ?? '',
      amount_minor: base.amount_minor ?? null,
      vendor_id: base.vendor_id ?? null,
    }
  }
  if (recordType === 'issue') {
    return { ...common, phenomenon: base.phenomenon ?? '', handling_plan: base.handling_plan ?? null }
  }
  if (recordType === 'measurement') {
    const values = normalizeMeasurementValues(base.values)
    return {
      ...common,
      object_name: base.object_name ?? '',
      measurement_role: base.measurement_role ?? 'material_spec',
      values: values.length
        ? values
        : [
            { axis: 'width', value: null, unit: 'cm' },
            { axis: 'height', value: null, unit: 'cm' },
          ],
    }
  }
  if (recordType === 'decision') {
    return {
      ...common,
      topic: base.topic ?? '',
      options: normalizeOptions(base.options),
      selected_option: base.selected_option ?? null,
    }
  }
  if (recordType === 'procurement') {
    return {
      ...common,
      item_name: base.item_name ?? '',
      quantity: base.quantity ?? null,
      quantity_unit: base.quantity_unit ?? '件',
      order_total_minor: base.order_total_minor ?? null,
      vendor_id: base.vendor_id ?? null,
    }
  }
  if (recordType === 'research') {
    return { ...common, question: base.question ?? '', options: normalizeOptions(base.options) }
  }
  return { ...common, action: base.action ?? '', trigger_condition: base.trigger_condition ?? null }
}

function SavedRecordEditFields({
  recordType, payload, spaces, entities, onChange,
}: {
  recordType: RecordType
  payload: Record<string, unknown>
  spaces: SpaceEntry[]
  entities: Record<EntityType, NamedEntity[]>
  onChange: (field: string, value: unknown) => void
}) {
  const cfg = typeFieldConfig[recordType]
  const status = String(payload.status ?? recordConfig[recordType].statuses[0])
  const detailA = recordType === 'event' ? String(payload.event_kind ?? '')
    : recordType === 'ledger' ? String(payload.payment_kind ?? '')
    : recordType === 'issue' ? String(payload.phenomenon ?? '')
    : recordType === 'measurement' ? String(payload.object_name ?? '')
    : recordType === 'decision' ? String(payload.topic ?? '')
    : recordType === 'procurement' ? String(payload.item_name ?? '')
    : recordType === 'research' ? String(payload.question ?? '')
    : String(payload.action ?? '')
  const detailB = recordType === 'ledger' ? (payload.amount_minor ? String(Number(payload.amount_minor) / 100) : '')
    : recordType === 'measurement' ? String(normalizeMeasurementValues(payload.values)[0]?.value ?? '')
    : recordType === 'decision' || recordType === 'research' ? normalizeOptions(payload.options).join('，')
    : recordType === 'procurement' ? String(payload.quantity ?? '')
    : recordType === 'event' ? String(payload.result ?? '')
    : recordType === 'issue' ? String(payload.handling_plan ?? '')
    : String(payload.trigger_condition ?? '')
  const detailC = recordType === 'measurement' ? String(normalizeMeasurementValues(payload.values)[1]?.value ?? '')
    : recordType === 'decision' ? String(payload.selected_option ?? '')
    : recordType === 'procurement' ? (payload.order_total_minor ? String(Number(payload.order_total_minor) / 100) : '')
    : ''

  const setDetailA = (value: string) => onChange({
    event: 'event_kind', ledger: 'payment_kind', issue: 'phenomenon', measurement: 'object_name',
    decision: 'topic', procurement: 'item_name', research: 'question', todo: 'action',
  }[recordType], value)
  const setDetailB = (value: string) => {
    if (recordType === 'ledger') onChange('amount_minor', value.trim() ? Math.round(Number(value) * 100) : null)
    else if (recordType === 'measurement') {
      const values = normalizeMeasurementValues(payload.values)
      if (values[0]) values[0].value = value.trim() ? Number(value) : null
      onChange('values', values)
    } else if (recordType === 'decision' || recordType === 'research') onChange('options', normalizeOptions(value))
    else if (recordType === 'procurement') onChange('quantity', value.trim() ? Number(value) : null)
    else if (recordType === 'event') onChange('result', value)
    else if (recordType === 'issue') onChange('handling_plan', value)
    else onChange('trigger_condition', value)
  }
  const setDetailC = (value: string) => {
    if (recordType === 'measurement') {
      const values = normalizeMeasurementValues(payload.values)
      if (values[1]) values[1].value = value.trim() ? Number(value) : null
      onChange('values', values)
    } else if (recordType === 'decision') onChange('selected_option', value)
    else if (recordType === 'procurement') onChange('order_total_minor', value.trim() ? Math.round(Number(value) * 100) : null)
  }

  return <div className="record-form-grid">
    <label className="field-stack record-form-grid__wide"><span>标题</span><input value={String(payload.title ?? '')} placeholder={titlePlaceholder[recordType]} onChange={(event) => onChange('title', event.target.value)} /></label>
    <label className="field-stack"><span>状态</span><select value={status} onChange={(event) => onChange('status', event.target.value)}>{recordConfig[recordType].statuses.map((item) => <option key={item} value={item}>{recordStatusLabel(recordType, item)}</option>)}</select></label>
    <label className="field-stack"><span>{cfg.detailALabel}</span><input value={detailA} placeholder={cfg.detailAPlaceholder} onChange={(event) => setDetailA(event.target.value)} /></label>
    {recordType === 'ledger' && <label className="field-stack"><span>收支方向</span><select value={String(payload.direction ?? 'expense')} onChange={(event) => onChange('direction', event.target.value)}><option value="expense">支出</option><option value="refund">退款</option><option value="income">收入</option></select></label>}
    <label className="field-stack"><span>{cfg.detailBLabel}</span><input type={cfg.detailBType || 'text'} min={cfg.detailBType === 'number' ? '0' : undefined} step="any" value={detailB} placeholder={cfg.detailBPlaceholder} onChange={(event) => setDetailB(event.target.value)} /></label>
    {cfg.detailCLabel && <label className="field-stack"><span>{cfg.detailCLabel}</span><input type={cfg.detailCType || 'text'} min={cfg.detailCType === 'number' ? '0' : undefined} step="any" value={detailC} placeholder={cfg.detailCPlaceholder} onChange={(event) => setDetailC(event.target.value)} /></label>}
    <label className="field-stack"><span>空间</span><select value={firstArrayValue(payload.space_ids)} onChange={(event) => onChange('space_ids', event.target.value ? [event.target.value] : [])}><option value="">未指定</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="field-stack"><span>材料</span><select value={firstArrayValue(payload.material_ids)} onChange={(event) => onChange('material_ids', event.target.value ? [event.target.value] : [])}><option value="">未指定</option>{entities.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="field-stack"><span>参与者</span><select value={firstArrayValue(payload.participant_ids)} onChange={(event) => onChange('participant_ids', event.target.value ? [event.target.value] : [])}><option value="">未指定</option>{entities.participants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="field-stack"><span>装修阶段</span><select value={String(payload.stage_id ?? '')} onChange={(event) => onChange('stage_id', event.target.value || null)}><option value="">未指定</option>{entities.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {cfg.showVendor && <label className="field-stack"><span>商家</span><select value={String(payload.vendor_id ?? '')} onChange={(event) => onChange('vendor_id', event.target.value || null)}><option value="">未指定</option>{entities.vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <label className="field-stack"><span>发生日期</span><input type="date" value={String(payload.occurred_date ?? '')} onChange={(event) => onChange('occurred_date', event.target.value || null)} /></label>
  </div>
}

export function DomainWorkspace({ refreshKey, onSourcesChanged }: Props) {
  const [sources, setSources] = useState<SourceEntry[]>([])
  const [sourceId, setSourceId] = useState('')
  const [records, setRecords] = useState<DomainRecord[]>([])
  const [allRecords, setAllRecords] = useState<DomainRecord[]>([])
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [entities, setEntities] = useState<Record<EntityType, NamedEntity[]>>({
    materials: [], vendors: [], participants: [], stages: [],
  })
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
  const [editPayload, setEditPayload] = useState<Record<string, unknown>>({})
  const [message, setMessage] = useState('')
  const [bundle, setBundle] = useState<CandidateBundle | null>(null)
  const [suggestions, setSuggestions] = useState<CandidateSuggestion[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [engineMode, setEngineMode] = useState<'auto' | 'ai' | 'local'>('auto')
  const [manualKeyCounter, setManualKeyCounter] = useState(1)
  const [editingSource, setEditingSource] = useState(false)
  const [sourceDraft, setSourceDraft] = useState('')
  const [sourceTimeDraft, setSourceTimeDraft] = useState('')
  const [sourceBusy, setSourceBusy] = useState(false)

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
      applyBundle(latest ?? (force ? await createExtraction(selectedSource, engineMode) : null))
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

  const refreshSourceRows = async (preferredId = sourceId) => {
    const rows = await listSources()
    setSources(rows)
    const selected = rows.some((source) => source.id === preferredId)
      ? preferredId
      : rows[0]?.id || ''
    setSourceId(selected)
    return selected
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
  const relationFromRecord = allRecords.find((item) => item.id === relationFrom)
  const relationToRecord = allRecords.find((item) => item.id === relationTo)
  const rootHouseCount = spaces.filter(
    (item) => item.kind === 'house' && item.parent_id === null,
  ).length

  const recordOptionLabel = (record: DomainRecord) => {
    const typeLabel = recordConfig[record.record_type as RecordType]?.label || '记录'
    return `${typeLabel} · ${record.title}`
  }

  const updateSuggestion = (key: string, field: string, value: unknown) => {
    setSuggestions((current) => current.map((item) => item.key === key
      ? { ...item, payload: { ...item.payload, [field]: value } }
      : item))
  }

  const switchSuggestionType = (key: string, newType: RecordType) => {
    setSuggestions((current) => current.map((item) => {
      if (item.key !== key) return item
      const base: Record<string, unknown> = {
        title: item.payload.title,
        status: item.payload.status,
        occurred_date: item.payload.occurred_date,
        original_time_text: item.payload.original_time_text,
        timezone: item.payload.timezone,
        source_refs: item.payload.source_refs,
        space_ids: item.payload.space_ids,
        material_ids: item.payload.material_ids,
        participant_ids: item.payload.participant_ids,
        stage_id: item.payload.stage_id,
        vendor_id: item.payload.vendor_id,
      }
      return {
        ...item,
        record_type: newType,
        type_label: recordConfig[newType].label,
        payload: defaultPayload(newType, base),
      }
    }))
  }

  const addManualSuggestion = () => {
    const key = `manual:${manualKeyCounter}`
    setManualKeyCounter((c) => c + 1)
    const newSuggestion: CandidateSuggestion = {
      key,
      record_type: 'event',
      type_label: recordConfig.event.label,
      summary: '',
      evidence: '用户手工录入',
      certainty: 'explicit',
      certainty_label: '明确',
      selected_by_default: true,
      review_state: 'active',
      deferred_at: null,
      confirmed_record_id: null,
      payload: defaultPayload('event', {
        source_refs: sourceId ? [{ source_id: sourceId, evidence_excerpt: selectedSource?.original_text || null }] : [],
      }),
      missing_fields: [],
    }
    setSuggestions((current) => [...current, newSuggestion])
    setSelectedKeys((current) => {
      const next = new Set(current)
      next.add(key)
      return next
    })
  }

  const removeManualSuggestion = (key: string) => {
    setSuggestions((current) => current.filter((item) => item.key !== key))
    setSelectedKeys((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }

  const confirmSelected = async () => {
    const selected = suggestions.filter((item) => selectedKeys.has(item.key) && !item.confirmed_record_id)
    if (!selected.length) {
      setMessage('请先勾选至少一条尚未确认的建议。')
      return
    }
    const aiSelections = selected.filter((item) => !item.key.startsWith('manual:'))
    const manualSelections = selected.filter((item) => item.key.startsWith('manual:'))
    if (aiSelections.length && !bundle) {
      setMessage('候选包尚未加载，请等待分析完成或只提交手工记录。')
      return
    }
    setConfirming(true)
    try {
      if (aiSelections.length) {
        const result = await confirmCandidateBundle(bundle!.id, bundle!.version, aiSelections.map((item) => ({ key: item.key, payload: item.payload })))
        applyBundle(result.bundle)
      }
      if (manualSelections.length) {
        await Promise.all(manualSelections.map((item) => createRecord(item.payload)))
        setSuggestions((current) => current.filter((item) => !item.key.startsWith('manual:') || !selectedKeys.has(item.key)))
      }
      setMessage('所选建议已保存为正式记录。')
      await refreshRecords()
    } catch (error: unknown) {
      // 失败时不重置本地编辑，方便用户修正后重试。
      setMessage(error instanceof Error ? error.message : '确认失败，已保留当前编辑内容。')
    } finally {
      setConfirming(false)
    }
  }

  const saveEdit = async (record: DomainRecord) => {
    try {
      const payload: Record<string, unknown> = {
        ...editPayload,
        record_type: record.record_type,
      }
      // 原始来源在详细编辑中不可变，避免误重置来源复核版本。
      delete payload.source_refs
      await updateRecord(record.id, payload)
      setEditingId('')
      setMessage('记录详细信息已保存。')
      await refreshRecords()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '保存记录失败')
    }
  }

  const beginRecordEdit = (record: DomainRecord) => {
    const recordType = record.record_type as RecordType
    setEditPayload(defaultPayload(recordType, record))
    setEditingId(record.id)
  }

  const deleteSavedRecord = async (record: DomainRecord) => {
    const confirmed = window.confirm(
      `确认永久删除“${record.title}”吗？\n\n记录及其关联关系会被删除，原始来源和审计历史会保留。此操作无法恢复。`,
    )
    if (!confirmed) return
    try {
      await deleteRecord(record.id)
      setEditingId('')
      await Promise.all([refreshRecords(), loadSuggestions(sourceId)])
      setMessage('记录已删除，对应 AI 候选已恢复为可确认状态。')
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '删除记录失败')
    }
  }

  const beginSourceEdit = () => {
    if (!selectedSource) return
    setSourceDraft(selectedSource.original_text || '')
    setSourceTimeDraft(selectedSource.reported_time_text || '')
    setEditingSource(true)
  }

  const saveSourceEdit = async () => {
    if (!selectedSource || !sourceDraft.trim()) {
      setMessage('原始文字不能为空。')
      return
    }
    setSourceBusy(true)
    try {
      await updateSource(selectedSource.id, {
        original_text: sourceDraft.trim(),
        reported_time_text: sourceTimeDraft.trim() || null,
      })
      await refreshSourceRows(selectedSource.id)
      await refreshRecords(selectedSource.id)
      applyBundle(null)
      setEditingSource(false)
      setMessage('原始数据已修改。旧候选已失效，已有正式记录需要复核；请按需重新分析。')
      onSourcesChanged?.()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '修改原始数据失败')
    } finally {
      setSourceBusy(false)
    }
  }

  const deleteSelectedSource = async () => {
    if (!selectedSource) return
    setSourceBusy(true)
    try {
      const impact = await getSourceDeletionImpact(selectedSource.id)
      const confirmed = window.confirm(
        `确认永久删除这条原始数据吗？\n\n` +
        `将删除：${impact.exclusive_records} 条独占正式记录、${impact.candidate_bundles} 个候选包、` +
        `${impact.extraction_runs} 次提取、${impact.attachments} 个附件。\n` +
        `${impact.shared_records} 条多来源记录会保留，但解除本来源关联。` +
        (impact.affected_relations ? `\n另有 ${impact.affected_relations} 条记录关系会一并删除。` : '') +
        '\n\n审计历史会永久保留；此操作无法恢复。',
      )
      if (!confirmed) return
      const result = await deleteSource(selectedSource.id)
      const nextId = await refreshSourceRows('')
      applyBundle(null)
      await refreshRecords(nextId)
      if (nextId) await loadSuggestions(nextId)
      setEditingSource(false)
      setMessage(result.file_cleanup_warnings.length
        ? `原始数据及关联记录已删除。${result.file_cleanup_warnings.join('')}`
        : '原始数据及关联记录已删除。')
      onSourcesChanged?.()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '删除原始数据失败')
    } finally {
      setSourceBusy(false)
    }
  }

  const confirmSourceReview = async (record: DomainRecord) => {
    if (!sourceId) return
    try {
      await reviewRecordSource(record.id, sourceId)
      setMessage('已确认这条正式记录与当前原始数据一致。')
      await refreshRecords()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '确认复核失败')
    }
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

      {selectedSource && <section className="source-maintenance" aria-label="原始数据管理">
        <div className="source-maintenance__summary">
          <span>来源版本 v{selectedSource.revision} · 录入时间：{formatBeijingDateTime(selectedSource.captured_at)}</span>
          <div className="record-actions">
            <button type="button" disabled={sourceBusy} onClick={beginSourceEdit}>修改原始数据</button>
            <button className="danger-button" type="button" disabled={sourceBusy} onClick={() => void deleteSelectedSource()}>删除原始数据</button>
          </div>
        </div>
        {editingSource && <div className="source-edit-form">
          <label className="field-stack"><span>原始文字</span><textarea rows={3} value={sourceDraft} onChange={(event) => setSourceDraft(event.target.value)} /></label>
          <label className="field-stack"><span>原始时间描述（可选）</span><input value={sourceTimeDraft} onChange={(event) => setSourceTimeDraft(event.target.value)} placeholder="例如：2026年6月28日下午" /></label>
          <p className="risk-notice">修改会保留审计历史、使旧候选失效，并要求复核已生成的正式记录。</p>
          <div className="record-actions"><button type="button" disabled={sourceBusy} onClick={() => void saveSourceEdit()}>{sourceBusy ? '保存中…' : '保存修改'}</button><button type="button" onClick={() => setEditingSource(false)}>取消</button></div>
        </div>}
      </section>}

      <div className="suggestion-panel">
        <div className="ai-panel">
          <div className="ai-panel__left">
            <div className="ai-panel__title-row">
              <h3>智能拆分</h3>
            </div>
            {sourceId && bundle && (
              <p className="ai-panel__status">              已生成 {suggestions.length} 条候选记录<span className="model-label">（模型：{bundle.engine}）</span></p>
            )}
            {sourceId && !bundle && !analyzing && (
              <p className="ai-panel__status">暂未分析</p>
            )}
          </div>
          <div className="ai-panel__actions">
            <button
              className="secondary-button ai-panel__action-btn"
              type="button"
              disabled={!sourceId || analyzing}
              onClick={() => void loadSuggestions(sourceId, true).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '分析失败'))}
            >
              {analyzing ? 'AI 正在分析…' : suggestions.length > 0 ? '重新分析' : '分析'}
            </button>
            <label className="ai-panel__options">
              <select value={engineMode} onChange={(event) => setEngineMode(event.target.value as 'auto' | 'ai' | 'local')}>
                <option value="auto">自动主备并本地兜底</option>
                <option value="ai">仅 AI（失败可见）</option>
                <option value="local">仅本地规则</option>
              </select>
            </label>
          </div>
        </div>
        {analyzing && <p className="analysis-state" role="status">AI 正在分析…主备引擎共享 30 秒预算，失败后会提供本地规则建议。</p>}
        {bundle?.fallback_reason && <p className="fallback-notice">AI 暂不可用，本地规则已提供建议。原因：{bundle.fallback_reason}</p>}
        {!analyzing && sourceId && suggestions.length === 0 && <p className="muted">暂未识别，原始文字已经保留。</p>}
        {suggestions.map((suggestion) => {
          const confirmed = Boolean(suggestion.confirmed_record_id)
          const payload = suggestion.payload
          const recordType = suggestion.record_type as RecordType
          const cfg = typeFieldConfig[recordType]
          const highRisk = ['ledger', 'issue', 'decision'].includes(recordType)
          const title = String(payload.title ?? '')
          const status = String(payload.status ?? recordConfig[recordType].statuses[0])
          const direction = String(payload.direction ?? 'expense')
          const occurredDate = String(payload.occurred_date ?? '')
          const spaceIds = Array.isArray(payload.space_ids) ? payload.space_ids : []
          const materialIds = Array.isArray(payload.material_ids) ? payload.material_ids : []
          const participantIds = Array.isArray(payload.participant_ids) ? payload.participant_ids : []
          const stageId = String(payload.stage_id ?? '')
          const vendorId = String(payload.vendor_id ?? '')
          const detailA = recordType === 'event' ? String(payload.event_kind ?? '')
            : recordType === 'ledger' ? String(payload.payment_kind ?? '')
            : recordType === 'issue' ? String(payload.phenomenon ?? '')
            : recordType === 'measurement' ? String(payload.object_name ?? '')
            : recordType === 'decision' ? String(payload.topic ?? '')
            : recordType === 'procurement' ? String(payload.item_name ?? '')
            : recordType === 'research' ? String(payload.question ?? '')
            : String(payload.action ?? '')
          const detailB = recordType === 'ledger' ? (payload.amount_minor ? String(Number(payload.amount_minor) / 100) : '')
            : recordType === 'measurement' ? String((normalizeMeasurementValues(payload.values)[0]?.value) ?? '')
            : recordType === 'decision' || recordType === 'research' ? (Array.isArray(payload.options) ? payload.options.join('，') : String(payload.options ?? ''))
            : recordType === 'procurement' ? String(payload.quantity ?? '')
            : recordType === 'event' ? String(payload.result ?? '')
            : recordType === 'issue' ? String(payload.handling_plan ?? '')
            : String(payload.trigger_condition ?? '')
          const detailC = recordType === 'measurement' ? String((normalizeMeasurementValues(payload.values)[1]?.value) ?? '')
            : recordType === 'decision' ? String(payload.selected_option ?? '')
            : recordType === 'procurement' ? (payload.order_total_minor ? String(Number(payload.order_total_minor) / 100) : '')
            : ''

          const isManual = suggestion.key.startsWith('manual:')

          return <article className={`record-card suggestion-card${highRisk ? ' suggestion-card--risk' : ''}`} key={suggestion.key}>
            <div className="suggestion-card__header">
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
              {isManual && !confirmed && <button className="suggestion-remove" type="button" onClick={() => removeManualSuggestion(suggestion.key)}>移除</button>}
            </div>
            <p>原文依据：{suggestion.evidence}</p>
            <p>{confirmed ? '已确认并生成正式记录' : `可信程度：${suggestion.certainty_label}`}</p>
            {highRisk && !confirmed && <p className="risk-notice">请重点核对：此项涉及金额、施工问题或关键决策，AI 不会代替你确认。</p>}
            {!confirmed && <>
              <div className="suggestion-type-select">
                <label className="field-stack">
                  <span>记录类型</span>
                  <select value={recordType} onChange={(event) => switchSuggestionType(suggestion.key, event.target.value as RecordType)}>
                    {Object.entries(recordConfig).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="record-form-grid">
                <label className="field-stack record-form-grid__wide"><span>标题</span><input value={title} placeholder={titlePlaceholder[recordType]} onChange={(event) => updateSuggestion(suggestion.key, 'title', event.target.value)} /></label>
                <label className="field-stack"><span>状态</span>
                  <select value={status} onChange={(event) => updateSuggestion(suggestion.key, 'status', event.target.value)}>
                    {recordConfig[recordType].statuses.map((item) => <option key={item} value={item}>{recordStatusLabel(recordType, item)}</option>)}
                  </select>
                </label>
                <label className="field-stack"><span>{cfg.detailALabel}</span><input value={detailA} placeholder={cfg.detailAPlaceholder} onChange={(event) => {
                  const value = event.target.value
                  if (recordType === 'event') updateSuggestion(suggestion.key, 'event_kind', value)
                  else if (recordType === 'ledger') updateSuggestion(suggestion.key, 'payment_kind', value)
                  else if (recordType === 'issue') updateSuggestion(suggestion.key, 'phenomenon', value)
                  else if (recordType === 'measurement') updateSuggestion(suggestion.key, 'object_name', value)
                  else if (recordType === 'decision') updateSuggestion(suggestion.key, 'topic', value)
                  else if (recordType === 'procurement') updateSuggestion(suggestion.key, 'item_name', value)
                  else if (recordType === 'research') updateSuggestion(suggestion.key, 'question', value)
                  else updateSuggestion(suggestion.key, 'action', value)
                }}                 /></label>
                {recordType === 'ledger' && <label className="field-stack"><span>收支方向</span>
                  <select value={direction} onChange={(event) => updateSuggestion(suggestion.key, 'direction', event.target.value)}>
                    <option value="expense">支出</option>
                    <option value="refund">退款</option>
                    <option value="income">收入</option>
                  </select>
                </label>}
                <label className="field-stack"><span>{cfg.detailBLabel}</span>
                  <input
                    type={cfg.detailBType || 'text'}
                    min={cfg.detailBType === 'number' ? '0' : undefined}
                    step="any"
                    value={detailB}
                    placeholder={cfg.detailBPlaceholder}
                    onChange={(event) => {
                      const value = event.target.value
                      if (recordType === 'ledger') updateSuggestion(suggestion.key, 'amount_minor', value.trim() ? Math.round(Number(value) * 100) : null)
                      else if (recordType === 'measurement') {
                        const values = normalizeMeasurementValues(payload.values)
                        if (values[0]) values[0].value = value.trim() ? Number(value) : null
                        updateSuggestion(suggestion.key, 'values', values)
                      }
                      else if (recordType === 'decision' || recordType === 'research') updateSuggestion(suggestion.key, 'options', normalizeOptions(value))
                      else if (recordType === 'procurement') updateSuggestion(suggestion.key, 'quantity', value.trim() ? Number(value) : null)
                      else if (recordType === 'event') updateSuggestion(suggestion.key, 'result', value)
                      else if (recordType === 'issue') updateSuggestion(suggestion.key, 'handling_plan', value)
                      else updateSuggestion(suggestion.key, 'trigger_condition', value)
                    }}
                  />
                </label>
                {cfg.detailCLabel && <label className="field-stack"><span>{cfg.detailCLabel}</span>
                  <input
                    type={cfg.detailCType || 'text'}
                    min={cfg.detailCType === 'number' ? '0' : undefined}
                    step="any"
                    value={detailC}
                    placeholder={cfg.detailCPlaceholder}
                    onChange={(event) => {
                      const value = event.target.value
                      if (recordType === 'measurement') {
                        const values = normalizeMeasurementValues(payload.values)
                        if (values[1]) values[1].value = value.trim() ? Number(value) : null
                        updateSuggestion(suggestion.key, 'values', values)
                      }
                      else if (recordType === 'decision') updateSuggestion(suggestion.key, 'selected_option', value)
                      else if (recordType === 'procurement') updateSuggestion(suggestion.key, 'order_total_minor', value.trim() ? Math.round(Number(value) * 100) : null)
                    }}
                  />
                </label>}
                <label className="field-stack"><span>空间</span>
                  <select value={firstArrayValue(spaceIds)} onChange={(event) => updateSuggestion(suggestion.key, 'space_ids', event.target.value ? [event.target.value] : [])}>
                    <option value="">未指定</option>
                    {spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="field-stack"><span>材料</span>
                  <select value={firstArrayValue(materialIds)} onChange={(event) => updateSuggestion(suggestion.key, 'material_ids', event.target.value ? [event.target.value] : [])}>
                    <option value="">未指定</option>
                    {entities.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="field-stack"><span>参与者</span>
                  <select value={firstArrayValue(participantIds)} onChange={(event) => updateSuggestion(suggestion.key, 'participant_ids', event.target.value ? [event.target.value] : [])}>
                    <option value="">未指定</option>
                    {entities.participants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="field-stack"><span>装修阶段</span>
                  <select value={stageId} onChange={(event) => updateSuggestion(suggestion.key, 'stage_id', event.target.value || null)}>
                    <option value="">未指定</option>
                    {entities.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                {cfg.showVendor && <label className="field-stack"><span>商家</span>
                  <select value={vendorId} onChange={(event) => updateSuggestion(suggestion.key, 'vendor_id', event.target.value || null)}>
                    <option value="">未指定</option>
                    {entities.vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>}
                <label className="field-stack"><span>发生日期</span>
                  <input type="date" value={occurredDate} onChange={(event) => updateSuggestion(suggestion.key, 'occurred_date', event.target.value || null)} />
                </label>
              </div>
            </>}
            {suggestion.missing_fields.length > 0 && <p className="muted">还可补充：{suggestion.missing_fields.join('、')}</p>}
          </article>
        })}
        {suggestions.length > 0 && <div className="suggestion-actions">
          <button className="source-save" type="button" disabled={confirming} onClick={() => void confirmSelected()}>{confirming ? '正在确认…' : '确认所选'}</button>
          <button className="add-manual-suggestion" type="button" onClick={addManualSuggestion}>+ 添加手工记录</button>
        </div>}
        {suggestions.length === 0 && !analyzing && sourceId && <div className="suggestion-actions">
          <button className="add-manual-suggestion" type="button" onClick={addManualSuggestion}>+ 添加手工记录</button>
        </div>}
      </div>

      {message && <p className="workspace-message" role="status">{message}</p>}

      <div className="record-list">
        <h3>已保存的记录</h3>
        <p className="record-list__guide">这里的记录已经正式保存，会出现在时间线、账本、问题或空间等页面中。状态表示事情目前进展到哪一步。</p>
        {records.length === 0 && <p className="muted">这条来源还没有生成记录。</p>}
        {records.map((record) => <article className="record-card" key={record.id}>
          {record.source_refs.some((sourceRef) => sourceRef.source_id === sourceId && sourceRef.needs_review) && <div className="source-review-warning"><span>原始数据已修改，这条正式记录待复核。</span><button type="button" onClick={() => void confirmSourceReview(record)}>已核对，无需修改</button></div>}
          {editingId === record.id ? <div className="record-edit-form">
            <SavedRecordEditFields recordType={record.record_type as RecordType} payload={editPayload} spaces={spaces} entities={entities} onChange={(field, value) => setEditPayload((current) => ({ ...current, [field]: value }))} />
            <div className="record-actions"><button type="button" onClick={() => void saveEdit(record)}>保存修改</button><button type="button" onClick={() => setEditingId('')}>取消</button></div>
          </div> : <>
            <strong>{recordConfig[record.record_type as RecordType]?.label} · {record.title}</strong>
            <p><strong>状态：</strong>{recordStatusLabel(record.record_type, record.status)}{record.archived_at ? ' · 已归档隐藏' : ''}</p>
            {recordStatusDescription(record.record_type, record.status) && <p className="record-status-help">{recordStatusDescription(record.record_type, record.status)}</p>}
            <div className="record-actions"><button type="button" onClick={() => beginRecordEdit(record)}>详细修改</button><button type="button" onClick={() => void setRecordArchived(record.id, !record.archived_at).then(() => refreshRecords())}>{record.archived_at ? '恢复显示' : '归档并隐藏'}</button><button className="danger-button" type="button" onClick={() => void deleteSavedRecord(record)}>删除记录</button></div>
            <small className="record-action-help">详细修改不会改变记录类型和原始来源；删除无法恢复，但会保留来源与审计历史。</small>
          </>}
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
