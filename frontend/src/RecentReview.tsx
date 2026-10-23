import { useEffect, useRef, useState } from 'react'
import { requestJson } from './http'
import { listTopics, type Topic } from './topicsApi'
import { beijingToday, formatBeijingDateTime } from './time'
import { Select } from './Select'
import './RecentReview.css'

interface Review { generated_at: string; fingerprint: string; sections: { kind: 'progress' | 'follow_up' | 'uncertain'; items: { text: string; references: { id: string; record_type: string; title: string }[] }[] }[] }
const labels = { progress: '近期进展', follow_up: '需要跟进', uncertain: '尚待确认' }
export function RecentReview({ initialTopicId = '', revision, onOpen }: { initialTopicId?: string; revision: number; onOpen: (id: string, type: string) => void }) {
  const [end, setEnd] = useState(beijingToday)
  const [start, setStart] = useState(() => { const date = new Date(`${beijingToday()}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 6); return date.toISOString().slice(0, 10) })
  const [topic, setTopic] = useState(initialTopicId)
  const [topics, setTopics] = useState<Topic[]>([])
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [topicError, setTopicError] = useState('')
  const [topicRetry, setTopicRetry] = useState(0)
  const [stale, setStale] = useState(false)
  const sequence = useRef(0)
  const params = { start_date: start, end_date: end, ...(topic ? { topic_id: topic } : {}) }
  const key = JSON.stringify(params)
  useEffect(() => { let alive = true; listTopics().then(value => { if (alive) { setTopics(value.items); setTopicError('') } }).catch(() => { if (alive) setTopicError('主题列表加载失败，请重试。') }); return () => { alive = false } }, [topicRetry])
  useEffect(() => { sequence.current++; setBusy(false); setReview(null); setError(''); setStale(false) }, [key])
  useEffect(() => () => { sequence.current++ }, [])
  useEffect(() => {
    if (!review) return
    let alive = true
    const check = () => { void requestJson<{ fingerprint: string }>(`/reviews/fingerprint?${new URLSearchParams(JSON.parse(key))}`).then(value => { if (alive) setStale(value.fingerprint !== review.fingerprint) }).catch(() => { if (alive) setStale(true) }) }
    check(); window.addEventListener('focus', check)
    return () => { alive = false; window.removeEventListener('focus', check) }
  }, [review, key, revision])
  const generate = async () => {
    if (busy) return
    if (!start || !end || start > end) { setError('请选择有效日期，开始日期不能晚于结束日期。'); return }
    // 用请求序号隔离范围切换和卸载，旧结果不能覆盖当前回顾。
    const request = ++sequence.current
    setBusy(true); setError(''); setReview(null)
    try { const result = await requestJson<Review>('/reviews/recent', { method: 'POST', body: JSON.stringify(params) }); if (request === sequence.current) { setReview(result); setStale(false) } }
    catch (reason) { if (request === sequence.current) setError(reason instanceof Error ? reason.message : '生成失败，请重试。') }
    finally { if (request === sequence.current) setBusy(false) }
  }
  return <section className="recent-review">
    <header><h2>近期回顾</h2><p className="muted">汇总已有记录的进展、跟进事项和待确认信息。</p></header>
    <form className="review-filters" onSubmit={event => { event.preventDefault(); void generate() }}>
      <label className="field-stack"><span>开始日期</span><input type="date" required value={start} onChange={event => setStart(event.target.value)} /></label>
      <label className="field-stack"><span>结束日期</span><input type="date" required value={end} min={start} onChange={event => setEnd(event.target.value)} /></label>
      <label className="field-stack"><span>主题</span><Select value={topic} onChange={event => setTopic(event.target.value)}><option value="">全项目（含未归属记录）</option>{topics.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? '正在生成…' : review ? '重新生成' : error ? '重试生成' : '生成回顾'}</button>
    </form>
    {topicError && <p role="alert">{topicError} <button type="button" onClick={() => setTopicRetry(value => value + 1)}>重试加载主题</button></p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {busy && <p role="status">正在梳理记录，请稍候。</p>}
    {!review && !busy && <p className="view-state">选择范围后生成回顾；没有记录的部分将自动省略。</p>}
    {review && <div aria-live="polite">
      <p className="muted">{start} 至 {end} · {topic ? topics.find(item => item.id === topic)?.name ?? '所选主题' : '全项目'}<br />生成于 {formatBeijingDateTime(review.generated_at)}</p>
      {stale && <p role="status">记录已变化或暂时无法核验，请重新生成以查看最新情况。</p>}
      {review.sections.every(section => !section.items.length) && <p className="view-state">此范围内暂无需要回顾的内容。</p>}
      {review.sections.filter(section => section.items.length).map(section => <section className="review-section" key={section.kind}><h3>{labels[section.kind]}</h3><ul>{section.items.slice(0, 3).map((item, index) => <li key={index}><p>{item.text}</p><div className="review-references">{item.references.map(ref => <button className="topic-content-link" type="button" key={`${ref.record_type}:${ref.id}`} onClick={() => onOpen(ref.id, ref.record_type)}>{ref.title}</button>)}</div></li>)}</ul></section>)}
    </div>}
  </section>
}
