import { useEffect, useState } from 'react'
import { HttpError } from './http'
import { listEntities, listRecords, listSpaces, type ProjectionRecord } from './domainApi'
import { listTopics } from './topicsApi'
import { recordStatusLabel } from './recordLabels'
import './RecordConflict.css'

export function conflictRecord(error: unknown): ProjectionRecord | null {
  if (!(error instanceof HttpError) || error.code !== 'record_version_conflict') return null
  const detail = error.detail as { latest_record?: ProjectionRecord } | undefined
  return detail?.latest_record ?? null
}

const labels: Record<string, string> = {
  title: '标题', description: '补充说明', status: '状态', occurred_date: '发生日期', due_date: '截止日期',
  phenomenon: '事项内容', handling_plan: '处理计划', actual_result: '处理结果', completed_at: '完成日期',
  severity: '严重程度', topic_ids: '主题归属', space_ids: '空间', material_ids: '材料', participant_ids: '参与者',
  related_record_ids: '关联记录', stage_id: '装修阶段', payment_kind: '款项性质', vendor_id: '交易对象',
  amount_minor: '金额（分）', currency: '币种', ledger_kind: '账目类型', direction: '收支方向',
  payment_date: '付款日期', payment_method: '付款方式', event_kind: '事件类别', result: '结果',
  object_name: '测量对象', values: '尺寸项', measurement_role: '尺寸用途', measured_at: '测量时间',
  approximate: '近似值', tolerance_text: '误差说明', method: '测量方法', topic: '决策事项',
  question: '调研问题', options: '备选方案', selected_option: '当前选择', limitations: '待确认事项',
  responsible_party: '处理人说明', resolution_kind: '处理方式', started_at: '开始时间', ended_at: '结束时间', process: '过程',
}
const display = (value: unknown) => value === null || value === undefined || value === '' ? '未填写' : Array.isArray(value) && !value.length ? '未选择' : typeof value === 'object' ? JSON.stringify(value) : String(value)

export function RecordConflict({ latest, draft, onResolve, onCancel }: {
  latest: ProjectionRecord; draft: Record<string, unknown>
  onResolve: (payload: Record<string, unknown>, version: number) => void; onCancel: () => void
}) {
  const [choices, setChoices] = useState<Record<string, 'local' | 'latest'>>({})
  const [names, setNames] = useState<Record<string, Record<string, string>>>({})
  const [namesError, setNamesError] = useState(false)
  const [retry, setRetry] = useState(0)
  const keys = Object.keys(draft).filter(key => !['record_type', 'expected_version', 'source_refs', 'timezone', 'original_time_text'].includes(key)
    && JSON.stringify(draft[key] ?? null) !== JSON.stringify(latest[key] ?? null))
  const referenceKeys = keys.filter(key => /_ids$|^(vendor_id|stage_id)$/.test(key)).join(',')
  useEffect(() => {
    let active = true
    setNamesError(false)
    const loaders: Record<string, () => Promise<Array<{id:string; name:string}>>> = {
      topic_ids: async () => (await listTopics()).items,
      space_ids: listSpaces, material_ids: () => listEntities('materials'),
      participant_ids: () => listEntities('participants'), vendor_id: () => listEntities('vendors'),
      stage_id: () => listEntities('stages'), related_record_ids: async () => (await listRecords()).map(row => ({id:row.id,name:row.title})),
    }
    void Promise.allSettled(referenceKeys.split(',').filter(key => loaders[key]).map(async key => {
      const rows = await loaders[key]()
      if (active) setNames(previous => ({...previous, [key]:Object.fromEntries(rows.map(row => [row.id,row.name]))}))
    })).then(results => { if (active) setNamesError(results.some(result => result.status === 'rejected')) })
    return () => { active = false }
  }, [referenceKeys, retry])
  const valueText = (key: string, value: unknown): string => {
    if (referenceKeys.split(',').includes(key)) {
      const ids = Array.isArray(value) ? value.map(String) : value ? [String(value)] : []
      return ids.length ? ids.map(id => names[key]?.[id] ?? '名称暂不可读').join('、') : '未选择'
    }
    if (key === 'status') return recordStatusLabel(latest.record_type, String(value ?? ''), latest.ledger_kind)
    if (key === 'severity') return ({low:'低',medium:'中',high:'高'} as Record<string,string>)[String(value)] ?? display(value)
    return display(value)
  }
  const ready = keys.every(key => choices[key])
  return <section className="record-conflict" aria-label="处理编辑冲突">
    <h3>记录已在其他页面更新</h3><p role="alert">你的草稿已保留。请逐项选择，再继续编辑；保存时仍会检查是否有新的修改。</p>
    {keys.map(key => <fieldset key={key}><legend>{labels[key] ?? '其他补充字段'}</legend>
      <label><input type="radio" name={`conflict-${key}`} checked={choices[key] === 'local'} onChange={() => setChoices(previous => ({ ...previous, [key]: 'local' }))} /><span>保留我的修改：{valueText(key, draft[key])}</span></label>
      <label><input type="radio" name={`conflict-${key}`} checked={choices[key] === 'latest'} onChange={() => setChoices(previous => ({ ...previous, [key]: 'latest' }))} /><span>采用最新内容：{valueText(key, latest[key])}</span></label>
    </fieldset>)}
    {!keys.length && <p>字段内容相同，记录的关联或过程已更新。</p>}
    {namesError && <p role="alert">部分选项名称读取失败。<button type="button" onClick={() => setRetry(value => value + 1)}>重试读取名称</button></p>}
    <div className="record-actions"><button type="button" disabled={!ready} onClick={() => {
      // 明确选择后才更新草稿与基准版本，不在冲突发生时自动合并或写入。
      const payload = { ...draft }
      for (const key of keys) if (choices[key] === 'latest') payload[key] = latest[key] ?? null
      onResolve(payload, Number(latest.version))
    }}>应用选择并继续编辑</button><button type="button" onClick={onCancel}>返回我的草稿</button></div>
  </section>
}
