import { Select } from './Select'

export const measurementAxisLabels: Record<string, string> = {
  width: '宽度', height: '高度', length: '长度', depth: '深度', diameter: '直径',
}

const templates: Record<string, string[]> = {
  门洞: ['净宽', '净高', '墙厚'],
  窗户: ['宽度', '高度', '窗台离地'],
  '柜体／电器': ['宽度', '高度', '深度'],
  点位: ['离地高度', '距左墙', '距右墙'],
}

function measurementTimeInput(value: unknown): string {
  if (!value) return ''
  const raw = String(value)
  // 后端可能返回 UTC 时间；输入框始终显示北京时间，不能直接截断偏移。
  const date = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}+08:00`)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`
}

export function MeasurementFields({ payload, onChange }: {
  payload: Record<string, unknown>
  onChange: (field: string, value: unknown) => void
}) {
  const values = Array.isArray(payload.values) ? payload.values as Array<Record<string, unknown>> : []
  const setValue = (index: number, field: string, value: unknown) => {
    // 编辑时保留输入单位和全部尺寸项，只在提交边界换算毫米。
    onChange('values', values.map((item, position) => position === index ? { ...item, [field]: value } : item))
  }
  const setUnit = (index: number, unit: string) => {
    const scale: Record<string, number> = { mm: 1, cm: 10, m: 1000 }
    const item = values[index]
    const previousScale = scale[String(item.unit ?? 'mm')]
    const numeric = Number(item.value)
    // 对已填写数值切换显示单位时保持实际尺寸；空值仍等用户填写。
    const value = item.value !== null && item.value !== '' && item.value !== undefined && Number.isFinite(numeric) && previousScale
      ? Number((numeric * previousScale / scale[unit]).toPrecision(15)) : item.value
    onChange('values', values.map((entry, position) => position === index ? { ...entry, unit, value } : entry))
  }
  const addTemplate = (name: string) => {
    const populated = values.filter(item => (item.value !== null && item.value !== '' && item.value !== undefined) || String(item.axis ?? '').trim())
    onChange('values', [...populated, ...templates[name].map(axis => ({ axis, value: null, unit: 'mm' }))])
  }
  return <>
    <fieldset className="measurement-fields record-form-grid__wide">
      <legend>尺寸项</legend>
      <p className="measurement-fields__hint">名称写清测量位置，例如“上部净宽”或“窗台离地”。未知数值可留空，切换单位自动换算。</p>
      <div className="measurement-fields__templates"><span>添加常用项</span>{Object.keys(templates).map(name => <button type="button" key={name} onClick={() => addTemplate(name)}>{name}</button>)}</div>
      {values.map((item, index) => <div className="measurement-fields__row" key={index}>
        <label className="field-stack"><span>尺寸名称</span><input aria-label={`尺寸名称 ${index + 1}`} maxLength={50} value={measurementAxisLabels[String(item.axis ?? '')] ?? String(item.axis ?? '')} placeholder="例如：墙厚" onChange={event => setValue(index, 'axis', event.target.value || null)} /></label>
        <label className="field-stack"><span>数值</span><input aria-label={`尺寸数值 ${index + 1}`} type="number" min="0" step="any" value={String(item.value ?? '')} onChange={event => setValue(index, 'value', event.target.value || null)} /></label>
        <label className="field-stack"><span>单位</span><Select aria-label={`尺寸单位 ${index + 1}`} value={String(item.unit ?? 'mm')} onChange={event => setUnit(index, event.target.value)}><option value="mm">毫米</option><option value="cm">厘米</option><option value="m">米</option>{!['mm', 'cm', 'm'].includes(String(item.unit ?? 'mm')) && <option value={String(item.unit)}>{String(item.unit)}（请确认）</option>}</Select></label>
        <button type="button" className="measurement-fields__remove" aria-label={`移除尺寸项 ${index + 1}`} onClick={() => onChange('values', values.filter((_, position) => position !== index))}>移除</button>
      </div>)}
      <button type="button" onClick={() => onChange('values', [...values, { axis: null, value: null, unit: 'mm' }])}>添加尺寸项</button>
    </fieldset>
    <label className="field-stack"><span>数值精度</span><Select value={payload.approximate ? 'approximate' : 'exact'} onChange={event => onChange('approximate', event.target.value === 'approximate')}><option value="exact">未标注近似</option><option value="approximate">约数／粗测</option></Select></label>
    <details className="measurement-context record-form-grid__wide"><summary>测量时间、方法与口径</summary><div className="record-form-grid">
      <label className="field-stack"><span>测量时间（北京时间）</span><input type="datetime-local" value={measurementTimeInput(payload.measured_at)} onChange={event => onChange('measured_at', event.target.value ? `${event.target.value}:00+08:00` : null)} /></label>
      <label className="field-stack"><span>测量方法</span><input value={String(payload.method ?? '')} placeholder="例如：卷尺，完成面之间" onChange={event => onChange('method', event.target.value || null)} /></label>
      <label className="field-stack record-form-grid__wide"><span>误差与测量口径</span><textarea rows={2} value={String(payload.tolerance_text ?? '')} placeholder="例如：未含门框；约有 2 mm 误差" onChange={event => onChange('tolerance_text', event.target.value || null)} /></label>
    </div></details>
  </>
}
