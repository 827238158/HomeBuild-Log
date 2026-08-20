import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Select } from './Select'
import { useDropdownPosition } from './useDropdownPosition'

import {
  createEntity,
  confirmCandidateBundle,
  createRecord,
  createExtraction,
  deleteSource,
  deleteEntity,
  deleteSpace,
  getLatestCandidateBundle,
  getSourceDeletionImpact,
  createSpace,
  listEntities,
  listRecords,
  listSources,
  listSpaces,
  deferCandidate,
  updateSource,
  type DomainRecord,
  type EntityType,
  type NamedEntity,
  type CandidateBundle,
  type CandidateSuggestion,
  type SourceEntry,
  type SpaceEntry,
} from './domainApi'
import { recordStatusLabel } from './recordLabels'
import { completedStatusForLedgerKind, recordConfig, statusesForRecord, type RecordType } from './recordConfig'
import { measurementRoleLabels, normalizeMeasurementRole } from './recordFields'
import { formatBeijingDate, formatBeijingDateTime } from './time'

interface Props {
  refreshKey: number
  preferredSourceId?: string
  onSourcesChanged?: () => void
}
export type { RecordType } from './recordConfig'

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
    detailBLabel: '宽度（mm）',
    detailBPlaceholder: '未知可不填',
    detailCLabel: '高度（mm）',
    detailCPlaceholder: '未知可不填',
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
  research: {
    detailALabel: '调研问题',
    detailAPlaceholder: '例如：卫生间墙砖选哪种？',
    detailBLabel: '调研对象（逗号分隔）',
    detailBPlaceholder: '例如：柔光砖，亮面砖',
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
  research: '例如：比较卫生间墙砖方案',
}

function normalizeOptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
  return []
}

export function payloadForSave(recordType: string, payload: Record<string, unknown>) {
  const next = { ...payload }
  delete next.related_candidate_keys
  if (recordType === 'measurement') {
    next.measurement_role = normalizeMeasurementRole(next.measurement_role)
    next.values = normalizeMeasurementValues(next.values).filter((item) => {
      const value = Number(item.value)
      return item.value !== null && item.value !== '' && Number.isFinite(value) && value > 0
    }).map((item) => ({ ...item, unit: 'mm' }))
  }
  return next
}

function OptionsTextInput({
  label, placeholder, value, onCommit,
}: {
  label: string
  placeholder: string
  value: unknown
  onCommit: (options: string[]) => void
}) {
  const normalized = normalizeOptions(value).join('，')
  const [draft, setDraft] = useState(normalized)
  return <label className="field-stack"><span>{label}</span><input value={draft} placeholder={placeholder} onChange={(event) => {
    // 保留用户正在输入的标点原文，同时即时同步解析结果，避免点击确认时丢失最后一次输入。
    setDraft(event.target.value)
    onCommit(normalizeOptions(event.target.value))
  }} /></label>
}

function MultiSelectField({
  label, selectedIds, options, onChange,
}: {
  label: string
  selectedIds: string[]
  options: Array<{ id: string; name: string; trailingText?: string }>
  onChange: (ids: string[]) => void
}) {
  const controlId = useId()
  const rootRef = useRef<HTMLFieldSetElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const menuStyle = useDropdownPosition(triggerRef, open)
  const selected = options.filter((item) => selectedIds.includes(item.id))
  const toggle = (id: string) => onChange(selectedIds.includes(id)
    ? selectedIds.filter((item) => item !== id)
    : [...selectedIds, id])
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== controlId) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('homebuild-dropdown-open', closeOther)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('homebuild-dropdown-open', closeOther)
    }
  }, [controlId])
  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    if (next) window.dispatchEvent(new CustomEvent('homebuild-dropdown-open', { detail: controlId }))
  }
  const summary = selected.length === 0
    ? '请选择（可多选）'
    : selected.length <= 2 ? selected.map((item) => item.name).join('、') : `已选择 ${selected.length} 项`
  return <fieldset ref={rootRef} className="multi-select-field"><legend>{label}</legend><div className="multi-select-control"><button ref={triggerRef} className="multi-select-summary" type="button" id={controlId} aria-haspopup="listbox" aria-expanded={open} onClick={toggleOpen}><span>{summary}</span></button>{open && createPortal(<div ref={menuRef} className="multi-select-options dropdown-portal" style={menuStyle} role="listbox" aria-multiselectable="true">{options.length > 0 ? options.map((item) => <label key={item.id} role="option" aria-selected={selectedIds.includes(item.id)}><input aria-label={item.name} type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} /><span className="multi-select-option__name">{item.name}</span>{item.trailingText && <span className="multi-select-option__meta">{item.trailingText}</span>}</label>) : <span>暂无可选项</span>}</div>, document.body)}</div></fieldset>
}

function recordSelectOption(record: DomainRecord) {
  const typeLabel = recordConfig[record.record_type as RecordType]?.label || '记录'
  return {
    id: record.id,
    name: `${typeLabel} · ${record.title}`,
    trailingText: formatBeijingDate(record.created_at),
  }
}

function SourcePicker({
  sources, value, onChange,
}: {
  sources: SourceEntry[]
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [expandedText, setExpandedText] = useState<string | null>(null)
  const menuStyle = useDropdownPosition(triggerRef, open, 360)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({})
  const selected = sources.find((source) => source.id === value)
  const status = (source: SourceEntry) => {
    const pending = source.pending_candidate_count ?? 0
    const generated = source.generated_record_count ?? 0
    if (pending > 0 && generated > 0) return `待 ${pending} · 已生成 ${generated}`
    if (pending > 0) return `待处理 ${pending} 条`
    if (source.analysis_status === 'reviewed') return '已分析，无待处理'
    if (source.analysis_status === 'confirmed') return `已生成 ${generated} 条`
    // 兼容尚未返回候选数量的旧接口数据。
    if (source.analysis_status === 'pending' || source.analysis_status === 'partially_confirmed') return '待处理'
    return '未分析'
  }
  const clearExpandedText = () => {
    // 同时取消长按计时和全文提示，避免菜单关闭后浮层残留。
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setExpandedText(null)
  }
  useLayoutEffect(() => {
    if (!expandedText || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 8
    setPopoverStyle({
      position: 'fixed',
      left: Math.max(8, rect.left),
      bottom: window.innerHeight - rect.top + gap,
      maxWidth: Math.min(400, window.innerWidth - 16),
      zIndex: 10000,
    })
  }, [expandedText])

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
        clearExpandedText()
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); clearExpandedText() }
    }
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) {
        setOpen(false)
        clearExpandedText()
      }
    }
    const closeOnScroll = (event: Event) => {
      // 来源列表内部滚动不应触发关闭。
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setOpen(false)
      clearExpandedText()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('homebuild-dropdown-open', closeOther)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('homebuild-dropdown-open', closeOther)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [id])
  const beginLongPress = (text: string) => {
    clearExpandedText()
    timerRef.current = setTimeout(() => setExpandedText(text), 520)
  }
  return <div ref={rootRef} className="source-picker field-stack">
    <span>原始数据来源</span>
    <button ref={triggerRef} type="button" className="source-picker__trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => {
      const next = !open
      setOpen(next)
      if (next) window.dispatchEvent(new CustomEvent('homebuild-dropdown-open', { detail: id }))
    }}><span className="source-picker__text">{selected?.original_text || '请选择'}</span>{selected && <span className={`source-picker__status source-picker__status--${selected.analysis_status || 'unprocessed'}`}>{status(selected)}</span>}</button>
    {open && createPortal(<div ref={menuRef} className="source-picker__menu dropdown-portal" style={menuStyle} role="listbox">{sources.map((source) => {
      const text = source.original_text || '仅附件来源'
      return <button key={source.id} type="button" role="option" aria-selected={source.id === value} className="source-picker__option" onClick={() => { onChange(source.id); clearExpandedText(); setOpen(false) }} onPointerDown={() => beginLongPress(text)} onPointerUp={clearExpandedText} onPointerCancel={clearExpandedText} onPointerLeave={clearExpandedText}><span className="source-picker__text" title={text}>{text}</span><span className={`source-picker__status source-picker__status--${source.analysis_status || 'unprocessed'}`}>{status(source)}</span></button>
    })}</div>, document.body)}
    {expandedText && createPortal(<div ref={popoverRef} className="source-picker__popover" role="tooltip" style={popoverStyle}>{expandedText}</div>, document.body)}
  </div>
}

export function normalizeMeasurementValues(values: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(values)) return []
  const normalized = values.map((entry) => {
    if (typeof entry !== 'object' || entry === null) return {}
    const next = { ...(entry as Record<string, unknown>) }
    const unit = String(next.unit ?? 'mm').toLowerCase()
    const hasValue = next.value !== null && next.value !== '' && next.value !== undefined
    const numeric = hasValue ? Number(next.value) : Number.NaN
    if (hasValue && Number.isFinite(numeric)) {
      if (unit === 'cm') next.value = numeric * 10
      else if (unit === 'm') next.value = numeric * 1000
      else next.value = numeric
    } else {
      next.value = null
    }
    next.unit = 'mm'
    return next
  })
  const axes = ['width', 'height', 'length']
  const slots: Array<Record<string, unknown> | null> = [null, null, null]
  const unassigned: Array<Record<string, unknown>> = []
  normalized.forEach((entry) => {
    const index = axes.indexOf(String(entry.axis ?? ''))
    if (index >= 0 && slots[index] === null) slots[index] = { ...entry, axis: axes[index] }
    else unassigned.push(entry)
  })
  axes.forEach((axis, index) => {
    if (slots[index] !== null) return
    const fallback = unassigned.shift()
    slots[index] = { ...(fallback ?? {}), axis, value: fallback?.value ?? null, unit: 'mm' }
  })
  return slots as Array<Record<string, unknown>>
}

export function defaultPayload(recordType: RecordType, base: Record<string, unknown> = {}): Record<string, unknown> {
  const ledgerKind = String(base.ledger_kind ?? 'payment')
  const allowedStatuses = statusesForRecord(recordType, ledgerKind)
  const requestedStatus = String(base.status ?? '')
  const common: Record<string, unknown> = {
    record_type: recordType,
    title: base.title ?? '',
    description: base.description ?? null,
    status: allowedStatuses.includes(requestedStatus) ? requestedStatus : allowedStatuses[0],
    occurred_date: base.occurred_date ?? null,
    original_time_text: base.original_time_text ?? null,
    timezone: base.timezone ?? 'Asia/Shanghai',
    source_refs: base.source_refs ?? [],
    space_ids: base.space_ids ?? [],
    material_ids: base.material_ids ?? [],
    participant_ids: base.participant_ids ?? [],
    related_record_ids: base.related_record_ids ?? [],
    stage_id: base.stage_id ?? null,
  }
  if (recordType === 'event') {
    return { ...common, event_kind: base.event_kind ?? '', result: base.result ?? null }
  }
  if (recordType === 'ledger') {
    return {
      ...common,
      ledger_kind: base.ledger_kind ?? 'payment',
      direction: base.direction ?? 'expense',
      payment_kind: base.payment_kind ?? '',
      amount_minor: base.amount_minor ?? null,
      vendor_id: base.vendor_id ?? null,
    }
  }
  if (recordType === 'issue') {
    return {
      ...common,
      phenomenon: base.phenomenon ?? '',
      handling_plan: base.handling_plan ?? null,
      severity: base.severity ?? '',
      completed_at: base.completed_at ?? null,
      actual_result: base.actual_result ?? null,
    }
  }
  if (recordType === 'measurement') {
    const values = normalizeMeasurementValues(base.values)
    return {
      ...common,
      object_name: base.object_name ?? '',
      measurement_role: normalizeMeasurementRole(base.measurement_role),
      values: values.length
        ? values
        : [
            { axis: 'width', value: null, unit: 'mm' },
            { axis: 'height', value: null, unit: 'mm' },
            { axis: 'length', value: null, unit: 'mm' },
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
  if (recordType === 'research') {
    return { ...common, question: base.question ?? '', options: normalizeOptions(base.options) }
  }
  return common
}

function toDateInput(value: unknown): string {
  return value ? String(value).slice(0, 10) : ''
}

export function RecordEditFields({
  recordType, payload, spaces, entities, records = [], currentRecordId, onChange,
}: {
  recordType: RecordType
  payload: Record<string, unknown>
  spaces: SpaceEntry[]
  entities: Record<EntityType, NamedEntity[]>
  records?: DomainRecord[]
  currentRecordId?: string
  onChange: (field: string, value: unknown) => void
}) {
  const ledgerKind = String(payload.ledger_kind ?? 'payment')
  const cfg = typeFieldConfig[recordType]
  const status = String(payload.status ?? recordConfig[recordType].statuses[0])
  const visibleStatuses = statusesForRecord(recordType, ledgerKind)
  const detailA = recordType === 'event' ? String(payload.event_kind ?? '')
    : recordType === 'ledger' ? String(payload.payment_kind ?? '')
    : recordType === 'issue' ? String(payload.phenomenon ?? '')
    : recordType === 'measurement' ? String(payload.object_name ?? '')
    : recordType === 'decision' ? String(payload.topic ?? '')
    : String(payload.question ?? '')
  const detailB = recordType === 'ledger' ? (payload.amount_minor ? String(Number(payload.amount_minor) / 100) : '')
    : recordType === 'measurement' ? String(normalizeMeasurementValues(payload.values)[0]?.value ?? '')
    : recordType === 'decision' || recordType === 'research' ? normalizeOptions(payload.options).join('，')
    : recordType === 'event' ? String(payload.result ?? '')
    : String(payload.handling_plan ?? '')
  const detailC = recordType === 'measurement' ? String(normalizeMeasurementValues(payload.values)[1]?.value ?? '')
    : recordType === 'decision' ? String(payload.selected_option ?? '')
    : ''
  const detailD = recordType === 'measurement' ? String(normalizeMeasurementValues(payload.values)[2]?.value ?? '') : ''

  const setDetailA = (value: string) => onChange({
    event: 'event_kind', ledger: 'payment_kind', issue: 'phenomenon', measurement: 'object_name',
    decision: 'topic', research: 'question',
  }[recordType], value)
  const setDetailB = (value: string) => {
    if (recordType === 'ledger') onChange('amount_minor', value.trim() ? Math.round(Number(value) * 100) : null)
    else if (recordType === 'measurement') {
      const values = normalizeMeasurementValues(payload.values)
      if (values[0]) values[0].value = value.trim() ? Number(value) : null
      onChange('values', values)
    } else if (recordType === 'decision' || recordType === 'research') onChange('options', normalizeOptions(value))
    else if (recordType === 'event') onChange('result', value)
    else if (recordType === 'issue') onChange('handling_plan', value)
  }
  const setDetailC = (value: string) => {
    if (recordType === 'measurement') {
      const values = normalizeMeasurementValues(payload.values)
      if (values[1]) values[1].value = value.trim() ? Number(value) : null
      onChange('values', values)
    } else if (recordType === 'decision') onChange('selected_option', value)
  }
  const setMeasurementValue = (index: number, value: string) => {
    const values = normalizeMeasurementValues(payload.values)
    values[index] = { ...(values[index] ?? {}), axis: ['width', 'height', 'length'][index], value: value.trim() ? Number(value) : null, unit: 'mm' }
    onChange('values', values)
  }

  return <div className="record-form-grid">
    <label className="field-stack record-form-grid__wide"><span>标题</span><input value={String(payload.title ?? '')} placeholder={titlePlaceholder[recordType]} onChange={(event) => onChange('title', event.target.value)} /></label>
    <label className="field-stack"><span>状态</span><Select value={status} onChange={(event) => onChange('status', event.target.value)}>{visibleStatuses.map((item) => <option key={item} value={item}>{recordStatusLabel(recordType, item, ledgerKind)}</option>)}</Select></label>
    {recordType === 'measurement' && <label className="field-stack"><span>尺寸用途</span><Select value={normalizeMeasurementRole(payload.measurement_role)} onChange={(event) => onChange('measurement_role', event.target.value)}>{Object.entries(measurementRoleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>}
    {recordType === 'ledger' && <label className="field-stack"><span>账目类型</span><Select value={ledgerKind} onChange={(event) => {
      const kind = event.target.value
      onChange('ledger_kind', kind)
      onChange('status', completedStatusForLedgerKind(kind))
      onChange('direction', kind === 'refund' ? 'refund' : kind === 'income' ? 'income' : 'expense')
    }}><option value="payment">付款</option><option value="refund">退款</option><option value="income">收入</option></Select></label>}
    <label className="field-stack"><span>{cfg.detailALabel}</span><input value={detailA} placeholder={cfg.detailAPlaceholder} onChange={(event) => setDetailA(event.target.value)} /></label>
    {recordType === 'measurement'
      ? <fieldset className="measurement-triplet record-form-grid__wide"><legend>尺寸（mm，未知可不填）</legend><label><span>宽度</span><input type="number" min="0" step="any" value={detailB} onChange={(event) => setMeasurementValue(0, event.target.value)} /></label><label><span>高度</span><input type="number" min="0" step="any" value={detailC} onChange={(event) => setMeasurementValue(1, event.target.value)} /></label><label><span>长度</span><input type="number" min="0" step="any" value={detailD} onChange={(event) => setMeasurementValue(2, event.target.value)} /></label></fieldset>
      : recordType === 'decision' || recordType === 'research'
      ? <OptionsTextInput label={cfg.detailBLabel} placeholder={cfg.detailBPlaceholder} value={payload.options} onCommit={(options) => onChange('options', options)} />
      : <label className="field-stack"><span>{cfg.detailBLabel}</span><input type={cfg.detailBType || 'text'} min={cfg.detailBType === 'number' ? '0' : undefined} step="any" value={detailB} placeholder={cfg.detailBPlaceholder} onChange={(event) => setDetailB(event.target.value)} /></label>}
    {recordType !== 'measurement' && cfg.detailCLabel && <label className="field-stack"><span>{cfg.detailCLabel}</span><input type={cfg.detailCType || 'text'} min={cfg.detailCType === 'number' ? '0' : undefined} step="any" value={detailC} placeholder={cfg.detailCPlaceholder} onChange={(event) => setDetailC(event.target.value)} /></label>}
    <MultiSelectField label="空间" selectedIds={Array.isArray(payload.space_ids) ? payload.space_ids.map(String) : []} options={spaces} onChange={(ids) => onChange('space_ids', ids)} />
    <MultiSelectField label="材料" selectedIds={Array.isArray(payload.material_ids) ? payload.material_ids.map(String) : []} options={entities.materials} onChange={(ids) => onChange('material_ids', ids)} />
    <MultiSelectField label={recordType === 'issue' ? '处理人' : '参与者'} selectedIds={Array.isArray(payload.participant_ids) ? payload.participant_ids.map(String) : []} options={entities.participants} onChange={(ids) => onChange('participant_ids', ids)} />
    <MultiSelectField label="关联记录（可选）" selectedIds={Array.isArray(payload.related_record_ids) ? payload.related_record_ids.map(String) : []} options={records.filter((item) => item.id !== currentRecordId).map(recordSelectOption)} onChange={(ids) => onChange('related_record_ids', ids)} />
    <label className="field-stack"><span>装修阶段</span><Select value={String(payload.stage_id ?? '')} onChange={(event) => onChange('stage_id', event.target.value || null)}><option value="">未指定</option>{entities.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
    {cfg.showVendor && <label className="field-stack"><span>{recordType === 'ledger' ? '交易对象（商家）' : '商家'}</span><Select required={recordType === 'ledger'} value={String(payload.vendor_id ?? '')} onChange={(event) => onChange('vendor_id', event.target.value || null)}><option value="">请选择</option>{entities.vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>}
    <label className="field-stack"><span>发生日期</span><input type="date" value={String(payload.occurred_date ?? '')} onChange={(event) => onChange('occurred_date', event.target.value || null)} /></label>
    <label className="field-stack record-form-grid__wide"><span>补充说明</span><textarea rows={3} value={String(payload.description ?? '')} onChange={(event) => onChange('description', event.target.value || null)} /></label>
    {recordType === 'issue' && <>
      <label className="field-stack"><span>严重程度</span><Select required value={String(payload.severity ?? '')} onChange={(event) => onChange('severity', event.target.value || null)}><option value="">请选择</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></Select></label>
      {status === 'done' && <><label className="field-stack"><span>实际完成日期</span><input type="date" value={toDateInput(payload.completed_at)} onChange={(event) => onChange('completed_at', event.target.value || null)} /></label><label className="field-stack record-form-grid__wide"><span>实际处理结果</span><textarea required rows={2} value={String(payload.actual_result ?? '')} onChange={(event) => onChange('actual_result', event.target.value || null)} /></label></>}
    </>}
  </div>
}

export function DomainWorkspace({ refreshKey, preferredSourceId, onSourcesChanged }: Props) {
  const [sources, setSources] = useState<SourceEntry[]>([])
  const [sourceId, setSourceId] = useState('')
  const [allRecords, setAllRecords] = useState<DomainRecord[]>([])
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [entities, setEntities] = useState<Record<EntityType, NamedEntity[]>>({
    materials: [], vendors: [], participants: [], stages: [],
  })
  const [manageType, setManageType] = useState<EntityType>('materials')
  const [manageName, setManageName] = useState('')
  const [manageBrand, setManageBrand] = useState('')
  const [spaceName, setSpaceName] = useState('')
  const [spaceKind, setSpaceKind] = useState('room')
  const [spaceParent, setSpaceParent] = useState('')
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

  const applyBundle = (
    nextBundle: CandidateBundle | null,
    preserveManual = false,
    preserveDrafts = false,
  ) => {
    setBundle(nextBundle)
    setSuggestions((current) => {
      const currentByKey = new Map(current.map((item) => [item.key, item]))
      const manualSuggestions = preserveManual
        ? current.filter((item) => item.key.startsWith('manual:'))
        : []
      const relatedCandidateKeys = new Map<string, string[]>()
      for (const relation of nextBundle?.relations ?? []) {
        relatedCandidateKeys.set(relation.from_key, [...(relatedCandidateKeys.get(relation.from_key) ?? []), relation.to_key])
        relatedCandidateKeys.set(relation.to_key, [...(relatedCandidateKeys.get(relation.to_key) ?? []), relation.from_key])
      }
      const serverSuggestions = (nextBundle?.suggestions ?? []).filter(
        (item) => item.review_state !== 'deferred' && item.record_type !== 'procurement',
      ).map((item) => item.record_type === 'todo' ? {
      ...item,
      record_type: 'issue',
      type_label: '问题',
      payload: defaultPayload('issue', {
        ...item.payload,
        phenomenon: item.payload.action ?? item.payload.title,
        actual_result: item.payload.completion_evidence ?? null,
        severity: item.payload.severity ?? '',
        status: item.payload.status === 'done' ? 'done' : item.payload.status === 'in_progress' ? 'in_progress' : 'pending',
      }),
      } : item.record_type === 'issue' ? { ...item, type_label: '问题' }
      : item.record_type === 'measurement' ? { ...item, payload: {
        ...item.payload,
        status: recordConfig.measurement.statuses.includes(String(item.payload.status) as 'active' | 'superseded' | 'cancelled') ? item.payload.status : 'active',
        measurement_role: normalizeMeasurementRole(item.payload.measurement_role),
        values: normalizeMeasurementValues(item.payload.values),
      } }
      : item).map((item) => ({
        ...item,
        payload: {
          ...item.payload,
          related_record_ids: Array.isArray(item.payload.related_record_ids) ? item.payload.related_record_ids : [],
          related_candidate_keys: relatedCandidateKeys.get(item.key) ?? [],
        },
      })).map((item) => {
        const draft = currentByKey.get(item.key)
        return preserveDrafts && draft && !item.confirmed_record_id
          ? { ...item, record_type: draft.record_type, type_label: draft.type_label, payload: draft.payload }
          : item
      })
      const nextSuggestions = [...serverSuggestions, ...manualSuggestions]
      setSelectedKeys((currentKeys) => new Set(nextSuggestions
        .filter((item) => !item.confirmed_record_id && (!preserveDrafts || currentKeys.has(item.key)))
        .map((item) => item.key)))
      return nextSuggestions
    })
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

  const refreshRecords = async (_selectedSource = sourceId) => {
    const everyRecord = await listRecords(undefined)
    setAllRecords(everyRecord)
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
        const selected = (preferredSourceId && rows.some((source) => source.id === preferredSourceId)
          ? preferredSourceId
          : sourceId) || rows[0]?.id || ''
        setSourceId(selected)
        return Promise.all([refreshRecords(selected), loadSuggestions(selected)])
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : '加载失败'))
  }, [refreshKey, preferredSourceId])

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
  const bundleCounts = useMemo(() => {
    const items = bundle?.suggestions ?? []
    return {
      pending: items.filter((item) => item.review_state !== 'confirmed' && item.review_state !== 'deferred' && !item.confirmed_record_id).length,
      confirmed: items.filter((item) => item.review_state === 'confirmed' || Boolean(item.confirmed_record_id)).length,
      ignored: items.filter((item) => item.review_state === 'deferred').length,
    }
  }, [bundle])
  const rootHouseCount = spaces.filter(
    (item) => item.kind === 'house' && item.parent_id === null,
  ).length

  const updateSuggestion = (key: string, field: string, value: unknown) => {
    setSuggestions((current) => current.map((item) => item.key === key
      ? { ...item, payload: { ...item.payload, [field]: value } }
      : item))
  }

  const updateCandidateRelations = (key: string, relatedKeys: string[]) => {
    const selected = new Set(relatedKeys)
    setSuggestions((current) => current.map((item) => {
      const existing = Array.isArray(item.payload.related_candidate_keys)
        ? item.payload.related_candidate_keys.map(String)
        : []
      if (item.key === key) {
        return { ...item, payload: { ...item.payload, related_candidate_keys: relatedKeys } }
      }
      const next = new Set(existing)
      if (selected.has(item.key)) next.add(key)
      else next.delete(key)
      return { ...item, payload: { ...item.payload, related_candidate_keys: [...next] } }
    }))
  }

  const switchSuggestionType = (key: string, newType: RecordType) => {
    setSuggestions((current) => current.map((item) => {
      if (item.key !== key) return item
      const base: Record<string, unknown> = {
        title: item.payload.title,
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

  const removeSuggestion = async (key: string) => {
    if (key.startsWith('manual:')) {
      setSuggestions((current) => current.filter((item) => item.key !== key))
      setSelectedKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
      return
    }
    if (!bundle) return
    try {
      // AI 候选的移除状态持久化，确认其他候选后不会再次出现。
      applyBundle(await deferCandidate(bundle.id, key, bundle.version), true, true)
      await refreshSourceRows(sourceId)
      onSourcesChanged?.()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '移除候选失败')
    }
  }

  const confirmSelected = async () => {
    const selected = suggestions.filter((item) => selectedKeys.has(item.key) && !item.confirmed_record_id)
    if (!selected.length) {
      setMessage('请先勾选至少一条尚未确认的建议。')
      return
    }
    const aiSelections = selected.filter((item) => !item.key.startsWith('manual:'))
    const manualSelections = selected.filter((item) => item.key.startsWith('manual:'))
    const ignoredAiKeys = suggestions
      .filter((item) => !item.key.startsWith('manual:') && !item.confirmed_record_id && !selectedKeys.has(item.key))
      .map((item) => item.key)
    if ((aiSelections.length || ignoredAiKeys.length) && !bundle) {
      setMessage('候选包尚未加载，请等待分析完成或只提交手工记录。')
      return
    }
    setConfirming(true)
    try {
      if (aiSelections.length || ignoredAiKeys.length) {
        const eligibleAiSuggestions = suggestions.filter((item) =>
          !item.key.startsWith('manual:')
          && (selectedKeys.has(item.key) || Boolean(item.confirmed_record_id)),
        )
        const eligibleAiKeys = new Set(eligibleAiSuggestions.map((item) => item.key))
        const relationPairs = new Map<string, { from_key: string; to_key: string }>()
        eligibleAiSuggestions.forEach((item) => {
          const relatedKeys = Array.isArray(item.payload.related_candidate_keys)
            ? item.payload.related_candidate_keys.map(String)
            : []
          relatedKeys.filter((key) => eligibleAiKeys.has(key) && key !== item.key).forEach((key) => {
            const [fromKey, toKey] = [item.key, key].sort()
            relationPairs.set(`${fromKey}\u0000${toKey}`, { from_key: fromKey, to_key: toKey })
          })
        })
        const result = await confirmCandidateBundle(
          bundle!.id,
          bundle!.version,
          aiSelections.map((item) => ({ key: item.key, payload: payloadForSave(item.record_type, item.payload) })),
          ignoredAiKeys,
          [...relationPairs.values()],
        )
        applyBundle(result.bundle, manualSelections.length > 0, true)
      }
      if (manualSelections.length) {
        await Promise.all(manualSelections.map((item) => {
          const payload = payloadForSave(item.record_type, item.payload)
          // 手工记录不经过后端 _fill_missing_required 兜底，标题为空时使用摘要或来源依据作为默认值。
          if (!payload.title) {
            payload.title = String(item.summary || item.evidence || '未命名手工记录').slice(0, 100)
          }
          return createRecord(payload)
        }))
        setSuggestions((current) => current.filter((item) => !item.key.startsWith('manual:')))
      }
      setMessage('所选建议已保存为正式记录。')
      await refreshRecords()
      await refreshSourceRows(sourceId)
      onSourcesChanged?.()
    } catch (error: unknown) {
      // 失败时不重置本地编辑，方便用户修正后重试。
      setMessage(error instanceof Error ? error.message : '确认失败，已保留当前编辑内容。')
    } finally {
      setConfirming(false)
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

  // 只有已勾选且尚未生成正式记录的候选，才属于当前可提交内容。
  const hasSelectedUnconfirmed = suggestions.some(
    (item) => selectedKeys.has(item.key) && !item.confirmed_record_id,
  )

  return (
    <section className="domain-workspace" aria-labelledby="domain-title">
      <div className="section-heading">
        <p className="eyebrow">阶段 3A · 人在回路</p>
        <h2 id="domain-title">让 AI 帮你拆分装修事实</h2>
      </div>

      <SourcePicker sources={sources} value={sourceId} onChange={(next) => {
        setSourceId(next)
        void Promise.all([refreshRecords(next), loadSuggestions(next)])
      }} />

      {selectedSource && <section className="source-maintenance" aria-label="原始数据管理">
        <div className="source-maintenance__summary">
          <span>来源版本 {selectedSource.revision} · 录入时间：{formatBeijingDateTime(selectedSource.captured_at)}</span>
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
              <p className="ai-panel__status">已分析 {bundle.suggestions.length} 条候选记录<span className="model-label">（模型：{bundle.engine}）</span></p>
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
              <Select value={engineMode} onChange={(event) => setEngineMode(event.target.value as 'auto' | 'ai' | 'local')}>
                <option value="auto">自动主备并本地兜底</option>
                <option value="ai">仅 AI（失败可见）</option>
                <option value="local">仅本地规则</option>
              </Select>
            </label>
          </div>
        </div>
        {analyzing && <p className="analysis-state" role="status">AI 正在分析…主备引擎共享 30 秒预算，失败后会提供本地规则建议。</p>}
        {bundle?.fallback_reason && <p className="fallback-notice">AI 暂不可用，本地规则已提供建议。原因：{bundle.fallback_reason}</p>}
        {bundle && <p className="candidate-summary" role="status">待处理 {bundleCounts.pending} 条 · 已生成 {bundleCounts.confirmed} 条 · 已忽略 {bundleCounts.ignored} 条</p>}
        {!analyzing && sourceId && bundle && bundleCounts.pending === 0 && bundleCounts.ignored > 0 && bundleCounts.confirmed === 0 && <p className="muted">候选均已忽略，可按需重新分析。</p>}
        {!analyzing && sourceId && (!bundle || bundle.suggestions.length === 0) && <p className="muted">暂未识别，原始文字已经保留。</p>}
        {suggestions.map((suggestion) => {
          const confirmed = Boolean(suggestion.confirmed_record_id)
          const payload = suggestion.payload
          const recordType = suggestion.record_type as RecordType
          const ledgerKind = String(payload.ledger_kind ?? 'payment')
          const cfg = typeFieldConfig[recordType]
          const highRisk = ['ledger', 'issue', 'decision'].includes(recordType)
          const title = String(payload.title ?? '')
          const status = String(payload.status ?? recordConfig[recordType].statuses[0])
          const occurredDate = String(payload.occurred_date ?? '')
          const spaceIds = Array.isArray(payload.space_ids) ? payload.space_ids : []
          const materialIds = Array.isArray(payload.material_ids) ? payload.material_ids : []
          const participantIds = Array.isArray(payload.participant_ids) ? payload.participant_ids : []
          const relatedRecordIds = Array.isArray(payload.related_record_ids) ? payload.related_record_ids : []
          const relatedCandidateKeys = Array.isArray(payload.related_candidate_keys) ? payload.related_candidate_keys : []
          const stageId = String(payload.stage_id ?? '')
          const vendorId = String(payload.vendor_id ?? '')
          const detailA = recordType === 'event' ? String(payload.event_kind ?? '')
            : recordType === 'ledger' ? String(payload.payment_kind ?? '')
            : recordType === 'issue' ? String(payload.phenomenon ?? '')
            : recordType === 'measurement' ? String(payload.object_name ?? '')
            : recordType === 'decision' ? String(payload.topic ?? '')
            : String(payload.question ?? '')
          const detailB = recordType === 'ledger' ? (payload.amount_minor ? String(Number(payload.amount_minor) / 100) : '')
            : recordType === 'measurement' ? String((normalizeMeasurementValues(payload.values)[0]?.value) ?? '')
            : recordType === 'decision' || recordType === 'research' ? (Array.isArray(payload.options) ? payload.options.join('，') : String(payload.options ?? ''))
            : recordType === 'event' ? String(payload.result ?? '')
            : String(payload.handling_plan ?? '')
          const detailC = recordType === 'measurement' ? String((normalizeMeasurementValues(payload.values)[1]?.value) ?? '')
            : recordType === 'decision' ? String(payload.selected_option ?? '')
            : ''
          const detailD = recordType === 'measurement' ? String((normalizeMeasurementValues(payload.values)[2]?.value) ?? '') : ''

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
              {!confirmed && <button className="suggestion-remove" type="button" onClick={() => void removeSuggestion(suggestion.key)}>移除</button>}
            </div>
            <p>原文依据：{suggestion.evidence}</p>
            <p>{confirmed ? '已确认并生成正式记录' : `可信程度：${suggestion.certainty_label}`}</p>
            {highRisk && !confirmed && <p className="risk-notice">请重点核对：此项涉及金额、施工问题或关键决策，AI 不会代替你确认。</p>}
            {!confirmed && <>
              <div className="suggestion-type-select">
                <label className="field-stack">
                  <span>记录类型</span>
                  <Select value={recordType} onChange={(event) => switchSuggestionType(suggestion.key, event.target.value as RecordType)}>
                    {Object.entries(recordConfig).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
                  </Select>
                </label>
              </div>
              <div className="record-form-grid">
                <label className="field-stack record-form-grid__wide"><span>标题</span><input value={title} placeholder={titlePlaceholder[recordType]} onChange={(event) => updateSuggestion(suggestion.key, 'title', event.target.value)} /></label>
                <label className="field-stack"><span>状态</span>
                  <Select value={status} onChange={(event) => updateSuggestion(suggestion.key, 'status', event.target.value)}>
                    {statusesForRecord(recordType, ledgerKind).map((item) => <option key={item} value={item}>{recordStatusLabel(recordType, item, ledgerKind)}</option>)}
                  </Select>
                </label>
                {recordType === 'measurement' && <label className="field-stack"><span>尺寸用途</span><Select value={normalizeMeasurementRole(payload.measurement_role)} onChange={(event) => updateSuggestion(suggestion.key, 'measurement_role', event.target.value)}>{Object.entries(measurementRoleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>}
                {recordType === 'ledger' && <label className="field-stack"><span>账目类型</span><Select value={ledgerKind} onChange={(event) => {
                  const kind = event.target.value
                  updateSuggestion(suggestion.key, 'ledger_kind', kind)
                  updateSuggestion(suggestion.key, 'status', completedStatusForLedgerKind(kind))
                  updateSuggestion(suggestion.key, 'direction', kind === 'refund' ? 'refund' : kind === 'income' ? 'income' : 'expense')
                }}><option value="payment">付款</option><option value="refund">退款</option><option value="income">收入</option></Select></label>}
                <label className="field-stack"><span>{cfg.detailALabel}</span><input value={detailA} placeholder={cfg.detailAPlaceholder} onChange={(event) => {
                  const value = event.target.value
                  if (recordType === 'event') updateSuggestion(suggestion.key, 'event_kind', value)
                  else if (recordType === 'ledger') updateSuggestion(suggestion.key, 'payment_kind', value)
                  else if (recordType === 'issue') updateSuggestion(suggestion.key, 'phenomenon', value)
                  else if (recordType === 'measurement') updateSuggestion(suggestion.key, 'object_name', value)
                  else if (recordType === 'decision') updateSuggestion(suggestion.key, 'topic', value)
                  else if (recordType === 'research') updateSuggestion(suggestion.key, 'question', value)
                }}                 /></label>
                {recordType === 'measurement'
                  ? <fieldset className="measurement-triplet record-form-grid__wide"><legend>尺寸（mm，未知可不填）</legend>{[['宽度', detailB], ['高度', detailC], ['长度', detailD]].map(([label, current], index) => <label key={label}><span>{label}</span><input type="number" min="0" step="any" value={current} onChange={(event) => { const values = normalizeMeasurementValues(payload.values); values[index] = { ...(values[index] ?? {}), axis: ['width', 'height', 'length'][index], value: event.target.value.trim() ? Number(event.target.value) : null, unit: 'mm' }; updateSuggestion(suggestion.key, 'values', values) }} /></label>)}</fieldset>
                  : recordType === 'decision' || recordType === 'research'
                  ? <OptionsTextInput label={cfg.detailBLabel} placeholder={cfg.detailBPlaceholder} value={payload.options} onCommit={(options) => updateSuggestion(suggestion.key, 'options', options)} />
                  : <label className="field-stack"><span>{cfg.detailBLabel}</span><input
                    type={cfg.detailBType || 'text'}
                    min={cfg.detailBType === 'number' ? '0' : undefined}
                    step="any"
                    value={detailB}
                    placeholder={cfg.detailBPlaceholder}
                    onChange={(event) => {
                      const value = event.target.value
                      if (recordType === 'ledger') updateSuggestion(suggestion.key, 'amount_minor', value.trim() ? Math.round(Number(value) * 100) : null)
                      else if (recordType === 'event') updateSuggestion(suggestion.key, 'result', value)
                      else if (recordType === 'issue') updateSuggestion(suggestion.key, 'handling_plan', value)
                    }}
                  /></label>}
                {recordType !== 'measurement' && cfg.detailCLabel && <label className="field-stack"><span>{cfg.detailCLabel}</span>
                  <input
                    type={cfg.detailCType || 'text'}
                    min={cfg.detailCType === 'number' ? '0' : undefined}
                    step="any"
                    value={detailC}
                    placeholder={cfg.detailCPlaceholder}
                    onChange={(event) => {
                      const value = event.target.value
                      if (recordType === 'decision') updateSuggestion(suggestion.key, 'selected_option', value)
                    }}
                  />
                </label>}
                <MultiSelectField label="空间" selectedIds={spaceIds.map(String)} options={spaces} onChange={(ids) => updateSuggestion(suggestion.key, 'space_ids', ids)} />
                <MultiSelectField label="材料" selectedIds={materialIds.map(String)} options={entities.materials} onChange={(ids) => updateSuggestion(suggestion.key, 'material_ids', ids)} />
                <MultiSelectField label={recordType === 'issue' ? '处理人' : '参与者'} selectedIds={participantIds.map(String)} options={entities.participants} onChange={(ids) => updateSuggestion(suggestion.key, 'participant_ids', ids)} />
                <MultiSelectField label="关联记录（可选）" selectedIds={relatedRecordIds.map(String)} options={allRecords.map(recordSelectOption)} onChange={(ids) => updateSuggestion(suggestion.key, 'related_record_ids', ids)} />
                {!suggestion.key.startsWith('manual:') && <MultiSelectField label="关联本批候选（可选）" selectedIds={relatedCandidateKeys.map(String)} options={suggestions.filter((item) => item.key !== suggestion.key && !item.key.startsWith('manual:') && !item.confirmed_record_id).map((item) => ({ id: item.key, name: `${item.type_label} · ${String(item.payload.title || item.summary)}` }))} onChange={(ids) => updateCandidateRelations(suggestion.key, ids)} />}
                <label className="field-stack"><span>装修阶段</span>
                  <Select value={stageId} onChange={(event) => updateSuggestion(suggestion.key, 'stage_id', event.target.value || null)}>
                    <option value="">未指定</option>
                    {entities.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </label>
                {cfg.showVendor && <label className="field-stack"><span>{recordType === 'ledger' ? '交易对象（商家）' : '商家'}</span>
                  <Select required={recordType === 'ledger'} value={vendorId} onChange={(event) => updateSuggestion(suggestion.key, 'vendor_id', event.target.value || null)}>
                    <option value="">请选择</option>
                    {entities.vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </label>}
                <label className="field-stack"><span>发生日期</span>
                  <input type="date" value={occurredDate} onChange={(event) => updateSuggestion(suggestion.key, 'occurred_date', event.target.value || null)} />
                </label>
                {recordType === 'issue' && <>
                  <label className="field-stack"><span>严重程度</span><Select required value={String(payload.severity ?? '')} onChange={(event) => updateSuggestion(suggestion.key, 'severity', event.target.value || null)}><option value="">请选择</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></Select></label>
                  {status === 'done' && <><label className="field-stack"><span>实际完成日期</span><input type="date" value={toDateInput(payload.completed_at)} onChange={(event) => updateSuggestion(suggestion.key, 'completed_at', event.target.value || null)} /></label><label className="field-stack record-form-grid__wide"><span>实际处理结果</span><textarea required rows={2} value={String(payload.actual_result ?? '')} onChange={(event) => updateSuggestion(suggestion.key, 'actual_result', event.target.value || null)} /></label></>}
                </>}
              </div>
            </>}
          </article>
        })}
        {suggestions.length > 0 && <div className="suggestion-actions">
          <button className="source-save" type="button" disabled={confirming || !hasSelectedUnconfirmed} onClick={() => void confirmSelected()}>{confirming ? '正在确认…' : '确认所选'}</button>
          <button className="add-manual-suggestion" type="button" onClick={addManualSuggestion}>+ 添加手工记录</button>
        </div>}
        {suggestions.length === 0 && !analyzing && sourceId && <div className="suggestion-actions">
          <button className="add-manual-suggestion" type="button" onClick={addManualSuggestion}>+ 添加手工记录</button>
        </div>}
      </div>

      {message && <p className="workspace-message" role="status">{message}</p>}

      <details className="manage-panel">
        <summary>空间与共享档案</summary>
        <p className="panel-guide">空间用于标记事情发生的位置；共享档案可在多条记录中重复使用。只能删除尚未被正式记录使用的项目。</p>
        <div className="manage-grid">
          <section>
            <h3>新增空间</h3>
            <label className="field-stack"><span>空间名称</span><input value={spaceName} onChange={(event) => setSpaceName(event.target.value)} placeholder="例如：主卧、淋浴区或门洞" /></label>
            <label className="field-stack"><span>空间类型</span><Select value={spaceKind} onChange={(event) => setSpaceKind(event.target.value)}>{Object.entries(spaceKindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
            <label className="field-stack"><span>上级空间</span><Select value={spaceParent} disabled={spaceKind === 'house'} onChange={(event) => setSpaceParent(event.target.value)}><option value="" disabled={spaceKind !== 'house'}>{spaceKind === 'house' ? '房屋是根空间，无需上级' : '请选择上级空间'}</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><small>系统会自动提供“整套房屋”。用于建立“房屋 → 房间 → 局部构件/表面”层级，例如“主卧”的上级就是“整套房屋”。</small></label>
            <button type="button" onClick={() => void addSpace()}>新增空间</button>
            <div className="manage-list" aria-label="已有空间">
              <h4>已有空间</h4>
              {spaces.length === 0 && <p className="muted">还没有空间。</p>}
              {spaces.map((item) => { const isOnlyRoot = item.kind === 'house' && item.parent_id === null && rootHouseCount === 1; return <div className="manage-list__item" key={item.id}><span><strong>{item.name}</strong><small>{spaceKindLabels[item.kind] || '其他空间'}{isOnlyRoot ? ' · 系统根空间' : item.parent_id ? ` · 上级：${spaces.find((space) => space.id === item.parent_id)?.name || '未知'}` : ' · 无上级'}</small></span>{isOnlyRoot ? <small className="protected-item">系统根空间不可删除</small> : <button type="button" onClick={() => void deleteSpaceItem(item)}>删除</button>}</div> })}
            </div>
          </section>
          <section>
            <h3>新增共享档案</h3>
            <label className="field-stack"><span>档案类型</span><Select value={manageType} onChange={(event) => { setManageType(event.target.value as EntityType); setManageBrand('') }}>{Object.entries(entityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
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

    </section>
  )
}
