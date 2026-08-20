import { useEffect, useState, type FormEvent } from 'react'

import pitfallRegretDiorama from './assets/pitfall-regret-diorama.webp'
import {
  analyzePitfalls,
  createPitfall,
  createPitfallResolution,
  deletePitfall,
  deletePitfallResolution,
  listPitfalls,
  updatePitfall,
  updatePitfallResolution,
  type PitfallAIAnalysis,
  type PitfallEntry,
  type PitfallResolution,
} from './domainApi'
import { beijingToday, formatCalendarDate } from './time'

type Filter = 'all' | 'unresolved' | 'resolved'

function PitfallRegretTheme() {
  return <div className="pitfall-capture__theme">
    <img src={pitfallRegretDiorama} alt="" aria-hidden="true" />
    <h3 id="pitfall-capture-title" aria-label="如果在装修之前就知道这些">
      {'如果在装修之前就知道这些'.split('').map((character, index) => <span aria-hidden="true" key={`${character}-${index}`}>{character}</span>)}
    </h3>
  </div>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}

function PitfallForm({ item, onSaved, onCancel }: {
  item?: PitfallEntry
  onSaved: () => void
  onCancel?: () => void
}) {
  const [occurredDate, setOccurredDate] = useState(item?.occurred_date ?? beijingToday())
  const [description, setDescription] = useState(item?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!description.trim()) {
      setError('请填写踩坑经过。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = { occurred_date: occurredDate, description: description.trim() }
      if (item) await updatePitfall(item.id, payload)
      else await createPitfall(payload)
      if (!item) setDescription('')
      onSaved()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setSaving(false)
    }
  }

  return <form className={`pitfall-form${item ? ' pitfall-form--edit' : ''}`} onSubmit={submit}>
    <div className="pitfall-form__meta">
      <label><span>发生日期</span><input type="date" value={occurredDate} required onChange={(event) => setOccurredDate(event.target.value)} /></label>
    </div>
    <label className="pitfall-form__content"><span>踩坑经过</span><textarea value={description} maxLength={10000} rows={item ? 4 : 3} placeholder="发生了什么？先记下事实，之后可继续追加处理过程。" onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="pitfall-form__actions">
      {error && <p className="error-text" role="alert">{error}</p>}
      {onCancel && <button type="button" className="secondary-button" onClick={onCancel}>取消</button>}
      <button type="submit" disabled={saving}>{saving ? '保存中…' : item ? '保存修改' : '记下这次踩坑'}</button>
    </div>
  </form>
}

function ResolutionForm({ pitfallId, item, onSaved, onCancel }: {
  pitfallId: string
  item?: PitfallResolution
  onSaved: () => void
  onCancel: () => void
}) {
  const [resolvedDate, setResolvedDate] = useState(item?.resolved_date ?? beijingToday())
  const [content, setContent] = useState(item?.content ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!content.trim()) {
      setError('请填写处理内容。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = { resolved_date: resolvedDate, content: content.trim() }
      if (item) await updatePitfallResolution(item.id, payload)
      else await createPitfallResolution(pitfallId, payload)
      onSaved()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setSaving(false)
    }
  }
  return <form className="resolution-form" onSubmit={submit}>
    <label><span>处理日期</span><input type="date" value={resolvedDate} required onChange={(event) => setResolvedDate(event.target.value)} /></label>
    <label className="resolution-form__content"><span>处理内容</span><textarea rows={3} maxLength={10000} value={content} placeholder="这次做了什么、结果怎样？" onChange={(event) => setContent(event.target.value)} /></label>
    <div className="resolution-form__actions"><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button type="submit" disabled={saving}>{saving ? '保存中…' : item ? '保存修改' : '追加处理记录'}</button></div>
    {error && <p className="error-text" role="alert">{error}</p>}
  </form>
}

function AnalysisList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return <section><h4>{title}</h4>{items.length > 0 ? <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="muted">{empty}</p>}</section>
}

export function PitfallsView() {
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<PitfallEntry[]>([])
  const [summary, setSummary] = useState({ total: 0, unresolved: 0, resolved: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editingId, setEditingId] = useState('')
  const [addingToId, setAddingToId] = useState('')
  const [editingResolutionId, setEditingResolutionId] = useState('')
  const [analysis, setAnalysis] = useState<PitfallAIAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    listPitfalls(filter).then((data) => {
      if (!active) return
      setItems(data.items)
      setSummary(data.summary)
    }).catch((error: unknown) => {
      if (active) setLoadError(messageOf(error))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [filter, revision])

  const refresh = () => {
    setEditingId('')
    setAddingToId('')
    setEditingResolutionId('')
    setAnalysis(null)
    setRevision((value) => value + 1)
  }

  const removePitfall = async (item: PitfallEntry) => {
    if (!window.confirm(`确认永久删除这条踩坑记录吗？\n\n其 ${item.resolutions.length} 条处理记录也会一并删除，此操作无法恢复。`)) return
    try {
      await deletePitfall(item.id)
      refresh()
    } catch (error) {
      setLoadError(messageOf(error))
    }
  }

  const removeResolution = async (item: PitfallResolution) => {
    if (!window.confirm('确认永久删除这条处理记录吗？此操作无法恢复。')) return
    try {
      await deletePitfallResolution(item.id)
      refresh()
    } catch (error) {
      setLoadError(messageOf(error))
    }
  }

  const runAnalysis = async () => {
    setAnalyzing(true)
    setAnalysisError('')
    setAnalysis(null)
    try {
      setAnalysis(await analyzePitfalls())
    } catch (error) {
      setAnalysisError(messageOf(error))
    } finally {
      setAnalyzing(false)
    }
  }

  return <section className="view-panel pitfalls-page">
    <header className="pitfalls-page__header"><div><p className="eyebrow">独立手工日志</p><h2>踩坑记录</h2></div><button type="button" className="secondary-button" disabled={analyzing || summary.total === 0} onClick={runAnalysis}>{analyzing ? 'AI 分析中…' : '一键分析全部'}</button></header>

    <section className="pitfall-capture" aria-labelledby="pitfall-capture-title"><PitfallRegretTheme /><PitfallForm onSaved={refresh} /></section>

    <div className="pitfall-toolbar">
      <div className="pitfall-summary" aria-label="踩坑记录摘要"><span><strong>{summary.total}</strong> 全部</span><span><strong>{summary.unresolved}</strong> 未处理</span><span><strong>{summary.resolved}</strong> 已处理</span></div>
      <div className="segmented-control" aria-label="筛选踩坑记录">{(['all', 'unresolved', 'resolved'] as Filter[]).map((value) => <button key={value} type="button" className={filter === value ? 'is-active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? '全部' : value === 'unresolved' ? '未处理' : '已处理'}</button>)}</div>
    </div>

    {analysisError && <div className="analysis-message analysis-message--error" role="alert"><strong>分析未完成</strong><p>{analysisError}</p><button type="button" className="secondary-button" onClick={runAnalysis}>重试</button></div>}
    {analyzing && <div className="analysis-message" role="status"><strong>正在回顾全部踩坑与处理过程…</strong><p>分析只读取当前数据，不会修改任何原始记录。</p></div>}
    {analysis && <article className="pitfall-analysis"><header><div><span className="record-type-tag">AI 复盘</span><h3>全部踩坑分析</h3></div><small>{analysis.provider} · {analysis.model}</small></header><p className="pitfall-analysis__summary">{analysis.summary}</p><div className="pitfall-analysis__grid"><AnalysisList title="重复出现的问题" items={analysis.recurring_patterns} empty="未发现明确的重复模式。" /><AnalysisList title="采取过的处理方式" items={analysis.approaches} empty="暂无可归纳的处理方式。" /><AnalysisList title="尚未处理" items={analysis.unresolved_items} empty="没有识别到未处理事项。" /><AnalysisList title="后续避免建议" items={analysis.prevention_advice} empty="暂无额外建议。" /></div><p className="muted">AI 内容仅供复盘参考，不会回写或覆盖原始记录。</p></article>}

    {loadError && <div className="empty-state" role="alert"><h3>加载失败</h3><p>{loadError}</p><button type="button" onClick={() => setRevision((value) => value + 1)}>重新加载</button></div>}
    {loading && <div className="empty-state" role="status"><h3>正在整理时间记录…</h3><p>稍等片刻。</p></div>}
    {!loading && !loadError && items.length === 0 && <div className="empty-state"><h3>{summary.total === 0 ? '还没有踩坑记录' : '当前筛选下没有记录'}</h3><p>{summary.total === 0 ? '从上方快速记下第一条，之后可以持续追加处理过程。' : '切换筛选条件即可查看其他记录。'}</p></div>}

    {!loading && !loadError && items.length > 0 && <div className="pitfall-timeline">{items.map((item) => <article className="pitfall-entry" key={item.id}>
      <div className="pitfall-entry__date"><time dateTime={item.occurred_date}>{formatCalendarDate(item.occurred_date)}</time></div>
      <div className="pitfall-entry__body">
        <header><span className={`status-tag status-tag--${item.status === 'resolved' ? 'success' : 'warning'}`}>{item.status === 'resolved' ? '已处理' : '未处理'}</span><div className="inline-actions"><button type="button" className="text-button" onClick={() => { setEditingId(item.id); setAddingToId('') }}>修改</button><button type="button" className="text-button text-button--danger" onClick={() => void removePitfall(item)}>删除</button></div></header>
        {editingId === item.id ? <PitfallForm item={item} onSaved={refresh} onCancel={() => setEditingId('')} /> : <p className="pitfall-entry__description">{item.description}</p>}
        <section className="resolution-history"><header><div><h4>处理过程</h4><span>{item.resolutions.length} 条</span></div><button type="button" className="secondary-button" onClick={() => { setAddingToId(item.id); setEditingResolutionId(''); setEditingId('') }}>+ 追加处理</button></header>
          {item.resolutions.length === 0 && addingToId !== item.id && <p className="resolution-empty">还没有处理记录，追加第一条后将自动变为“已处理”。</p>}
          {item.resolutions.map((resolution) => <div className="resolution-item" key={resolution.id}><div className="resolution-item__marker" aria-hidden="true" /><div className="resolution-item__content">{editingResolutionId === resolution.id ? <ResolutionForm pitfallId={item.id} item={resolution} onSaved={refresh} onCancel={() => setEditingResolutionId('')} /> : <><header><time dateTime={resolution.resolved_date}>{formatCalendarDate(resolution.resolved_date)}</time><div className="inline-actions"><button type="button" className="text-button" onClick={() => { setEditingResolutionId(resolution.id); setAddingToId('') }}>修改</button><button type="button" className="text-button text-button--danger" onClick={() => void removeResolution(resolution)}>删除</button></div></header><p>{resolution.content}</p></>}</div></div>)}
          {addingToId === item.id && <ResolutionForm pitfallId={item.id} onSaved={refresh} onCancel={() => setAddingToId('')} />}
        </section>
      </div>
    </article>)}</div>}
  </section>
}
