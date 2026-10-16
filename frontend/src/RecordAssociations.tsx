import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { listEntities, listRecords, listSpaces, type DomainRecord } from './domainApi'
import { Select } from './Select'
import { DropdownChevron } from './DropdownChevron'
import { useDropdown } from './useDropdown'
import { useDropdownPosition } from './useDropdownPosition'
import { recordTypeLabels } from './recordLabels'
import { formatBeijingDate } from './time'
import './RecordAssociations.css'

export interface AssociationOption { id: string; name: string; trailingText?: string }
export interface AssociationEntities {
  spaces: AssociationOption[]; materials: AssociationOption[]; participants: AssociationOption[]; stages: AssociationOption[]
}
export const associationIds = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
const emptyEntities = (): AssociationEntities => ({ spaces: [], materials: [], participants: [], stages: [] })

export function useAssociationOptions(enabled = true) {
  const [entities, setEntities] = useState<AssociationEntities>(emptyEntities)
  const [records, setRecords] = useState<DomainRecord[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    if (!enabled) return
    let active = true
    setLoading(true); setError('')
    // 统一读取背景选项和项目记录；失败时保留上次选项与用户选择。
    Promise.all([listSpaces(), listEntities('materials'), listEntities('participants'), listEntities('stages'), listRecords()])
      .then(([spaces, materials, participants, stages, rows]) => {
        if (!active) return
        setEntities({ spaces: spaces ?? [], materials: materials ?? [], participants: participants ?? [], stages: stages ?? [] })
        setRecords(rows ?? [])
      }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '信息与关联读取失败，请重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [enabled, attempt])
  return { entities, records, loading, error, retry }
}

export function AssociationMultiSelect({ label, selectedIds, options, onChange, disabled = false, searchable = false }: {
  label: string; selectedIds: string[]; options: AssociationOption[]; onChange: (ids: string[]) => void; disabled?: boolean; searchable?: boolean
}) {
  const rootRef = useRef<HTMLFieldSetElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const { id, open, toggleMenu } = useDropdown({ rootRef, triggerRef, menuRef, disabled })
  const style = useDropdownPosition(triggerRef, open, 320)
  useEffect(() => { if (open && searchable) searchRef.current?.focus({ preventScroll: true }); if (!open) setQuery('') }, [open, searchable])
  const selected = options.filter(item => selectedIds.includes(item.id))
  const summary = selectedIds.length === 0 ? '请选择（可多选）' : selected.length === selectedIds.length && selected.length <= 2 ? selected.map(item => item.name).join('、') : `已选择 ${selectedIds.length} 项`
  const filtered = options.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <fieldset ref={rootRef} className="multi-select-field" disabled={disabled}><legend>{label}</legend><div className="multi-select-control">
    <button ref={triggerRef} type="button" disabled={disabled} className="multi-select-summary" aria-label={`${label}：${summary}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined} onPointerDown={event => event.preventDefault()} onClick={toggleMenu}><span>{summary}</span><DropdownChevron open={open} /></button>
    {open && createPortal(<div ref={menuRef} id={`${id}-options`} role="listbox" aria-label={label} aria-multiselectable="true" className="multi-select-options dropdown-portal association-options" style={style}>
      {searchable && <input ref={searchRef} type="search" aria-label={`搜索${label}`} placeholder="搜索类型或标题" value={query} onChange={event => setQuery(event.target.value)} />}
      <div>{filtered.length ? filtered.map(item => <label key={item.id} role="option" aria-selected={selectedIds.includes(item.id)}><input type="checkbox" aria-label={item.name} checked={selectedIds.includes(item.id)} disabled={disabled} onChange={() => onChange(selectedIds.includes(item.id) ? selectedIds.filter(value => value !== item.id) : [...selectedIds, item.id])} /><span className="multi-select-option__name">{item.name}</span>{item.trailingText && <span className="multi-select-option__meta">{item.trailingText}</span>}</label>) : <span>{query ? '没有匹配的记录' : '暂无可选项'}</span>}</div>
    </div>, document.body)}
  </div></fieldset>
}

export function associationRecordOptions(records: DomainRecord[], topicIds: string[], currentRecordId?: string): AssociationOption[] {
  const seen = new Set<string>()
  const valid = records.filter(record => {
    if (record.id === currentRecordId || seen.has(record.id)) return false
    seen.add(record.id); return true
  })
  const shared = (record: DomainRecord) => associationIds(record.topic_ids).some(id => topicIds.includes(id))
  // 只调整候选顺序，不改变主题归属或已经选择的直接关联。
  return [...valid.filter(shared), ...valid.filter(record => !shared(record))].map(record => ({ id: record.id, name: `${recordTypeLabels[record.record_type] ?? '记录'} · ${record.title}`, trailingText: [shared(record) ? '同主题' : '', formatBeijingDate(record.created_at)].filter(Boolean).join(' · ') }))
}

export function RecordAssociations({ payload, onChange, entities, records, currentRecordId, participantLabel = '相关人员', hideParticipants = false, children, disabled = false, error, loading = false, optionsError, onRetry, inline = false }: {
  payload: Record<string, unknown>; onChange: (key: string, value: unknown) => void; entities: AssociationEntities; records: DomainRecord[]; currentRecordId?: string; participantLabel?: string; hideParticipants?: boolean; children?: ReactNode; disabled?: boolean; error?: string; loading?: boolean; optionsError?: string; onRetry?: () => void; inline?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const regionId = useId()
  const regionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fields = [
      ['space_ids|空间', '空间'], ['material_ids|材料', '材料'],
      ['participant_ids|相关人员|处理人|参与者', participantLabel], ['stage_id|装修阶段', '装修阶段'],
      ['related_record_ids|关联记录', '关联记录（可选）'], ['related_candidate_keys|本批候选', '关联本批候选'],
    ]
    const field = error && fields.find(([pattern]) => new RegExp(pattern).test(error))
    if (!field) return
    setExpanded(true)
    const frame = requestAnimationFrame(() => {
      const controls = regionRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')
      const target = Array.from(controls ?? []).find(control => control.getAttribute('aria-label')?.startsWith(field[1]))
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [error, participantLabel])
  const summary = [
    ['空间', associationIds(payload.space_ids).length], ['材料', associationIds(payload.material_ids).length],
    ['人员', associationIds(payload.participant_ids).length], ['记录关联', associationIds(payload.related_record_ids).length],
    ['本批关联', associationIds(payload.related_candidate_keys).length],
  ].filter(([, count]) => Number(count) > 0).map(([name, count]) => `${count} 个${name}`)
  if (payload.stage_id) summary.push('已选装修阶段')
  const options = associationRecordOptions(records, associationIds(payload.topic_ids), currentRecordId)
  return <section className="record-associations">
    {!inline && <button type="button" className="record-associations__toggle" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded(value => !value)}><span>更多信息与关联</span><span className="record-associations__summary">{summary.join('、')}</span><DropdownChevron open={expanded} /></button>}
    <div id={regionId} ref={regionRef} hidden={!inline && !expanded} className="record-associations__body">
      {loading && <p role="status">正在读取信息与关联…</p>}
      {optionsError && <div role="alert">{optionsError} {onRetry && <button type="button" onClick={onRetry}>重试</button>}</div>}
      <h4>补充信息</h4><div className="record-associations__fields">
        <AssociationMultiSelect label="空间" selectedIds={associationIds(payload.space_ids)} options={entities.spaces} onChange={ids => onChange('space_ids', ids)} disabled={disabled || loading || !!optionsError} />
        <AssociationMultiSelect label="材料" selectedIds={associationIds(payload.material_ids)} options={entities.materials} onChange={ids => onChange('material_ids', ids)} disabled={disabled || loading || !!optionsError} />
        {!hideParticipants && <AssociationMultiSelect label={participantLabel} selectedIds={associationIds(payload.participant_ids)} options={entities.participants} onChange={ids => onChange('participant_ids', ids)} disabled={disabled || loading || !!optionsError} />}
        <label><span>装修阶段</span><Select aria-label="装修阶段" value={typeof payload.stage_id === 'string' ? payload.stage_id : ''} onChange={event => onChange('stage_id', event.target.value || null)} disabled={disabled || loading || !!optionsError}><option value="">未选择</option>{entities.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}{typeof payload.stage_id === 'string' && payload.stage_id && !entities.stages.some(stage => stage.id === payload.stage_id) && <option value={payload.stage_id}>已选阶段（选项待读取）</option>}</Select></label>
      </div>
      <h4>关联具体记录</h4>
      <AssociationMultiSelect label="关联记录（可选）" selectedIds={associationIds(payload.related_record_ids)} options={options} onChange={ids => onChange('related_record_ids', ids)} disabled={disabled || loading || !!optionsError} searchable />
      {children}
    </div>
  </section>
}
